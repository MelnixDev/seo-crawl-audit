# Handoff: SEO Crawl Audit 0.12.0

The current stable release is `0.11.0`. Stabilization is completed before the
Page Explorer work and does not add SEO rules.

## Required delivery

1. Add a Pages / Сторінки report view for every checked URL.
2. Provide search, status/indexability/issue filters, deterministic sorting, and pagination.
3. Show an accessible on-demand page detail panel using existing SnapshotV2 fields.
4. Connect page rows with the existing Issues view and export filtered pages as CSV.
5. Keep the embedded payload compact and render only the visible page rows.
6. Verify the report with 50,000 pages and 50,000 issues in a real browser.

## Compatibility and safety

- Keep HTTP as the default and Playwright opt-in.
- Do not change SnapshotV2, existing issue IDs, fingerprints, CLI flags, JSON
  keys, or standard exit codes.
- Keep the server loopback-only with CSP and same-origin request checks.
- Never describe observed crawl indexability as Google index coverage.
- Do not introduce accounts, cloud services, billing, telemetry, or an opaque
  score.

## Acceptance target

The final candidate must pass the full quality gate, package smoke tests, a 50k
fixture benchmark below 900 MiB peak heap, Page Explorer browser benchmarks,
and a permitted-site dogfood run. Generated bundles belong only in the release commit.
