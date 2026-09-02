import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  ENGINE_VERSION,
  planScan,
  resolveConfig,
  type ScanConfigV1,
} from "@seo-crawl-audit/core";
import { findConfigFile, loadConfig } from "@seo-crawl-audit/core/node";
import type { CliValues } from "./args.js";
import { fetchWithHeaders, headersFromEnvironment } from "./request-headers.js";

export type DoctorStatus = "pass" | "warning" | "fail" | "skipped";

export interface DoctorCheck {
  id: "runtime" | "config" | "target" | "storage" | "homepage" | "robots" | "sitemap";
  status: DoctorStatus;
  message: string;
  remediation?: string;
  evidence?: Record<string, unknown>;
}

export interface DoctorResult {
  healthy: boolean;
  offline: boolean;
  url: string | null;
  checks: DoctorCheck[];
  summary: Record<DoctorStatus, number>;
}

export interface DoctorOptions {
  directory?: string;
  url?: string;
  configPath?: string;
  outputPath?: string;
  reportPath?: string;
  historyPath?: string;
  reportEnabled?: boolean;
  historyEnabled?: boolean;
  offline?: boolean;
  runtimeVersion?: string;
  fetch?: typeof globalThis.fetch;
  requestHeaders?: Record<string, string>;
  signal?: AbortSignal;
}

const MINIMUM_NODE = [20, 19, 0] as const;
const DEFAULT_BASELINE = ".seo-audit.json";
const DEFAULT_REPORT = "seo-audit-report.html";
const DEFAULT_HISTORY = ".seo-audit/history";

function versionParts(input: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(input);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function supportedNode(input: string): boolean {
  const current = versionParts(input);
  for (let index = 0; index < MINIMUM_NODE.length; index += 1) {
    const value = current[index] ?? 0;
    const minimum = MINIMUM_NODE[index] ?? 0;
    if (value > minimum) return true;
    if (value < minimum) return false;
  }
  return true;
}

function normalizedHttpUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function fromDirectory(directory: string, path: string): string {
  return isAbsolute(path) ? path : resolve(directory, path);
}

async function nearestExistingDirectory(input: string): Promise<string> {
  let candidate = resolve(input);
  while (true) {
    try {
      const details = await stat(candidate);
      if (details.isDirectory()) return candidate;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`no existing parent directory for ${input}`);
    candidate = parent;
  }
}

async function storageCheck(directory: string, options: DoctorOptions): Promise<DoctorCheck> {
  const targets = [
    dirname(fromDirectory(directory, options.outputPath ?? DEFAULT_BASELINE)),
    ...(options.reportEnabled === false ? [] : [dirname(fromDirectory(directory, options.reportPath ?? DEFAULT_REPORT))]),
    ...(options.historyEnabled === false ? [] : [fromDirectory(directory, options.historyPath ?? DEFAULT_HISTORY)]),
  ];
  try {
    const parents = [...new Set(await Promise.all(targets.map(nearestExistingDirectory)))];
    await Promise.all(parents.map((path) => access(path, constants.W_OK)));
    return {
      id: "storage",
      status: "pass",
      message: `Output locations are writable through ${parents.join(", ")}`,
      evidence: { directories: parents },
    };
  } catch (error) {
    return {
      id: "storage",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
      remediation: "Create the output directory or grant the current user write access.",
    };
  }
}

function timeoutSignal(timeout: number, signal?: AbortSignal): AbortSignal {
  const timeoutOnly = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timeoutOnly]) : timeoutOnly;
}

async function homepageCheck(
  url: string,
  config: ScanConfigV1,
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<DoctorCheck> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "user-agent": `SEO-Crawl-Audit-Doctor/${ENGINE_VERSION}`,
      },
      redirect: "follow",
      signal: timeoutSignal(config.timeout, signal),
    });
    const contentType = response.headers.get("content-type") ?? "";
    await response.body?.cancel();
    if (response.status >= 400) {
      return {
        id: "homepage",
        status: "fail",
        message: `Start URL returned HTTP ${response.status}`,
        remediation: response.status === 401 || response.status === 403
          ? "Configure authenticated request headers before auditing this site."
          : "Confirm that the URL is correct and publicly reachable.",
        evidence: { status: response.status, contentType },
      };
    }
    if (!contentType.toLowerCase().includes("html")) {
      return {
        id: "homepage",
        status: "warning",
        message: `Start URL returned ${contentType || "an unknown content type"}`,
        remediation: "Use a URL that returns server-rendered HTML.",
        evidence: { status: response.status, contentType },
      };
    }
    return {
      id: "homepage",
      status: "pass",
      message: `Start URL returned HTTP ${response.status} HTML`,
      evidence: { status: response.status, contentType },
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      id: "homepage",
      status: "fail",
      message: `Could not request the start URL: ${error instanceof Error ? error.message : String(error)}`,
      remediation: "Check DNS, TLS, firewall access, and the configured timeout.",
    };
  }
}

function summarize(checks: DoctorCheck[]): DoctorResult["summary"] {
  return checks.reduce<DoctorResult["summary"]>((summary, check) => {
    summary[check.status] += 1;
    return summary;
  }, { pass: 0, warning: 0, fail: 0, skipped: 0 });
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const directory = resolve(options.directory ?? process.cwd());
  const checks: DoctorCheck[] = [];
  const runtimeVersion = options.runtimeVersion ?? process.versions.node;
  checks.push(supportedNode(runtimeVersion)
    ? { id: "runtime", status: "pass", message: `Node.js ${runtimeVersion} satisfies >=20.19` }
    : {
        id: "runtime",
        status: "fail",
        message: `Node.js ${runtimeVersion} is older than 20.19`,
        remediation: "Install Node.js 20.19 or newer on the machine running SEO Crawl Audit.",
      });

  const explicitConfigPath = options.configPath
    ? fromDirectory(directory, options.configPath)
    : null;
  const discoveredConfigPath = explicitConfigPath ?? await findConfigFile(directory);
  let fileConfig: Partial<ScanConfigV1> = {};
  if (!discoveredConfigPath) {
    checks.push({
      id: "config",
      status: "warning",
      message: "seo-audit.config.json was not found",
      remediation: "Run seo-audit init <url> to create a safe project configuration.",
    });
  } else {
    try {
      fileConfig = await loadConfig(discoveredConfigPath);
      checks.push({
        id: "config",
        status: "pass",
        message: `Configuration is valid: ${discoveredConfigPath}`,
        evidence: { path: discoveredConfigPath },
      });
    } catch (error) {
      checks.push({
        id: "config",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Fix the reported property or regenerate the file with seo-audit init --force.",
      });
    }
  }

  const requestedUrl = options.url ?? fileConfig.url ?? "";
  const url = normalizedHttpUrl(requestedUrl);
  if (!url) {
    checks.push({
      id: "target",
      status: "fail",
      message: requestedUrl ? "Target is not a full HTTP(S) URL" : "No target URL was provided",
      remediation: "Pass seo-audit doctor https://example.com/ or set url in seo-audit.config.json.",
    });
  } else {
    checks.push({ id: "target", status: "pass", message: `Target URL is ${url}`, evidence: { url } });
  }
  checks.push(await storageCheck(directory, options));

  const offline = options.offline ?? false;
  if (offline || !url) {
    const reason = offline ? "Skipped by --offline" : "Skipped because the target URL is invalid";
    for (const id of ["homepage", "robots", "sitemap"] as const) {
      checks.push({ id, status: "skipped", message: reason });
    }
  } else {
    const config = resolveConfig({ url }, fileConfig);
    const fetch = fetchWithHeaders(options.requestHeaders ?? {}, url, options.fetch ?? globalThis.fetch);
    checks.push(await homepageCheck(url, config, fetch, options.signal));
    try {
      const plan = await planScan(config, { fetch, signal: options.signal });
      if (plan.robots.denyAll && config.respectRobots) {
        checks.push({
          id: "robots",
          status: "fail",
          message: `robots.txt returned HTTP ${plan.robots.status ?? "unknown"} and blocks crawling`,
          remediation: "Allow the audit user agent or explicitly choose --ignore-robots when authorized.",
          evidence: { url: plan.robots.url, status: plan.robots.status, denyAll: true },
        });
      } else if (plan.robots.error || plan.robots.status === null || (plan.robots.status ?? 500) >= 400) {
        checks.push({
          id: "robots",
          status: "warning",
          message: plan.robots.error ?? `robots.txt returned HTTP ${plan.robots.status ?? "unknown"}`,
          remediation: "Publish a readable robots.txt when crawler policy needs to be explicit.",
          evidence: { url: plan.robots.url, status: plan.robots.status },
        });
      } else {
        checks.push({
          id: "robots",
          status: "pass",
          message: `robots.txt returned HTTP ${plan.robots.status}`,
          evidence: { url: plan.robots.url, status: plan.robots.status, denyAll: plan.robots.denyAll ?? false },
        });
      }

      if (config.sitemap === "none") {
        checks.push({ id: "sitemap", status: "skipped", message: "Sitemap discovery is disabled by configuration" });
      } else if (!plan.sitemap) {
        checks.push({
          id: "sitemap",
          status: "warning",
          message: "No sitemap was discovered",
          remediation: "Publish a sitemap or set sitemap to none when link-only crawling is intentional.",
        });
      } else if (plan.sitemap.error) {
        checks.push({
          id: "sitemap",
          status: config.sitemap === "auto" ? "warning" : "fail",
          message: plan.sitemap.error,
          remediation: "Check the sitemap URL, XML syntax, response size, and HTTP status.",
          evidence: { url: plan.sitemap.url },
        });
      } else if (plan.sitemap.urls.length === 0) {
        checks.push({
          id: "sitemap",
          status: "warning",
          message: `Sitemap contains no crawlable same-origin URLs: ${plan.sitemap.url}`,
          remediation: "Add canonical site URLs to the sitemap or verify the configured site origin.",
        });
      } else {
        checks.push({
          id: "sitemap",
          status: "pass",
          message: `Loaded ${plan.sitemap.urls.length} URL(s) from ${plan.sitemap.sitemapCount} sitemap file(s)`,
          evidence: {
            url: plan.sitemap.url,
            urls: plan.sitemap.urls.length,
            sitemapCount: plan.sitemap.sitemapCount,
            truncated: plan.sitemap.truncated,
          },
        });
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      checks.push({
        id: "robots",
        status: "fail",
        message: `Planning failed: ${error instanceof Error ? error.message : String(error)}`,
        remediation: "Check network access, robots.txt redirects, sitemap responses, and timeout settings.",
      });
      checks.push({ id: "sitemap", status: "skipped", message: "Skipped because scan planning failed" });
    }
  }

  const summary = summarize(checks);
  return { healthy: summary.fail === 0, offline, url, checks, summary };
}

function printDoctor(result: DoctorResult): void {
  console.log("SEO Crawl Audit doctor");
  const labels: Record<DoctorStatus, string> = {
    pass: "PASS",
    warning: "WARN",
    fail: "FAIL",
    skipped: "SKIP",
  };
  for (const check of result.checks) {
    console.log(`[${labels[check.status]}] ${check.id}: ${check.message}`);
    if (check.remediation) console.log(`       Fix: ${check.remediation}`);
  }
  console.log(result.healthy
    ? `Ready with ${result.summary.warning} warning(s) and ${result.summary.skipped} skipped check(s).`
    : `Not ready: ${result.summary.fail} check(s) failed.`);
}

export async function doctorCommand(url: string | undefined, values: CliValues, signal?: AbortSignal): Promise<number> {
  const result = await runDoctor({
    ...(values.directory !== undefined ? { directory: values.directory } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    ...(values.output !== undefined ? { outputPath: values.output } : {}),
    ...(values.report !== undefined ? { reportPath: values.report } : {}),
    ...(values["history-dir"] !== undefined ? { historyPath: values["history-dir"] } : {}),
    reportEnabled: values["no-report"] !== true,
    historyEnabled: values["no-history"] !== true,
    offline: values.offline === true,
    requestHeaders: headersFromEnvironment(values["headers-env"]),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (values.json) console.log(JSON.stringify({ command: "doctor", ...result }, null, 2));
  else printDoctor(result);
  return result.healthy ? 0 : 1;
}
