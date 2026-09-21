# Handoff: SEO Crawl Audit 0.13.0

Version `0.12.0` is published. Page Explorer is complete and uses only
existing SnapshotV2 data without additional network requests.

## Required delivery

The implementation below is available on `feat/0.13-site-architecture` and has
passed local quality and Chromium checks. Release preparation and remote CI
remain separate from feature completion.

1. Add inlink counts and identify pages with weak internal-link support.
2. Show the source pages for broken internal links and redirecting links.
3. Add practical redirect-chain and crawl-depth tables with filtered exports.
4. Surface URL-template distributions without introducing an opaque score.
5. Reuse existing crawl data where possible and specify any necessary data-model
   additions before changing the stable snapshot contract.

## Compatibility and safety

- Keep HTTP as the default and Playwright opt-in.
- Do not change SnapshotV2, existing issue IDs, fingerprints, CLI flags, JSON
  keys, or standard exit codes.
- Keep the server loopback-only with CSP and same-origin request checks.
- Never describe observed crawl indexability as Google index coverage.
- Do not introduce accounts, cloud services, billing, telemetry, or an opaque
  score.

## Acceptance target

The final candidate must keep 50k reports responsive, preserve Page Explorer
compatibility, pass package smoke tests, and complete a permitted-site dogfood
run. Generated bundles belong only in the release commit.
