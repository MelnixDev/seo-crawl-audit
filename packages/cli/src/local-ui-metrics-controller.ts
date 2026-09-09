import {
  collectSiteMetrics,
  createGoogleSiteEstimateProvider,
  createRdapDomainProvider,
  type SiteMetric,
  type SiteMetrics,
  type SnapshotV2,
} from "@seo-crawl-audit/core";

function withManualGoogleEstimate(metrics: SiteMetrics, input: unknown): SiteMetrics {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) return metrics;
  const estimate: SiteMetric = {
    id: "search.google-site-estimate",
    label: { en: "Google site: estimate", uk: "Приблизно в Google (site:)" },
    value,
    unit: "count",
    source: { id: "google-site-search-manual", label: "Google site:" },
    observedAt: new Date().toISOString(),
    confidence: "low",
    status: "estimate",
    detail: {
      en: "Approximate public `site:` count entered locally after checking Google. It is not authoritative Search Console coverage.",
      uk: "Приблизну публічну кількість `site:` введено локально після перевірки Google. Це не точні дані Search Console.",
    },
  };
  return { ...metrics, metrics: [...metrics.metrics.filter((metric) => metric.id !== estimate.id), estimate] };
}

export async function collectLocalUiMetrics(
  snapshot: SnapshotV2,
  googleEstimate: unknown,
  fetch: typeof globalThis.fetch,
): Promise<SiteMetrics> {
  const collected = await collectSiteMetrics(snapshot, {
    providers: [createGoogleSiteEstimateProvider(), createRdapDomainProvider()],
    fetch,
  });
  return withManualGoogleEstimate(collected, googleEstimate);
}
