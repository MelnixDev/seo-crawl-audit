# Handoff: local comparison workflow

Version `0.13.0` is published. The `feat/0.14-regression-workflow` branch adds
local comparisons; it is not a released feature until its release checks,
merge, and publication complete.

The comparison must remain local-first and exact-site. It must not issue page
requests, alter SnapshotV2 or fingerprints, overwrite the latest scan report,
or move the GitHub Action `v0` tag without separate approval. Source changes
are committed logically; generated bundles belong in the release commit.

Before release, verify the browser picker in English and Ukrainian, worker
cancellation and crash recovery, catalogue integrity, 50k memory/report
performance, package imports, npm audit, and all remote CI jobs. The large
comparison HTML remains self-contained, so record its output size and browser
limitations honestly. Use only permitted sites for dogfood. Manual README
screenshots follow after the UI is stable.
