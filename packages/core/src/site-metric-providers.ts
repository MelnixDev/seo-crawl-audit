import { buildSiteMetrics } from "./site-metrics.js";
import type {
  CollectSiteMetricsOptions,
  SiteMetric,
  SiteMetricProvider,
  SiteMetricProviderContext,
  SiteMetrics,
  SnapshotV2,
} from "./types.js";

interface RdapEvent {
  eventAction?: unknown;
  eventDate?: unknown;
}

interface RdapEntity {
  roles?: unknown;
  vcardArray?: unknown;
}

export interface RdapProviderOptions {
  endpoint?: string;
}

export interface GoogleSiteEstimateProviderOptions {
  endpoint?: string;
}

function googleEstimateUnavailable(sourceUrl: string, observedAt: string, detail: { en: string; uk: string }): SiteMetric[] {
  return [{
    id: "search.google-site-estimate",
    label: { en: "Google site: estimate", uk: "Приблизно в Google (site:)" },
    value: null,
    unit: "count",
    source: { id: "google-site-search", label: "Google site:", url: sourceUrl },
    observedAt,
    confidence: "low",
    status: "unavailable",
    detail,
  }];
}

function googleResultCount(html: string): number | null {
  const stats = html.match(/id=["']result-stats["'][^>]*>([\s\S]{0,500}?)<\/[^>]+>/i)?.[1];
  if (!stats) return null;
  const text = stats.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|\u00a0/gi, " ");
  const number = text.match(/\d[\d.,\s\u00a0]*/)?.[0]?.replace(/\D/g, "");
  if (!number) return null;
  const value = Number(number);
  return Number.isSafeInteger(value) ? value : null;
}

/** Creates a best-effort public estimate from Google's `site:` result count. */
export function createGoogleSiteEstimateProvider(options: GoogleSiteEstimateProviderOptions = {}): SiteMetricProvider {
  const endpoint = options.endpoint ?? "https://www.google.com/search";
  return {
    id: "google-site-search",
    async collect(context: SiteMetricProviderContext): Promise<SiteMetric[]> {
      const hostname = new URL(context.snapshot.siteUrl).hostname;
      const sourceUrl = `${endpoint}?q=${encodeURIComponent(`site:${hostname}`)}&hl=en&filter=0`;
      const observedAt = new Date().toISOString();
      let response: Response;
      try {
        response = await context.fetch(sourceUrl, {
          headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; SEO-Crawl-Audit/0.10; +https://github.com/MelnixDev/seo-crawl-audit)" },
          redirect: "follow",
          ...(context.signal ? { signal: context.signal } : {}),
        });
      } catch {
        return googleEstimateUnavailable(sourceUrl, observedAt, { en: "Google site search could not be reached.", uk: "Не вдалося виконати Google site-пошук." });
      }
      if (!response.ok) return googleEstimateUnavailable(sourceUrl, observedAt, { en: `Google site search returned HTTP ${response.status}.`, uk: `Google site-пошук повернув HTTP ${response.status}.` });
      const html = await response.text();
      if (html.length > 2 * 1024 * 1024) return googleEstimateUnavailable(sourceUrl, observedAt, { en: "Google's response exceeded the 2 MiB safety limit.", uk: "Відповідь Google перевищила безпечний ліміт 2 МіБ." });
      const value = googleResultCount(html);
      if (value === null) return googleEstimateUnavailable(sourceUrl, observedAt, { en: "Google did not expose a result count, possibly because of consent or automated-request protection.", uk: "Google не показав кількість результатів, можливо через запит згоди або захист від автоматичних запитів." });
      return [{
        id: "search.google-site-estimate",
        label: { en: "Google site: estimate", uk: "Приблизно в Google (site:)" },
        value,
        unit: "count",
        source: { id: "google-site-search", label: "Google site:", url: sourceUrl },
        observedAt,
        confidence: "low",
        status: "estimate",
        detail: { en: "Approximate public `site:` result count. It is not authoritative Search Console index coverage.", uk: "Приблизна публічна кількість результатів `site:`. Це не точні дані індексації Search Console." },
      }];
    },
  };
}

function unavailable(id: string, label: SiteMetric["label"], sourceUrl: string, observedAt: string, status: SiteMetric["status"], detail: { en: string; uk: string }): SiteMetric {
  return { id, label, value: null, unit: "date", source: { id: "rdap", label: "RDAP", url: sourceUrl }, observedAt, confidence: "high", status, detail };
}

function dateMetric(id: string, label: SiteMetric["label"], value: string | null, sourceUrl: string, observedAt: string): SiteMetric {
  return value
    ? { id, label, value, unit: "date", source: { id: "rdap", label: "RDAP", url: sourceUrl }, observedAt, confidence: "high", status: "available" }
    : unavailable(id, label, sourceUrl, observedAt, "unavailable", { en: "The registry did not publish this date.", uk: "Реєстр не опублікував цю дату." });
}

function eventDate(events: unknown, actions: readonly string[]): string | null {
  if (!Array.isArray(events)) return null;
  for (const event of events as RdapEvent[]) {
    if (typeof event.eventAction === "string" && actions.includes(event.eventAction.toLowerCase()) && typeof event.eventDate === "string") return event.eventDate;
  }
  return null;
}

function registrarName(entities: unknown): string | null {
  if (!Array.isArray(entities)) return null;
  const registrar = (entities as RdapEntity[]).find((entity) => Array.isArray(entity.roles) && entity.roles.includes("registrar"));
  if (!registrar || !Array.isArray(registrar.vcardArray) || !Array.isArray(registrar.vcardArray[1])) return null;
  const name = registrar.vcardArray[1].find((entry: unknown) => Array.isArray(entry) && entry[0] === "fn");
  return Array.isArray(name) && typeof name[3] === "string" ? name[3] : null;
}

function providerFailure(sourceUrl: string, observedAt: string, status: "unavailable" | "error", detail: { en: string; uk: string }): SiteMetric[] {
  return [
    unavailable("domain.registration-date", { en: "Domain registration date", uk: "Дата реєстрації домену" }, sourceUrl, observedAt, status, detail),
    unavailable("domain.expiration-date", { en: "Domain expiration date", uk: "Дата завершення реєстрації" }, sourceUrl, observedAt, status, detail),
    { ...unavailable("domain.registrar", { en: "Registrar", uk: "Реєстратор" }, sourceUrl, observedAt, status, detail), unit: "text" },
  ];
}

/** Creates an optional public RDAP provider. It sends only the site's hostname. */
export function createRdapDomainProvider(options: RdapProviderOptions = {}): SiteMetricProvider {
  const endpoint = (options.endpoint ?? "https://rdap.org/domain/").replace(/\/*$/, "/");
  return {
    id: "rdap",
    async collect(context: SiteMetricProviderContext): Promise<SiteMetric[]> {
      const hostname = new URL(context.snapshot.siteUrl).hostname;
      const sourceUrl = `${endpoint}${encodeURIComponent(hostname)}`;
      const observedAt = new Date().toISOString();
      let response: Response;
      try {
        response = await context.fetch(sourceUrl, { headers: { accept: "application/rdap+json, application/json" }, redirect: "follow", ...(context.signal ? { signal: context.signal } : {}) });
      } catch {
        return providerFailure(sourceUrl, observedAt, "error", { en: "The public RDAP service could not be reached.", uk: "Не вдалося підключитися до публічного сервісу RDAP." });
      }
      if (response.status === 404) return providerFailure(sourceUrl, observedAt, "unavailable", { en: "No public RDAP record was found for this domain.", uk: "Публічний запис RDAP для цього домену не знайдено." });
      if (!response.ok) return providerFailure(sourceUrl, observedAt, "error", { en: `RDAP returned HTTP ${response.status}.`, uk: `RDAP повернув HTTP ${response.status}.` });
      const text = await response.text();
      if (text.length > 1024 * 1024) return providerFailure(sourceUrl, observedAt, "error", { en: "The RDAP response exceeded the 1 MiB safety limit.", uk: "Відповідь RDAP перевищила безпечний ліміт 1 МіБ." });
      let record: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid RDAP object");
        record = parsed as Record<string, unknown>;
      } catch {
        return providerFailure(sourceUrl, observedAt, "error", { en: "The RDAP service returned invalid JSON.", uk: "Сервіс RDAP повернув некоректний JSON." });
      }
      const registrar = registrarName(record.entities);
      return [
        dateMetric("domain.registration-date", { en: "Domain registration date", uk: "Дата реєстрації домену" }, eventDate(record.events, ["registration"]), sourceUrl, observedAt),
        dateMetric("domain.expiration-date", { en: "Domain expiration date", uk: "Дата завершення реєстрації" }, eventDate(record.events, ["expiration"]), sourceUrl, observedAt),
        registrar
          ? { id: "domain.registrar", label: { en: "Registrar", uk: "Реєстратор" }, value: registrar, unit: "text", source: { id: "rdap", label: "RDAP", url: sourceUrl }, observedAt, confidence: "high", status: "available" }
          : { ...unavailable("domain.registrar", { en: "Registrar", uk: "Реєстратор" }, sourceUrl, observedAt, "unavailable", { en: "The registry did not publish a registrar name.", uk: "Реєстр не опублікував назву реєстратора." }), unit: "text" },
      ];
    },
  };
}

/** Combines deterministic crawl metrics with explicitly selected external providers. */
export async function collectSiteMetrics(snapshot: SnapshotV2, options: CollectSiteMetricsOptions = {}): Promise<SiteMetrics> {
  const local = buildSiteMetrics(snapshot);
  const context: SiteMetricProviderContext = { snapshot, fetch: options.fetch ?? globalThis.fetch, ...(options.signal ? { signal: options.signal } : {}) };
  const external = await Promise.all((options.providers ?? []).map(async (provider) => {
    try {
      return await provider.collect(context);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      return [{
        id: `provider.${provider.id}`,
        label: { en: `${provider.id} data`, uk: `Дані ${provider.id}` },
        value: null,
        unit: "text" as const,
        source: { id: provider.id, label: provider.id },
        observedAt: new Date().toISOString(),
        confidence: "low" as const,
        status: "error" as const,
        detail: { en: error instanceof Error ? error.message : "The provider failed.", uk: "Постачальник даних завершився з помилкою." },
      }];
    }
  }));
  const externalMetrics = external.flat();
  const replacements = new Map(externalMetrics.map((metric) => [metric.id, metric]));
  const localIds = new Set(local.metrics.map((metric) => metric.id));
  return {
    ...local,
    metrics: [
      ...local.metrics.map((metric) => replacements.get(metric.id) ?? metric),
      ...externalMetrics.filter((metric) => !localIds.has(metric.id)),
    ],
  };
}
