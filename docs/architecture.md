# 0.6 architecture

SEO Crawl Audit is split into three npm workspaces with one-way dependencies:

```text
CLI -----------------+
                     +--> public core application API
GitHub Action --------+    planScan / scan / audit / diff / renderReport
                                 |
                    +------------+------------+
                    |            |            |
               crawl engine   rule engine  report renderer
                    |            |            |
             injected runtime  built-ins    pure function

@seo-crawl-audit/core/node
    config and snapshot files
    atomic report writes
    durable NDJSON checkpoints
```

The domain layer owns snapshot, issue, fingerprint, and configuration models.
The application layer coordinates planning, scanning, auditing, and diffing.
The crawl layer owns deterministic breadth-first scheduling, HTTP policy,
robots, sitemap parsing, and HTML extraction. Rule evaluators produce findings;
one policy pipeline applies selection, severity, suppressions, fingerprints,
documentation links, and ordering. The report renderer accepts typed data and
has no filesystem dependency.

The CLI and Action import only the public core root and `/node` adapters. ESLint
enforces this boundary. The root does not expose crawler helpers or parsers.

## Determinism

Link discovery processes one breadth-first frontier at a time. URLs within a
frontier are sorted lexicographically, fetched through a bounded worker pool,
then their normalized links are merged before the next frontier starts. The
selected ordered page set therefore stays the same at concurrency 1, 5, or 10.

Every redirect hop passes through the per-origin request gate. Timeout, 429,
500, 502, 503, and 504 failures use bounded exponential backoff with jitter;
both forms of `Retry-After` are honored.

## Compatibility boundaries

- CLI commands, flags, JSON keys, and normal exit codes remain compatible.
- Interrupted CLI scans add exit code `130` after partial outputs are saved.
- SnapshotV2 remains the persisted schema; SnapshotV1 is migrated on read.
- Existing rule IDs and fingerprints remain stable.
- `DiffResult.complete` distinguishes full and coverage-aware partial diffs.
- The Action is distributed through the repository `v0` tag and is not an npm
  package.

## Privacy boundary

The engine has no accounts, API tokens, license checks, external result upload,
or telemetry. Crawl data stays in the caller's process and explicitly selected
local files.
