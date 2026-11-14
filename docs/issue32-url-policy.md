# Issue 32: URL path preservation — implementation plan and acceptance

Status: implementation included in the 0.17.3 release candidate. Issue: https://github.com/MelnixDev/seo-crawl-audit/issues/32

1. Preserve meaningful path slashes by default. Add `trailingSlash: preserve | strip` to validated config, CLI and MCP; Action uses the same config file. Preserve sitemap index/file URLs independently of page traversal policy.
2. Keep evidence separate from traversal: `page.url` is the actual requested URL after the explicit traversal policy; final URLs retain the observed response path/query. Canonical and hreflang resolve against the actual document base and retain their paths/query even with strip traversal. Redirect hops remain unchanged. No new canonical-target network requests are introduced.
3. Detect a canonical target redirect only when its exact target was checked; include requested/final/Location evidence, deduplicate aliases of the same observed document, and avoid claiming that a 301 proves Google exclusion. Redirect aliases must not produce critical duplicate-title findings as distinct indexable resources.
4. Legacy snapshots without policy are annotated as strip observations; original paths are never reconstructed from guesswork. A new observation marker and checkpoint page schema prevent reusing old stripped observations. Policy participates in hashes, MCP confirmation binding and checkpoint identity. Changed URL/observation policy makes comparisons incomplete: no false page-missing regression or claimed resolution solely due to changed keys; history includes an explicit warning/unverified findings.
5. Verify HTTP fixtures for slash-required and slashless sites, correct versus genuinely redirecting sitemap URLs, sitemap indexes with slash paths, raw canonical-to-redirect mismatch, pagination, renderer output, robots, legacy snapshots and checkpoints, CLI/MCP/config validation. Run full lint/build, core/app coverage and package contracts before PR.

Live preflight on Balachky was read-only, not a site audit: sampled clean film/category URLs are slashless 200 with slashless canonical; slash variants redirect to them. This is the opposite policy to the original reproduction, so its mass false-positive scenario is not established for Balachky. The generic auditor bug and pass-gen.app evidence remain valid.

Release boundary: 0.17.3 synchronizes the CLI, native client packages and versioned Action. It does not change Balachky production or run the pending new site audit.

Packaging note: CLI esbuild output uses UTF-8 rather than ASCII escaping of localized strings. This preserves runtime text and keeps the added URL logic within the existing 500 KiB CLI budget; no size thresholds are raised.
