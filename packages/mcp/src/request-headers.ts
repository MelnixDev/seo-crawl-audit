import { createHash } from "node:crypto";

export function headersFromEnvironment(variableName: string | undefined): Record<string, string> {
  if (!variableName) return {};
  const encoded = process.env[variableName];
  if (!encoded) throw new Error(`environment variable ${variableName} is empty or missing`);
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); }
  catch (error) { throw new Error(`environment variable ${variableName} must contain a JSON object`, { cause: error }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`environment variable ${variableName} must contain a JSON object`);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(`header ${name} in ${variableName} must be a string`);
    try { new Headers({ [name]: value }); }
    catch { throw new Error(`header ${name} in ${variableName} is invalid`); }
    headers[name] = value;
  }
  return headers;
}

export function requestFetch(variableName: string | undefined, targetUrl: string, baseFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  const headers = headersFromEnvironment(variableName);
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

export function authenticatedCheckpointPath(path: string, variableName: string | undefined): string {
  if (!variableName) return path;
  const profile = createHash("sha256").update(variableName).digest("hex").slice(0, 12);
  return path.endsWith(".ndjson") ? `${path.slice(0, -7)}.auth-${profile}.ndjson` : `${path}.auth-${profile}`;
}
