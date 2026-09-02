/**
 * Read request headers without ever accepting their values as CLI arguments.
 * Keeping secrets in the environment avoids exposing them through process
 * listings, shell history, snapshots, reports, and configuration files.
 */
export function headersFromEnvironment(variableName: string | undefined): Record<string, string> {
  if (!variableName) return {};
  const encoded = process.env[variableName];
  if (!encoded) throw new Error(`environment variable ${variableName} is empty or missing`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`environment variable ${variableName} must contain a JSON object`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`environment variable ${variableName} must contain a JSON object`);
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(`header ${name} in ${variableName} must be a string`);
    try {
      new Headers({ [name]: value });
    } catch (error) {
      throw new Error(`header ${name} in ${variableName} is invalid`, { cause: error });
    }
    headers[name] = value;
  }
  return headers;
}

/**
 * Add private headers only to the configured target origin. Redirects or
 * externally hosted sitemaps must not receive credentials intended for the
 * audited site.
 */
export function fetchWithHeaders(
  headers: Record<string, string>,
  targetUrl: string,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  if (Object.keys(headers).length === 0) return baseFetch;
  const targetOrigin = new URL(targetUrl).origin;
  return (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (new URL(requestUrl).origin !== targetOrigin) return baseFetch(input, init);
    const merged = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => merged.set(name, value));
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return baseFetch(input, { ...init, headers: merged });
  };
}

export function requestFetch(
  variableName: string | undefined,
  targetUrl: string,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return fetchWithHeaders(headersFromEnvironment(variableName), targetUrl, baseFetch);
}

/** Keep authenticated and public interrupted scans from sharing cached pages. */
export function checkpointPathForRequestHeaders(path: string, variableName: string | undefined): string {
  if (!variableName) return path;
  const profile = createHash("sha256").update(variableName).digest("hex").slice(0, 12);
  return path.endsWith(".ndjson")
    ? `${path.slice(0, -".ndjson".length)}.auth-${profile}.ndjson`
    : `${path}.auth-${profile}`;
}
import { createHash } from "node:crypto";
