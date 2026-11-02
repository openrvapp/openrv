// Messages are compact JSON, one per line, split across as many BLE packets as the MTU needs.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NEWLINE = 0x0a;
/** A line longer than this is garbage (or a lost newline); drop it rather than grow forever. */
const MAX_LINE = 16 * 1024;

/** Serializes one message and splits it into packets of at most `chunkSize` bytes. */
export function encodeMessage(message: unknown, chunkSize: number): Uint8Array[] {
  const bytes = encoder.encode(JSON.stringify(message) + '\n');
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(bytes.subarray(i, i + chunkSize));
  }
  return chunks;
}

/** Reassembles lines from packets. Bytes are kept until a newline so multi-byte UTF-8 never splits. */
export class LineDecoder {
  private pending: number[] = [];

  /** Feeds one packet; returns every complete line it finished, without the newline. */
  push(packet: Uint8Array): string[] {
    const lines: string[] = [];
    for (const b of packet) {
      if (b === NEWLINE) {
        if (this.pending.length > 0) lines.push(decoder.decode(Uint8Array.from(this.pending)));
        this.pending = [];
      } else if (this.pending.length < MAX_LINE) {
        this.pending.push(b);
      }
    }
    return lines;
  }

  reset(): void {
    this.pending = [];
  }
}
