# Core public API

`@seo-crawl-audit/core` contains the local engine used by the CLI and GitHub
Action.

```ts
import {
  audit,
  diff,
  migrateSnapshot,
  renderReport,
  scan,
} from "@seo-crawl-audit/core";
```

## `scan(config, options)`

```ts
const result = await scan(
  {
    url: "https://example.com/",
    maxPages: 100,
    delay: 100,
    concurrency: 5,
  },
  {
    signal: abortController.signal,
    fetch: globalThis.fetch,
    storage,
    logger: console,
    onEvent(event) {
      if (event.type === "progress") {
        console.log(event.completed, event.total);
      }
    },
  },
);
```

Options support an injectable `fetch`, `AbortSignal`, logger, storage adapter,
and event callback. The result includes the compatibility crawl fields and a
stable `snapshot` property.

## `audit(snapshot, ruleSet)`

Returns current issues. `ruleSet` can limit enabled rules, override severity,
and supply dated suppressions.

## `diff(previousSnapshot, currentSnapshot, ruleSet)`

Returns `newIssues`, `ongoingIssues`, `resolvedIssues`, `unchangedIssues`, and
exceeded regression budgets.

## `renderReport(reportData, options)`

Returns a self-contained HTML string. Branding, CSV export, and print layout
remain local and free.

## `migrateSnapshot(input)`

Reads SnapshotV2 directly and upgrades baseline schema v1 automatically.
