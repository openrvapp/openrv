import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import type { GatewayClient } from './client';

/** HMAC-SHA256(key = PIN, message = nonce), first 16 bytes, as hex. */
export function pinProof(pin: string, nonceHex: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(pin), hexToBytes(nonceHex)).subarray(0, 16));
}

/** Runs the challenge/response; the gateway then trusts this connection until it drops. */
export async function authenticate(client: GatewayClient, pin: string): Promise<void> {
  const { nonce } = await client.request<{ nonce: string }>('auth.challenge');
  await client.request('auth.prove', { proof: pinProof(pin, nonce) });
}
