import { encodeMessage, LineDecoder } from './framing';
import { isEvent, type ErrorCode, type Event, type Message, type Op, type Request } from './types';

/** A byte pipe to a gateway: BLE in the app, an in-memory fake in tests and the demo. */
export interface Transport {
  /** Largest packet `write` accepts (ATT MTU - 3 over BLE). */
  readonly packetSize: number;
  write(packet: Uint8Array): Promise<void>;
  /** Registers the packet handler; returns a function that unregisters it. */
  onPacket(handler: (packet: Uint8Array) => void): () => void;
  onClose(handler: (error?: Error) => void): () => void;
  close(): Promise<void>;
  /** The link's signal strength in dBm, where the transport can tell. */
  readRssi?(): Promise<number>;
}

export class GatewayError extends Error {
  constructor(
    readonly code: ErrorCode | 'timeout' | 'closed',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GatewayError';
  }
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Request/response and events over a Transport. */
export class GatewayClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly lines = new LineDecoder();
  private readonly listeners = new Set<(event: Event) => void>();
  private readonly unsubscribe: (() => void)[];
  /** Writes go out one message at a time so packets of two messages never interleave. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly transport: Transport) {
    this.unsubscribe = [
      transport.onPacket((p) => this.receive(p)),
      transport.onClose((e) => this.failAll(new GatewayError('closed', e?.message))),
    ];
  }

  request<T = unknown>(op: Op, args?: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const id = this.nextId;
    this.nextId = (this.nextId % 65535) + 1;
    const message: Request = args ? { id, op, args } : { id, op };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayError('timeout', `${op} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      this.send(message).catch((e: Error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      });
    });
  }

  onEvent(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The link's signal strength in dBm; undefined where the transport can't tell. */
  readRssi(): Promise<number> | undefined {
    return this.transport.readRssi?.();
  }

  async close(): Promise<void> {
    this.unsubscribe.forEach((u) => u());
    this.failAll(new GatewayError('closed'));
    await this.transport.close();
  }

  private send(message: Request): Promise<void> {
    const packets = encodeMessage(message, this.transport.packetSize);
    const run = this.writeChain.then(async () => {
      for (const p of packets) await this.transport.write(p);
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private receive(packet: Uint8Array): void {
    for (const line of this.lines.push(packet)) {
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        continue; // a corrupt line costs one message, not the connection
      }
      if (isEvent(message)) {
        this.listeners.forEach((l) => l(message));
        continue;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) continue; // answer to another phone, or after a timeout
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.ok) waiting.resolve(message.result);
      else waiting.reject(new GatewayError(message.error?.code ?? 'internal', message.error?.message));
    }
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.lines.reset();
  }
}
