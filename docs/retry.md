# Retry failed URLs

Use a saved snapshot instead of rediscovering the site. No additional links or sitemap URLs are added to the retry frontier. Robots.txt is refreshed when the selection is nonempty. Normal redirects and per-request retry policy still apply.

## CLI

```sh
seo-audit retry baseline.json --status 503 --all --output retry.json
seo-audit retry part-1.json part-2.json --status 429,503 --pages 100
seo-audit retry baseline.json --retry-network-errors --status 503
```

Without `--status`, retry HTTP 400–599 and previous network failures. With a status filter, network failures are excluded unless `--retry-network-errors` is supplied. Robots exclusions are not selected as failures. Deliberate 404/410 responses may be correct; retry selection does not imply they should be restored.

The default budget is bounded by the saved/current configuration, normally 100. `--all` explicitly selects every failing URL. `--pages` limits the selection; it never expands it to healthy pages. Default files are `.seo-audit.retry.json`, `seo-audit-retry.html` and a separate retry checkpoint. Repeat the same command to resume an interrupted retry. A completed checkpoint is cleared; a later invocation checks the URLs again.

## Codex / MCP

Plan first:

```json
{"retryFrom":["part-1.json","part-2.json"],"retryStatuses":[503],"maxPages":181}
```

Then call `seo_audit_scan` with the same selection/load parameters, plus separate `output`, `report`, and optional `checkpoint` paths. Bound native clients must also supply the configured `workspace`. `retryFrom` accepts one relative snapshot path or up to 1000 paths inside the workspace. `retryNetworkErrors` overrides the default network-failure selection. Existing eight-tool discovery is unchanged.

The plan returns the selected count. Scan returns `retry.selected`, `retry.checked`, `retry.remaining`, and `outcome.recovered`, `outcome.stillFailing`, `outcome.blocked`. A successful selection of zero produces empty subset artifacts without website requests. Scans above 5000 retain parameter-bound confirmation, and the selection participates in that identity. MCP retains its 50000-page per-scan ceiling.

## Scope and interpretation

Only selected URLs are fetched as pages. Source snapshots are never modified; output/report/checkpoint paths that alias a source are rejected. Sources must have one origin, selected URLs cannot leave it, and overlapping observations use the latest snapshot timestamp. Query strings and observed trailing slashes are preserved. An old snapshot that already lost those details cannot restore them.

The output is explicitly a targeted subset, not an updated full-site baseline. The HTML report shows this boundary; re-rendering a saved retry snapshot preserves it. Comparison may resolve findings only on checked URLs and never marks unchecked pages missing or resolved. A blocked URL is not counted as recovered.

A repeated 200 establishes availability at the time of the retry. It does not prove why an earlier 503 happened or establish indexing recovery. No automatic production changes or Search Console submissions occur.
