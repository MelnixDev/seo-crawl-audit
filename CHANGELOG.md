# Changelog

## 0.9.1 — 2026-09-04

- improved OpenCode compatibility by keeping MCP tool payloads in the standard
  text content field;
- added visible planning, robots, sitemap, retry, resume, cancellation, and
  live progress-bar status to CLI scans;
- kept `--json` stdout machine-readable by writing progress to stderr;
- preserved all existing CLI flags, SnapshotV2 data, MCP tool names, and issue
  fingerprints.

## 0.9.0 — 2026-09-04

- added a local STDIO MCP server bundled with the existing `seo-crawl-audit`
  npm package, without a hosted API or separate public package;
- added MCP tools for crawl planning, scanning, regression checks, snapshot
  comparison, filtered issue inspection, HTML reports, and rule discovery;
- added project-scoped `agent-init` setup for Codex, Claude Code, and OpenCode,
  including a portable SEO audit skill;
- restricted generated artifacts to the configured workspace and kept
  authenticated headers in named environment variables with same-origin
  isolation and separate checkpoint namespaces;
- added cancellation propagation, partial-result reporting, pagination, compact
  structured responses, and local artifact paths for agent workflows;
- added MCP, agent setup, authentication, package, and overwrite-safety tests;
- preserved SnapshotV2, rule IDs, fingerprints, rule-set version `1.1.0`, the
  existing CLI and Action contracts, and the local-first open-source model.

## 0.8.0 — 2026-09-02

- added `seo-audit init` for safe project configuration, `.gitignore`
  recommendations, and optional manual, scheduled, or pull-request workflows;
- added `seo-audit doctor` for local runtime, config, storage, homepage,
  robots.txt, and sitemap diagnostics without crawling linked HTML pages;
- added environment-based request headers to `doctor`, `scan`, and `check`, in
  addition to the existing production-versus-preview comparison;
- added protected-site support to the self-contained GitHub Action;
- restricted private headers to the configured site origin and isolated
  authenticated checkpoints without persisting secret values;
- moved npm publishing to GitHub Actions trusted publishing with OIDC and
  provenance, without a long-lived registry token;
- preserved SnapshotV2, rule IDs, fingerprints, config schema, report data,
  existing commands, and rule-set version `1.1.0`.

## 0.7.2 — 2026-08-31

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
