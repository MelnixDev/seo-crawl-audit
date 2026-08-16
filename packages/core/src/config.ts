import type { ScanConfigV1, Severity } from "./types.js";

export const DEFAULT_CONFIG_FILE = "seo-audit.config.json";

export const DEFAULT_SCAN_CONFIG: Readonly<ScanConfigV1> = Object.freeze({
  schemaVersion: 1,
  url: "",
  sitemap: "auto",
  maxPages: 100,
  concurrency: 5,
  delay: 100,
  timeout: 10_000,
  respectRobots: true,
  includeQuery: false,
  maxRedirects: 10,
  maxResponseBytes: 5 * 1024 * 1024,
  enabledRules: null,
  severityOverrides: {},
  suppressions: [],
  regressionBudgets: {},
  report: {},
});

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

export function validateConfig(input: unknown): Partial<ScanConfigV1> {
  const value = object(input, "config");
  const allowed = new Set([
    "$schema", "schemaVersion", "url", "sitemap", "maxPages", "concurrency", "delay", "timeout",
    "respectRobots", "includeQuery", "maxRedirects", "maxResponseBytes", "enabledRules",
    "severityOverrides", "suppressions", "regressionBudgets", "report",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown config property: ${key}`);
  }

  const result: Partial<ScanConfigV1> = {};
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (value.url !== undefined) {
    const url = optionalString(value.url, "url")!;
    if (!/^https?:\/\//i.test(url)) throw new Error("url must be an HTTP(S) URL");
    result.url = url;
  }
  if (value.sitemap !== undefined) {
    const sitemap = optionalString(value.sitemap, "sitemap")!;
    if (!["auto", "none"].includes(sitemap) && !/^https?:\/\//i.test(sitemap)) {
      throw new Error("sitemap must be auto, none, or an HTTP(S) URL");
    }
    result.sitemap = sitemap;
  }
  if (value.maxPages !== undefined) result.maxPages = integer(value.maxPages, "maxPages", 1);
  if (value.concurrency !== undefined) result.concurrency = integer(value.concurrency, "concurrency", 1, 50);
  if (value.delay !== undefined) result.delay = integer(value.delay, "delay", 0);
  if (value.timeout !== undefined) result.timeout = integer(value.timeout, "timeout", 1);
  if (value.maxRedirects !== undefined) result.maxRedirects = integer(value.maxRedirects, "maxRedirects", 0, 50);
  if (value.maxResponseBytes !== undefined) result.maxResponseBytes = integer(value.maxResponseBytes, "maxResponseBytes", 1024);
  for (const field of ["respectRobots", "includeQuery"] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "boolean") throw new Error(`${field} must be a boolean`);
      result[field] = value[field] as boolean;
    }
  }
  if (value.enabledRules !== undefined) {
    if (value.enabledRules !== null && (!Array.isArray(value.enabledRules) || value.enabledRules.some((rule) => typeof rule !== "string"))) {
      throw new Error("enabledRules must be null or an array of rule IDs");
    }
    result.enabledRules = value.enabledRules as string[] | null;
  }
  if (value.severityOverrides !== undefined) {
    const overrides = object(value.severityOverrides, "severityOverrides");
    for (const [rule, severity] of Object.entries(overrides)) {
      if (!(["error", "warning", "info"] as unknown[]).includes(severity)) {
        throw new Error(`severityOverrides.${rule} must be error, warning, or info`);
      }
    }
    result.severityOverrides = overrides as Record<string, Severity>;
  }
  if (value.suppressions !== undefined) {
    if (!Array.isArray(value.suppressions)) throw new Error("suppressions must be an array");
    result.suppressions = value.suppressions.map((entry, index) => {
      const suppression = object(entry, `suppressions[${index}]`);
      for (const field of ["rule", "urlPattern", "reason"]) {
        if (typeof suppression[field] !== "string" || suppression[field] === "") {
          throw new Error(`suppressions[${index}].${field} must be a non-empty string`);
        }
      }
      if (suppression.expiresAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(suppression.expiresAt))) {
        throw new Error(`suppressions[${index}].expiresAt must use YYYY-MM-DD`);
      }
      return suppression as unknown as ScanConfigV1["suppressions"][number];
    });
  }
  if (value.regressionBudgets !== undefined) {
    const budgets = object(value.regressionBudgets, "regressionBudgets");
    result.regressionBudgets = Object.fromEntries(
      Object.entries(budgets).map(([key, budget]) => [key, integer(budget, `regressionBudgets.${key}`, 0)]),
    );
  }
  if (value.report !== undefined) {
    const report = object(value.report, "report");
    const branding: ScanConfigV1["report"] = {};
    branding.agencyName = optionalString(report.agencyName, "report.agencyName");
    branding.logo = optionalString(report.logo, "report.logo");
    branding.primaryColor = optionalString(report.primaryColor, "report.primaryColor");
    if (branding.primaryColor && !/^#[0-9a-f]{6}$/i.test(branding.primaryColor)) {
      throw new Error("report.primaryColor must be a six-digit hex color");
    }
    result.report = Object.fromEntries(Object.entries(branding).filter(([, child]) => child !== undefined));
  }
  return result;
}

export function resolveConfig(
  cli: Partial<ScanConfigV1>,
  file: Partial<ScanConfigV1> = {},
  baseline: Partial<ScanConfigV1> = {},
): ScanConfigV1 {
  const merged = { ...DEFAULT_SCAN_CONFIG, ...baseline, ...file, ...cli };
  return {
    ...merged,
    schemaVersion: 1,
    severityOverrides: { ...(baseline.severityOverrides ?? {}), ...(file.severityOverrides ?? {}), ...(cli.severityOverrides ?? {}) },
    regressionBudgets: { ...(baseline.regressionBudgets ?? {}), ...(file.regressionBudgets ?? {}), ...(cli.regressionBudgets ?? {}) },
    report: { ...(baseline.report ?? {}), ...(file.report ?? {}), ...(cli.report ?? {}) },
    suppressions: cli.suppressions ?? file.suppressions ?? baseline.suppressions ?? [],
  };
}
