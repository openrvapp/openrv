// Getting into a gateway. Phones pair with it (a bonded, encrypted Bluetooth link) and the gateway
// keeps a list of the phones it lets in, each an owner or a guest. A new gateway has no owner: the
// first phone claims it with the setup code from the web flasher's QR code, or while someone holds
// the gateway's BOOT button for 3 seconds.
import { pinProof } from './auth';
import { GatewayError, type GatewayClient } from './client';
import type { Access, Hello } from './types';

/** How long to wait for a phone that already has a bond to get its encrypted link on its own. */
const BOND_WAIT_MS = 3_000;
/** How long the person has to accept the phone's pairing prompt. */
const PAIR_WAIT_MS = 60_000;
const POLL_MS = 1_000;
const POLL_TIMEOUT_MS = 4_000;

export class AccessError extends Error {
  constructor(
    readonly reason: 'refused' | 'pairing_failed' | 'bad_code' | 'claimed',
    message: string,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}

export const REFUSED_MESSAGE =
  "This gateway already has an owner and doesn't know this phone. Ask an owner to add it (Settings › Phones), or hold the gateway's BOOT button for 3 seconds and connect again within 2 minutes.";

/** Normalizes what a person typed: "k7qm2-xwpa9" → "K7QM2XWPA9". */
export function normalizeSetupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** For people: "K7QM2XWPA9" → "K7QM2-XWPA9". */
export function formatCode(code: string): string {
  const c = normalizeSetupCode(code);
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

/** Firmware before 0.4 has no access control; treat it as letting everyone in as an owner. */
export function accessOf(hello: Hello): Access {
  return hello.access ?? { role: 'owner', paired: false, claimed: true, pairing: false, setup_code: false };
}

/**
 * Pairs if needed, and claims the gateway when it has no owner and there's a way to (a setup code,
 * or its pairing window). Returns the access the phone ends up with; role "none" means the gateway
 * has no owner yet and needs a code or the button.
 */
export async function join(
  client: GatewayClient,
  hello: Hello,
  phoneName: string,
  setupCode?: string,
  /** Starts pairing from the phone (one prompt on Android, where the gateway asking gives two). */
  pairFromPhone?: () => Promise<boolean>,
  /**
   * Whether the phone still has a pairing the gateway doesn't know. Pairing over this connection
   * would stall, so join stops there (paired: false) for the caller to forget it and reconnect.
   */
  hasStalePairing?: () => boolean,
): Promise<Access> {
  let access = accessOf(hello);
  let wake: (() => void) | undefined;
  const off = client.onEvent((e) => {
    if (e.ev !== 'access') return;
    access = e.data;
    wake?.();
  });
  const event = (done: (a: Access) => boolean, ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      }
      wake = () => {
        if (done(access) || access.refused) finish();
      };
    });
  // Events can be missed (sent before the app subscribed), so it also asks now and then.
  const until = async (done: (a: Access) => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!done(access) && !access.refused && Date.now() < end) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, POLL_MS);
      });
      wake = undefined;
      if (done(access) || access.refused) break;
      try {
        access = accessOf(await client.request<Hello>('hello', { phone: phoneName }, POLL_TIMEOUT_MS));
      } catch (e) {
        if (access.refused) break; // it hung up after saying why
        // While the phone pairs, the link can hold messages back for a few seconds; keep waiting.
        if (e instanceof GatewayError && e.code === 'timeout') continue;
        throw e;
      }
    }
  };

  try {
    if (access.role !== 'none') return access;
    if (!access.paired) {
      await until((a) => a.paired, BOND_WAIT_MS);
      // Not a phone the gateway knows, and nothing to pair for yet (no setup code, and the gateway
      // isn't in pairing mode): stop before Android asks to pair, and let the app explain how to
      // get in (pairing mode, the setup code, an owner, or a factory reset).
      if (!access.paired && !access.pairing && !setupCode) return access;
      if (!access.paired && hasStalePairing?.()) return access;
      if (!access.paired && !access.refused) {
        // No asking while it pairs: messages on the link as it starts encrypting can break the
        // pairing. The gateway holds its answer until then, and sends an "access" event.
        const done = event((a) => a.paired, PAIR_WAIT_MS);
        const started = pairFromPhone ? await pairFromPhone().catch(() => false) : false;
        if (!started)
          await client.request('pair', undefined, PAIR_WAIT_MS).catch((e: unknown) => {
            if (!(e instanceof GatewayError && e.code === 'timeout')) throw e;
          });
        await done;
        if (!access.paired && !access.refused) await until((a) => a.paired, BOND_WAIT_MS);
      }
    }
    if (access.refused) throw new AccessError('refused', REFUSED_MESSAGE);
    if (!access.paired) throw new AccessError('pairing_failed', "The phone didn't finish pairing with the gateway.");
    if (access.role !== 'none' || !(setupCode || access.pairing)) return access;
    return await claim(client, setupCode);
  } finally {
    off();
  }
}

/** Makes this phone the owner of a gateway that has none: with its setup code, or while its BOOT button's window is open. */
export async function claim(client: GatewayClient, setupCode?: string): Promise<Access> {
  try {
    if (!setupCode) return await client.request<Access>('claim');
    const { nonce } = await client.request<{ nonce: string }>('auth.challenge');
    return await client.request<Access>('claim', { proof: pinProof(normalizeSetupCode(setupCode), nonce) });
  } catch (e) {
    if (e instanceof GatewayError && e.code === 'auth_failed')
      throw new AccessError(
        'bad_code',
        setupCode ? "That setup code isn't right." : 'Pairing on the gateway has closed.',
      );
    if (e instanceof GatewayError && e.code === 'refused')
      throw new AccessError('claimed', 'Someone else has just become the owner of this gateway.');
    throw e;
  }
}
