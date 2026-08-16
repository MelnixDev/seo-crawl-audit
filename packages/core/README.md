# @seo-crawl-audit/core

The local-first crawl, snapshot, audit, diff, and HTML report engine used by
[SEO Crawl Audit](https://github.com/MelnixDev/seo-crawl-audit).

The package performs all work locally and does not send crawl data to an
external service.

Use the root export for the stable application API:

```ts
import { audit, diff, planScan, renderReport, scan } from "@seo-crawl-audit/core";
```

Use `@seo-crawl-audit/core/node` for config, snapshot, report, and checkpoint
file adapters. Raw parsers and crawler helpers are intentionally not public.

See the [public API guide](../../docs/public-api.md) and
[architecture notes](../../docs/architecture.md).
