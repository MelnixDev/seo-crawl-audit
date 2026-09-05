# Site Metrics

The HTML report separates concrete SEO issues from descriptive site metrics.
Metrics never contribute to an opaque score and always include their source,
observation time, confidence, and availability state.

## Local metrics

Every report can derive page, sitemap, indexability, image, Product structured
data, link, crawl-depth, transfer, timing, and HTTP-status metrics from its
SnapshotV2. This is deterministic, offline, and does not make extra requests.

## Public domain data

The local browser interface can optionally request public RDAP data. It sends
only the audited hostname to the public RDAP endpoint and can add the domain
registration date, expiration date, and registrar to the report. The checkbox
is visible before the scan and can be disabled.

Missing or failed external values remain visibly `unavailable` or `error`.
They are never replaced with invented values or presented as exact search-index
counts.

The core API accepts explicit providers:

```js
import {
  collectSiteMetrics,
  createRdapDomainProvider,
} from "@seo-crawl-audit/core";

const metrics = await collectSiteMetrics(snapshot, {
  providers: [createRdapDomainProvider()],
  fetch,
  signal,
});
```

Provider credentials, if authoritative search integrations are added later,
must stay in local environment variables or adapters. They must not be written
to snapshots, reports, history, checkpoints, logs, or telemetry.

## Search-engine counts

SEO Crawl Audit does not scrape Google, Bing, DuckDuckGo, or other result pages
to manufacture an unreliable `site:` count. Search engines may return rounded,
personalized, rate-limited, or absent counts. Future authoritative integrations
will therefore be optional and clearly distinguish verified values from public
estimates and unavailable data.
