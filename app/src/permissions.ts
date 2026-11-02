// Android shows one permission dialog at a time; a second request while one is open can be lost,
// leaving its promise unresolved. Every permission request goes through this queue.
let queue: Promise<unknown> = Promise.resolve();

/** Runs `ask` after any permission request already in progress has finished. */
export function askInTurn<T>(ask: () => Promise<T>): Promise<T> {
  const run = queue.then(ask, ask);
  queue = run.catch(() => undefined);
  return run;
}
