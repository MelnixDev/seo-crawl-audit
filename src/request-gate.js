import { setTimeout as sleep } from "node:timers/promises";

export function createRequestGate(
  intervalMs = 0,
  { now = Date.now, wait = sleep } = {},
) {
  const interval = Math.max(0, intervalMs);
  let nextStartAt = 0;
  let queue = Promise.resolve();

  return function waitForRequestSlot() {
    if (interval === 0) {
      return Promise.resolve();
    }

    const slot = queue.then(async () => {
      const remaining = Math.max(0, nextStartAt - now());
      if (remaining > 0) {
        await wait(remaining);
      }
      nextStartAt = now() + interval;
    });

    queue = slot.catch(() => {});
    return slot;
  };
}
