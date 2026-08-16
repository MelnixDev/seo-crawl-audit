import { setTimeout as sleep } from "node:timers/promises";
import type { ScanEvent } from "./types.js";

export interface RedirectHop {
  url: string;
  status: number;
  location: string | null;
}

export interface FetchPolicy {
  fetch: typeof globalThis.fetch;
  timeout: number;
  maxRedirects: number;
  retries: number;
  signal?: AbortSignal | undefined;
  gate?: ((url: string) => Promise<void>) | undefined;
  onEvent?: ((event: ScanEvent) => void | Promise<void>) | undefined;
  random?: (() => number) | undefined;
}

export class RequestFailure extends Error {
  redirectChain: RedirectHop[];

  constructor(message: string, redirectChain: RedirectHop[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "RequestFailure";
    this.redirectChain = redirectChain;
  }
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - now), 30_000);
}

function requestSignal(timeout: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function fetchRedirectChain(
  initialUrl: string,
  init: RequestInit,
  policy: FetchPolicy,
): Promise<{ response: Response; redirectChain: RedirectHop[] }> {
  const chain: RedirectHop[] = [];
  const visited = new Set([initialUrl]);
  let url = initialUrl;

  while (true) {
    policy.signal?.throwIfAborted();
    await policy.gate?.(url);
    const response = await policy.fetch(url, {
      ...init,
      redirect: "manual",
      signal: requestSignal(policy.timeout, policy.signal),
    });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, redirectChain: chain };
    }

    const next = new URL(location, url).href;
    chain.push({ url, status: response.status, location: next });
    await response.body?.cancel();
    if (visited.has(next)) throw new RequestFailure(`redirect loop detected at ${next}`, chain);
    if (chain.length > policy.maxRedirects) {
      throw new RequestFailure(`redirect limit of ${policy.maxRedirects} exceeded`, chain);
    }
    visited.add(next);
    url = next;
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  policy: FetchPolicy,
): Promise<{ response: Response; redirectChain: RedirectHop[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    try {
      const result = await fetchRedirectChain(url, init, policy);
      if (!retryableStatus(result.response.status) || attempt === policy.retries) return result;
      const serverDelay = retryAfterMs(result.response.headers.get("retry-after"));
      await result.response.body?.cancel();
      const jitter = Math.floor((policy.random ?? Math.random)() * 100);
      const delayMs = serverDelay ?? Math.min(250 * 2 ** attempt + jitter, 30_000);
      await policy.onEvent?.({ type: "retry", url, attempt: attempt + 1, delayMs });
      await sleep(delayMs, undefined, { signal: policy.signal });
    } catch (error) {
      if (policy.signal?.aborted) throw policy.signal.reason ?? error;
      lastError = error;
      if (error instanceof RequestFailure || attempt === policy.retries) break;
      const jitter = Math.floor((policy.random ?? Math.random)() * 100);
      const delayMs = Math.min(250 * 2 ** attempt + jitter, 30_000);
      await policy.onEvent?.({ type: "retry", url, attempt: attempt + 1, delayMs });
      await sleep(delayMs, undefined, { signal: policy.signal });
    }
  }
  if (lastError instanceof RequestFailure) throw lastError;
  throw new RequestFailure(lastError instanceof Error ? lastError.message : String(lastError), [], { cause: lastError });
}

export async function readResponseBody(response: Response, maxBytes: number): Promise<{ text: string; bytes: number; buffer: Buffer }> {
  if (!response.body) return { text: "", bytes: 0, buffer: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RequestFailure(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  const buffer = Buffer.concat(chunks);
  return { text: buffer.toString("utf8"), bytes: total, buffer };
}

export { retryAfterMs };
