import { setTimeout as sleep } from "node:timers/promises";

type Wait = (milliseconds: number) => Promise<unknown>;

export function createRequestGate(
  intervalMs = 0,
  { now = Date.now, wait = sleep as Wait } = {},
): () => Promise<void> {
  const interval = Math.max(0, intervalMs);
  let nextStartAt = 0;
  let queue: Promise<unknown> = Promise.resolve();

  return function waitForRequestSlot(): Promise<void> {
    if (interval === 0) return Promise.resolve();
    const slot = queue.then(async () => {
      const remaining = Math.max(0, nextStartAt - now());
      if (remaining > 0) await wait(remaining);
      nextStartAt = now() + interval;
    });
    queue = slot.catch(() => undefined);
    return slot;
  };
}

export function createPerOriginRequestGate(
  intervalMs = 0,
  factory: (intervalMs: number) => () => Promise<void> = createRequestGate,
): (url: string) => Promise<void> {
  const gates = new Map<string, () => Promise<void>>();
  return (url: string) => {
    const origin = new URL(url).origin;
    let gate = gates.get(origin);
    if (!gate) {
      gate = factory(intervalMs);
      gates.set(origin, gate);
    }
    return gate();
  };
}
