export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  hasRules: boolean;
}

export interface RobotsData {
  url: string;
  status: number | null;
  body: string;
  sha256: string | null;
  rules: RobotsRule[];
  denyAll: boolean;
  error: string | null;
}

export interface RobotsFetchOptions {
  userAgent: string;
  timeout: number;
  maxRedirects: number;
  retries: number;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  requestGate?: (url: string) => Promise<void>;
  onEvent?: (event: ScanEvent) => void | Promise<void>;
  logger?: EngineLogger;
}

function patternMatches(pathWithQuery: string, pattern: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(pathWithQuery);
}

export function parseRobots(body: string, userAgent: string): RobotsRule[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of body.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (!line || separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], rules: [], hasRules: false };
        groups.push(current);
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }
    if (current && (field === "allow" || field === "disallow") && value) {
      current.rules.push({ type: field, path: value });
      current.hasRules = true;
    }
  }
  const normalizedAgent = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && normalizedAgent.includes(agent)));
  const matching = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  return matching.flatMap((group) => group.rules);
}

export function isAllowedByRobots(url: string, robots: { denyAll?: boolean; rules?: RobotsRule[] }): boolean {
  if (robots.denyAll) return false;
  const parsed = new URL(url);
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;
  const matches = (robots.rules ?? [])
    .filter((rule) => patternMatches(pathWithQuery, rule.path))
    .sort((left, right) => right.path.length - left.path.length || (left.type === "allow" ? -1 : 1));
  return matches.length === 0 || matches[0].type === "allow";
}

export async function fetchRobots(startUrl: string, options: RobotsFetchOptions): Promise<RobotsData> {
  const robotsUrl = new URL("/robots.txt", startUrl).href;
  try {
    const { response } = await fetchWithRetry(robotsUrl, {
      headers: { accept: "text/plain,*/*;q=0.1", "user-agent": options.userAgent },
    }, {
      fetch: options.fetch,
      timeout: options.timeout,
      maxRedirects: options.maxRedirects,
      retries: options.retries,
      signal: options.signal,
      gate: options.requestGate,
      onEvent: options.onEvent,
    });
    const { text: body } = await readResponseBody(response, MAX_ROBOTS_BYTES);
    return {
      url: robotsUrl,
      status: response.status,
      body,
      sha256: createHash("sha256").update(body).digest("hex"),
      rules: response.ok ? parseRobots(body, options.userAgent) : [],
      denyAll: response.status === 401 || response.status === 403,
      error: null,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      url: robotsUrl,
      status: null,
      body: "",
      sha256: null,
      rules: [],
      denyAll: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
import { createHash } from "node:crypto";
import { fetchWithRetry, readResponseBody } from "./fetcher.js";
import type { EngineLogger, ScanEvent } from "./types.js";

const MAX_ROBOTS_BYTES = 512 * 1024;
