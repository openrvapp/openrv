import { AccessError, accessOf, formatCode, join, normalizeSetupCode } from '../access';
import { pinProof } from '../auth';
import { GatewayError, type GatewayClient } from '../client';
import type { Access, Event, Hello } from '../types';

const NONCE = '00112233445566778899aabbccddeeff';
const base: Access = { role: 'none', paired: false, claimed: false, pairing: false, setup_code: true };
const hello = (access?: Access) =>
  ({ proto: 1, fw: '0.4.0', name: 'RV', auth: { pin_set: false, ok: true }, access, caps: {} }) as Hello;

/** A gateway that answers like the firmware does, with a phone that pairs as soon as it's asked. */
function fakeGateway(start: Access, code = 'K7QM2XWPA9') {
  let access = { ...start };
  const listeners = new Set<(e: Event) => void>();
  const emit = () => listeners.forEach((l) => l({ ev: 'access', data: access }));
  const ops: string[] = [];
  const client = {
    onEvent(l: (e: Event) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async request(op: string, args?: Record<string, unknown>) {
      ops.push(op);
      switch (op) {
        case 'hello':
          return hello(access);
        case 'pair':
          setTimeout(() => {
            access = access.claimed ? { ...access, refused: 'pairing_closed' } : { ...access, paired: true };
            emit();
          }, 5);
          return access;
        case 'auth.challenge':
          return { nonce: NONCE };
        case 'claim':
          if (args?.proof !== pinProof(code, NONCE) && !access.pairing) throw new GatewayError('auth_failed');
          access = { ...access, role: 'owner', claimed: true, pairing: false };
          return access;
      }
      throw new Error(`unexpected ${op}`);
    },
  };
  return { client: client as unknown as GatewayClient, ops };
}

describe('joining a gateway', () => {
  it('treats firmware without access control as letting the phone in', () => {
    expect(accessOf(hello()).role).toBe('owner');
  });

  it('pairs, then claims a new gateway with the setup code', async () => {
    const { client, ops } = fakeGateway(base);
    const access = await join(client, hello(base), 'Pixel', 'k7qm2-xwpa9');
    expect(access.role).toBe('owner');
    expect(ops).toEqual(expect.arrayContaining(['pair', 'auth.challenge', 'claim']));
  }, 10_000);

  it('stops before pairing with a new gateway without a code, so the app can ask for one', async () => {
    const { client, ops } = fakeGateway(base);
    expect((await join(client, hello(base), 'Pixel')).role).toBe('none');
    expect(ops).not.toContain('pair');
  }, 10_000);

  it('says so when the code is wrong', async () => {
    const { client } = fakeGateway(base);
    await expect(join(client, hello(base), 'Pixel', 'AAAAAAAAAA')).rejects.toBeInstanceOf(AccessError);
  }, 10_000);

  it("doesn't ask to pair with a gateway that has an owner and isn't in pairing mode", async () => {
    const owned = { ...base, claimed: true };
    const { client, ops } = fakeGateway(owned);
    const access = await join(client, hello(owned), 'Pixel');
    expect(access).toMatchObject({ role: 'none', claimed: true, paired: false });
    expect(ops).not.toContain('pair');
  }, 10_000);

  it('explains a refusal from a gateway that has an owner', async () => {
    const owned = { ...base, claimed: true, pairing: true };
    const { client } = fakeGateway(owned);
    await expect(join(client, hello(owned), 'Pixel')).rejects.toMatchObject({ reason: 'refused' });
  }, 10_000);

  it("doesn't pair again when the phone is already known", async () => {
    const guest: Access = { ...base, role: 'guest', paired: true, claimed: true };
    const { client, ops } = fakeGateway(guest);
    expect((await join(client, hello(guest), 'Pixel')).role).toBe('guest');
    expect(ops).toEqual([]);
  });

  it('reads codes the way people type them', () => {
    expect(normalizeSetupCode(' k7qm2-xwpa9 ')).toBe('K7QM2XWPA9');
    expect(formatCode('k7qm2xwpa9')).toBe('K7QM2-XWPA9');
  });
});
