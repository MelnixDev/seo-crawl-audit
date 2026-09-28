# Compare local scan history

Run `seo-audit serve` and open **History / Історія**. Choose a **Before** and
**After** run for the exact same site URL, then select **Compare runs**. Saved
snapshots are re-evaluated locally; the comparison does not request any pages.
Selecting runs alone does not start a job. Scans and metric updates cannot run
concurrently with a comparison.

The result is independent from the latest scan report. You can open its
self-contained HTML report or download a short Markdown summary and grouped
CSV. The current scan baseline, report, and external metrics are not changed.
The background job can be cancelled; a previously completed comparison remains
available. Completed comparisons survive a local UI restart.

The report distinguishes **new**, **ongoing**, **resolved**, and **unchanged**
findings. A previous issue is not called resolved if the current URL was not
checked or a failed/blocked/non-HTML response gives insufficient evidence.
Such candidates are **unverified**. A partial or truncated run also warns that
the comparison is incomplete; a lower issue count is not proof of improvement
when coverage differs. Rules, severity overrides, and suppressions are
re-evaluated for both runs using the selected After run's policy and the time
of comparison. These totals are not immutable historical measurements.

Rule and page-template rows link to matching findings in the report. Template
inference uses URLs from both runs. For comparisons above 5,000 pages, the
Pages tab remains a URL list to keep the standalone report smaller; detailed
per-page fields remain available in the original scan report. CSV groups cover
all rules and templates, while Markdown lists the first ten of each. Spreadsheet
formula-like values are escaped in CSV.

CLI users can also compare two snapshot files:

```sh
seo-audit history --from before.snapshot.json --to after.snapshot.json --report comparison.html --json
```

The CLI retains its existing JSON fields and adds `comparisonSummary`.
Cross-site local history comparison is intentionally unsupported. No account,
cloud service, telemetry, or search-engine authorization is used.
