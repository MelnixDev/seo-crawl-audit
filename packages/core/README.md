# @seo-crawl-audit/core

The local-first crawl, snapshot, audit, diff, and HTML report engine used by
[SEO Crawl Audit](https://github.com/MelnixDev/seo-crawl-audit).

The package performs all work locally and does not send crawl data to an
external service.

This is currently a private npm workspace package used to maintain a strict
boundary between the engine, CLI, and GitHub Action. It is not published as a
standalone npm dependency. The documented imports are for contributors and
workspace development; end users should install the self-contained
`seo-crawl-audit` CLI.

Use the root export for the stable application API:

```ts
import { audit, diff, planScan, renderReport, scan } from "@seo-crawl-audit/core";
```

Use `@seo-crawl-audit/core/node` for config, snapshot, report, and checkpoint
file adapters. Raw parsers and crawler helpers are intentionally not public.

See the [public API guide](../../docs/public-api.md) and
[architecture notes](../../docs/architecture.md).
