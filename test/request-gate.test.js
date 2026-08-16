import test from "node:test";
import assert from "node:assert/strict";
import { createRequestGate } from "../packages/core/dist/index.js";

test("spaces concurrent request starts by the configured interval", async () => {
  let currentTime = 1_000;
  const waits = [];
  const starts = [];
  const gate = createRequestGate(100, {
    now: () => currentTime,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  });

  await Promise.all(
    Array.from({ length: 4 }, async () => {
      await gate();
      starts.push(currentTime);
    }),
  );

  assert.deepEqual(starts, [1_000, 1_100, 1_200, 1_300]);
  assert.deepEqual(waits, [100, 100, 100]);
});

test("allows immediate requests when the interval is disabled", async () => {
  let waitCalls = 0;
  const gate = createRequestGate(0, {
    wait: async () => {
      waitCalls += 1;
    },
  });

  await Promise.all([gate(), gate(), gate()]);
  assert.equal(waitCalls, 0);
});
