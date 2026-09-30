# Local issue trends

The loopback-only UI's **History / Історія** section can chart observations
from saved scans. It reads local SnapshotV2 files; it does not request pages,
contact a search engine, or claim that a URL is indexed by Google.

Choose the latest 20 runs (default), or explicitly select 50 or 100. The chart
shows errors, warnings, or informational findings. Choose a rule ID or a page
template for a focused series. Click a point to compare it with its adjacent
saved run using the existing comparison report.

Solid segments connect comparable runs. Dashed segments flag incomplete
coverage, changed configuration, rule set, URL policy, or a missing/corrupt
run. A lower issue count across a dashed segment is not evidence of an SEO
improvement. Resolved counts are reported only when the current crawl includes
enough evidence to verify the change; unknown resolutions remain separate.

All selected runs are evaluated with the latest selected run's rule policy at
one evaluation time. Page templates are inferred from that latest run and held
fixed across the selected range; unmatched historical URLs are `Other`.
Suppressions are re-evaluated at analysis time, including expiry.

For automation:

```bash
seo-audit history https://example.com/ --json --trend-limit 20
seo-audit history https://example.com/ --json --trend-limit 100
```

`history --json` retains its previous fields and adds `trendSummary`.
`seo_audit_history` in MCP returns the same versioned summary without absolute
file paths or full snapshots. The local UI exposes the versioned result at
`GET /api/history/trend/result` after a calculation completes. Only one
adjacent snapshot pair is retained during calculation; the UI worker can be
cancelled without deleting the last completed comparison.
