# Handoff: report stabilization and local trends

Versions through `0.14.1` are published. Local two-run comparison is available
in the local UI and CLI, and large standalone comparison reports are smaller.
`0.15.0` adds bounded multi-run trends across saved runs.

Both cycles remain local-first and exact-site. They must not request site pages,
alter SnapshotV2 or fingerprints, overwrite the latest scan report, or move the
GitHub Action `v0` tag without separate approval. Generated bundles belong in
the release commit.

The 0.14.0 synthetic 50k comparison baseline was about 171 MiB HTML,
890 MiB sampled peak heap, and 1759 MiB sampled RSS. Preserve EN/UK, exports,
filtering, print, package contracts and browser security while reducing size.
For trends, read at most two snapshots at a time and keep the browser payload
compact. Use only saved permitted runs for dogfood. Manual README screenshots
follow after the UI is stable.
