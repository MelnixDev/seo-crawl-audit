# Site Metrics

The HTML report separates concrete SEO issues from descriptive site metrics.
Metrics never contribute to an opaque score and always include their source,
observation time, confidence, and availability state.

## Local metrics

Every report can derive page, sitemap, indexability, image, Product structured
data, link, crawl-depth, transfer, timing, and HTTP-status metrics from its
SnapshotV2. This is deterministic, offline, and does not make extra requests.

## Optional public data

The local browser interface can optionally request public Google `site:` and
RDAP data. It sends only the audited hostname and can add:

- a low-confidence approximation of the pages Google exposes for a public
  `site:` query;
- the domain registration date, expiration date, and registrar from RDAP.

The checkbox is visible before the scan and can be disabled. Google may hide
the result count behind a consent page or automated-request protection. When
that happens, the local interface keeps the value unavailable and offers a
Google `site:` link plus an optional field for entering the visible count
manually.

Missing or failed external values remain visibly `unavailable` or `error`.
They are never replaced with invented values or presented as exact search-index
counts.

The core API accepts explicit providers:

```js
import {
  collectSiteMetrics,
  createGoogleSiteEstimateProvider,
  createRdapDomainProvider,
} from "@seo-crawl-audit/core";

const metrics = await collectSiteMetrics(snapshot, {
  providers: [
    createGoogleSiteEstimateProvider(),
    createRdapDomainProvider(),
  ],
  fetch,
  signal,
});
```

Provider credentials, if authoritative search integrations are added later,
must stay in local environment variables or adapters. They must not be written
to snapshots, reports, history, checkpoints, logs, or telemetry.

## Search-engine counts

The report keeps three different concepts separate:

- **Estimated indexable pages** is derived locally from crawlable pages and the
  sitemap size. It is not a Google metric.
- **Google `site:` estimate** is a best-effort public approximation. It is
  labelled `Estimate` / `Орієнтовно`, has low confidence, and may be rounded,
  personalized, rate-limited, or unavailable.
- **Indexed by Google** is reserved for an authoritative Google Search Console
  connection and remains `Not connected` / `Не підключено` without one.

The public approximation uses one request per report collection; it is never
treated as exact index coverage. Bing, DuckDuckGo, and other result pages are
not queried. Future authoritative integrations remain optional and must clearly
distinguish verified values from public estimates and unavailable data.
