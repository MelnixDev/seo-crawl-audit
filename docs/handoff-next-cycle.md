# Handoff: SEO Crawl Audit 0.11.0

The current stable release is `0.10.3`. The next cycle focuses on scale and
local-product reliability; it does not add SEO rules.

## Required delivery

1. Refactor the local UI into bundled template/runtime/controller modules.
2. Add Quick (100), Standard (1,000), Full sitemap, and Custom scan profiles.
3. Require explicit confirmation for scans above 5,000 discovered URLs.
4. Support up to 50,000 pages in the local UI and MCP.
5. Keep the NDJSON page journal valid until snapshot and report writes succeed.
6. Persist external metrics in `.seo-audit.metrics.json`, separate from
   SnapshotV2, with source, observation time, and stale-state handling.
7. Optimize self-contained reports for at least 50,000 issues.

## Compatibility and safety

- Keep HTTP as the default and Playwright opt-in.
- Do not change SnapshotV2, existing issue IDs, fingerprints, CLI flags, JSON
  keys, or standard exit codes.
- Keep the server loopback-only with CSP and same-origin request checks.
- Never treat crawlable-page estimates or Google `site:` results as exact index
  coverage.
- Do not introduce accounts, cloud services, billing, telemetry, or an opaque
  score.

## Acceptance target

The final candidate must pass the full quality gate, package smoke tests, a 50k
fixture benchmark below 900 MiB peak heap, interruption/resume scenarios, and a
permitted-site dogfood run. Generated bundles belong only in the release commit.
