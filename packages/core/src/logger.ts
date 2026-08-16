import type { EngineLogger } from "./types.js";

function noop(): void {}

export const NOOP_LOGGER: EngineLogger = Object.freeze({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});
