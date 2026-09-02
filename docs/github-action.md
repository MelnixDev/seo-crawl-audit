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
- `headers-env` — optional name of a JSON environment variable containing
  same-origin request headers.

The Action writes HTML and JSON, adds error annotations for critical findings,
creates a job summary, and returns a failing exit status at the configured
threshold. `actions/upload-artifact` retains the two local output files.

The Action uses only the public core root and `/node` file adapters. A partial
scan produces an incomplete comparison: regressions found on checked pages are
kept, but unchecked pages are not marked resolved or missing.

Use `MelnixDev/seo-crawl-audit@v0` for the latest compatible `0.x` Action
release. `v0` is moved only after the corresponding versioned release has
passed its clean-install verification. The Action bundle is committed to the
repository and is not published as a separate npm package.

## Generate a workflow

`seo-audit init` can create `.github/workflows/seo-audit.yml` without copying
YAML by hand:

```bash
seo-audit init https://example.com/ --workflow scheduled --yes
```

Available modes:

- `manual` uses `workflow_dispatch` and runs only when requested;
- `scheduled` runs every Monday at 06:00 UTC and also supports manual runs;
- `pull-request` reads the preview URL from the `SEO_AUDIT_PREVIEW_URL`
  repository variable and compares it with committed `.seo-audit.json`;
- `none` does not create a workflow.

Manual and scheduled workflows audit the URL from `seo-audit.config.json`, so
they work for CMS publishing and other content changes that do not pass through
a pull request. Every generated workflow uploads the HTML report and JSON
summary with `if: always()`, including failed audits.

See the [project initialization guide](initialization.md) for overwrite safety,
generated defaults, and pull-request prerequisites.

For a protected site, keep the JSON header object in a GitHub Actions secret
and pass only the environment variable name to `headers-env`. See the
[authenticated scans guide](authenticated-scans.md) for a complete example and
the origin isolation rules.
