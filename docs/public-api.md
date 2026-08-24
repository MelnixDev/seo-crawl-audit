# Core public API

`@seo-crawl-audit/core` is the typed, local engine shared by the CLI and
GitHub Action. The root export is intentionally small and stable. Node.js file
adapters live in the separate `@seo-crawl-audit/core/node` subpath.

```ts
import {
  audit,
  diff,
  getRuleDefinitions,
  migrateSnapshot,
  planScan,
  renderReport,
  scan,
} from "@seo-crawl-audit/core";
```

Raw fetchers, parsers, crawler helpers, and filesystem functions are not root
exports. Node.js 20.19 or newer is required.

## `planScan(config, options?)`

Planning normalizes configuration and the start URL, reads `robots.txt`, finds
and parses the sitemap or sitemap index, and returns a versioned `ScanPlan`.
It does not request HTML pages.

```ts
const controller = new AbortController();
const plan = await planScan(
  { url: "https://example.com/", sitemap: "auto", maxPages: 100 },
  {
    signal: controller.signal,
    fetch: globalThis.fetch,
    onEvent(event) {
      if (event.type === "sitemap") {
        console.log(event.candidateCount);
      }
    },
  },
);
```

`candidateCount` is `null` when no sitemap exists. In that case `scan()` uses
breadth-first same-origin link discovery.

## `scan(configOrPlan, options?)`

Passing config is the convenient one-phase form; `scan()` calls `planScan()`
internally. Passing a prepared plan avoids repeating robots and sitemap
requests, which is useful when a UI needs to show a page-limit choice first.

```ts
import { createFileCheckpointStore } from "@seo-crawl-audit/core/node";

const result = await scan(plan, {
  limit: 100,
  signal: controller.signal,
  fetch: globalThis.fetch,
  checkpointStore: createFileCheckpointStore(".seo-audit.checkpoint.ndjson"),
  onEvent(event) {
    if (event.type === "progress") {
      console.log(`${event.completed}/${event.total}`);
    }
  },
});
```

Supported runtime injection points are `fetch`, `AbortSignal`, logger,
`onEvent`, and a typed checkpoint store. The engine is silent unless a logger
or event handler is provided.

The event union includes `plan-start`, `robots`, `sitemap`, `scan-start`,
`resume`, `page`, `retry`, `checkpoint`, `progress`, `complete`, and
`cancelled`. Event and storage callback failures reject the operation. Normal
page/network failures become `PageSnapshot.error` evidence.

Cancellation is a successful partial outcome, not invalid data. The returned
snapshot has `partial: true`, its completed pages remain usable, the checkpoint
is flushed and retained, and a `cancelled` event reports the actual page count.

## `audit(snapshot, ruleSet?)`

Returns current issues after applying enabled rules, severity overrides, and
unexpired suppressions. `getRuleDefinitions()` returns immutable metadata for
the built-in registry. Custom evaluators are not accepted.

## `diff(previous, current, ruleSet?)`

Returns `newIssues`, `ongoingIssues`, `resolvedIssues`, `unchangedIssues`,
`issues`, `budgetExceeded`, and `complete`.

If the current snapshot is partial or truncated, `complete` is `false`.
Regressions on pages that were actually checked are still returned, but
unchecked pages are not marked missing or resolved and site-wide absence/count
regressions are deferred.

## `renderReport(data, options?)`

Purely returns a self-contained HTML string. It does not import `fs` or write a
file. The report supports lifecycle tabs, filters, CSV export, print layout,
local branding, HTML-safe embedded JSON, an explicit incomplete-comparison
state, and an in-browser `English / Українська` selector. The selected language
applies to the complete interface, issue text, remediation, and CSV without
changing issue fingerprints or snapshot data.

## `migrateSnapshot(input)`

Validates and normalizes SnapshotV2 and upgrades baseline schema v1. SnapshotV2
JSON remains stable across the 0.6 architecture release.

## Node.js adapters

```ts
import {
  createFileCheckpointStore,
  findConfigFile,
  loadConfig,
  readSnapshot,
  writeReport,
  writeSnapshot,
} from "@seo-crawl-audit/core/node";
```

Snapshot and report writes use an atomic temporary-file rename. The NDJSON
checkpoint adapter serializes concurrent appends, reads compatible v1 headers,
deduplicates normalized URLs, ignores only an unfinished final record, and
rejects earlier corruption.

Successful pages are reused. Transient failures and HTTP 5xx pages are fetched
again on resume. Identity excludes page limit, concurrency, delay, rules, and
branding, so a step scan can continue from 100 to 200 to 300 pages without
discarding compatible results.

## Config schema

The package exposes `@seo-crawl-audit/core/config.schema.json` as well as
`validateConfig()` and `resolveConfig()`. Resolution order is CLI values,
config file, saved baseline, then safe defaults.
