# Changelog

## 0.5.0 — 2026-08-02

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
