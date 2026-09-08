import type { SiteMetric, SiteMetrics, SiteMetricsStateV1 } from "./types.js";

const RDAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const GOOGLE_ESTIMATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}

function localized(value: unknown, field: string): { en: string; uk: string } {
  const item = record(value, field);
  return { en: text(item.en, `${field}.en`), uk: text(item.uk, `${field}.uk`) };
}

function metric(input: unknown, index: number): SiteMetric {
  const value = record(input, `metrics[${index}]`);
  const units = ["count", "bytes", "milliseconds", "date", "text"];
  const confidence = ["high", "medium", "low"];
  const statuses = ["available", "estimate", "unavailable", "not-connected", "error"];
  const source = record(value.source, `metrics[${index}].source`);
  if (!units.includes(String(value.unit))) throw new Error(`metrics[${index}].unit is invalid`);
  if (!confidence.includes(String(value.confidence))) throw new Error(`metrics[${index}].confidence is invalid`);
  if (!statuses.includes(String(value.status))) throw new Error(`metrics[${index}].status is invalid`);
  if (value.value !== null && typeof value.value !== "string" && typeof value.value !== "number") {
    throw new Error(`metrics[${index}].value must be a number, string, or null`);
  }
  const observedAt = text(value.observedAt, `metrics[${index}].observedAt`);
  if (Number.isNaN(Date.parse(observedAt))) throw new Error(`metrics[${index}].observedAt must be an ISO date`);
  const sourceUrl = source.url === undefined ? undefined : text(source.url, `metrics[${index}].source.url`);
  return {
    id: text(value.id, `metrics[${index}].id`),
    label: localized(value.label, `metrics[${index}].label`),
    value: value.value as number | string | null,
    unit: value.unit as SiteMetric["unit"],
    source: {
      id: text(source.id, `metrics[${index}].source.id`),
      label: text(source.label, `metrics[${index}].source.label`),
      ...(sourceUrl ? { url: sourceUrl } : {}),
    },
    observedAt,
    confidence: value.confidence as SiteMetric["confidence"],
    status: value.status as SiteMetric["status"],
    ...(value.stale === true ? { stale: true } : {}),
    ...(value.detail === undefined ? {} : { detail: localized(value.detail, `metrics[${index}].detail`) }),
  };
}

export function validateSiteMetricsState(input: unknown): SiteMetricsStateV1 {
  const value = record(input, "site metrics state");
  if (value.schemaVersion !== 1) throw new Error("site metrics state schemaVersion must be 1");
  const siteUrl = text(value.siteUrl, "site metrics state.siteUrl");
  const parsed = new URL(siteUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("site metrics state.siteUrl must use HTTP(S)");
  const updatedAt = text(value.updatedAt, "site metrics state.updatedAt");
  if (Number.isNaN(Date.parse(updatedAt))) throw new Error("site metrics state.updatedAt must be an ISO date");
  if (!Array.isArray(value.metrics)) throw new Error("site metrics state.metrics must be an array");
  return { schemaVersion: 1, siteUrl: parsed.href, updatedAt, metrics: value.metrics.map(metric) };
}

function freshnessWindow(metric: SiteMetric): number | null {
  if (metric.source.id === "rdap") return RDAP_MAX_AGE_MS;
  if (metric.id === "search.google-site-estimate") return GOOGLE_ESTIMATE_MAX_AGE_MS;
  return null;
}

export function markStaleSiteMetrics(state: SiteMetricsStateV1, now = new Date()): SiteMetricsStateV1 {
  const current = now.getTime();
  return {
    ...state,
    metrics: state.metrics.map((item) => {
      const maxAge = freshnessWindow(item);
      const stale = maxAge !== null && current - Date.parse(item.observedAt) > maxAge;
      return stale ? { ...item, stale: true } : { ...item, stale: false };
    }),
  };
}

/** Merges persisted external observations into freshly computed crawl metrics. */
export function mergeSiteMetrics(local: SiteMetrics, external: SiteMetricsStateV1 | null): SiteMetrics {
  if (!external || new URL(local.siteUrl).origin !== new URL(external.siteUrl).origin) return local;
  const replacements = new Map(external.metrics.map((item) => [item.id, item]));
  const localIds = new Set(local.metrics.map((item) => item.id));
  return {
    ...local,
    observedAt: external.updatedAt > local.observedAt ? external.updatedAt : local.observedAt,
    metrics: [
      ...local.metrics.map((item) => replacements.get(item.id) ?? item),
      ...external.metrics.filter((item) => !localIds.has(item.id)),
    ],
  };
}

export function externalSiteMetrics(metrics: SiteMetrics): SiteMetricsStateV1 {
  return {
    schemaVersion: 1,
    siteUrl: new URL(metrics.siteUrl).href,
    updatedAt: metrics.observedAt,
    metrics: metrics.metrics.filter((item) => item.source.id !== "crawl" && item.source.id !== "crawl-estimate"),
  };
}
