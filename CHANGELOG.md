# Changelog

## 0.7.2 — 2026-08-30

- replaced the compressed report preview images with the original full-resolution
  PNG captures in both the repository and npm README;
- clarified that `@seo-crawl-audit/core` is currently an internal workspace
  package rather than a separately published npm package;
- refreshed the release documentation without changing CLI behavior, SnapshotV2,
  rule IDs, fingerprints, or report data contracts.

## 0.7.1 — 2026-08-29

- added a complete Ukrainian reference for all 46 built-in and regression rules;
- linked English and Ukrainian rule documentation from bilingual HTML reports;
- kept both language references aligned with the built-in registry through a
  documentation contract test;
- preserved SnapshotV2, rule IDs, fingerprints, and rule-set version `1.1.0`.

## 0.7.0 — 2026-08-28

- added production-to-preview regression comparisons with protected preview
  headers that are never persisted in outputs;
- grouped findings by inferred page templates and added interactive template
  analytics to the local HTML report;
- added local SnapshotV2 history, trend reports, and comparisons between saved
  runs;
- exposed `groupIssuesByTemplate()` and `buildHistorySeries()` through the core
  workspace API.

## 0.6.0 — 2026-08-16

- added reusable two-phase `planScan()` and `scan()` workflows without
  repeating robots or sitemap requests;
- made breadth-first crawl scheduling deterministic across concurrency levels;
- moved config, snapshot, report, and durable NDJSON checkpoint files behind
  the `@seo-crawl-audit/core/node` subpath;
- narrowed the core root to a stable typed application API and immutable rule
  metadata;
- split current and regression evaluators while preserving rule IDs and issue
  fingerprints;
- made partial diffs coverage-aware through `DiffResult.complete`;
- made cancellation return valid partial snapshots, flush checkpoints, and use
  CLI exit code `130` after SIGINT or SIGTERM;
- split the CLI into typed parser, UI, and command handlers that use only public
  core APIs;
- isolated a testable GitHub Action runner and kept the Action repository-only;
- enabled strict TypeScript, ESLint boundaries, coverage thresholds, clean
  package smoke tests, and a nine-combination platform compatibility matrix;
- kept SnapshotV2, config precedence, CLI flags, normal exit codes, HTML/JSON
  contracts, and all existing local SEO checks compatible.

## 0.5.0 — 2026-08-16

- migrated the engine and CLI to TypeScript npm workspaces;
- added the stable core API, SnapshotV2, v1 migration, config schema, and
  deterministic configuration hashes;
- added a bounded worker pool, per-origin pacing, retry/backoff, `Retry-After`,
  redirect tracking, cancellation, size limits, and injectable runtime adapters;
- replaced sitemap regular expressions with validated XML parsing and gzip
  support;
- expanded the registry to more than 40 explicit audit and regression rules;
- added stable fingerprints, owners, remediation, suppressions, severity
  overrides, budgets, and issue lifecycle;
- rebuilt HTML reports with lifecycle tabs, filters, CSV export, print layout,
  local branding, partial state, and improved empty states;
- added a self-contained GitHub Action with JSON/HTML outputs, annotations, job
  summary, and configurable failure threshold;
- added local fixtures for retries, redirects, gzip, cancellation, migration,
  resume, rules, HTML safety, Action execution, and a 10k-page memory smoke test;
- expanded CI to Node.js 20, 22, and 24 on Linux, macOS, and Windows.

## 0.1.2

- added request pacing, checkpoint resume, partial reports, automatic sitemap
  discovery, interactive page limits, and the GitHub Pages report example.
