# GitHub Action

The Action runs entirely inside the GitHub runner and does not upload crawl
results to a project-owned server.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: MelnixDev/seo-crawl-audit@v0
    id: seo
    with:
      url: https://preview.example.com/
      baseline: .seo-audit.json
      config: seo-audit.config.json
      fail-on: error
      report: seo-audit-report.html
  - uses: actions/upload-artifact@v4
    with:
      name: seo-crawl-audit-report
      path: |
        ${{ steps.seo.outputs.report }}
        ${{ steps.seo.outputs.summary }}
```

Inputs:

- `url` — site URL; overrides the config and baseline URL;
- `baseline` — optional SnapshotV1 or SnapshotV2 file;
- `config` — configuration path;
- `fail-on` — `error`, `warning`, or `none`;
- `report` — HTML output path.

The Action writes HTML and JSON, adds error annotations for critical findings,
creates a job summary, and returns a failing exit status at the configured
threshold. `actions/upload-artifact` retains the two local output files.
