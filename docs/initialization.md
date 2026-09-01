# Project initialization

`seo-audit init` creates a safe starting configuration for a repository. It
does not crawl the site and does not require an account, API key, or hosted
service.

```bash
npx seo-crawl-audit init https://example.com/
```

Interactive setup asks for the full site URL and whether to create a GitHub
Actions workflow. For reproducible non-interactive setup, provide the choices
as flags:

```bash
npx seo-crawl-audit init https://example.com/ \
  --workflow scheduled \
  --yes
```

## Generated files

### `seo-audit.config.json`

The generated configuration uses the public JSON Schema and conservative
crawler defaults:

- sitemap discovery is automatic;
- at most 100 pages are scanned;
- concurrency is 5;
- request starts are separated by 100 milliseconds per origin;
- requests time out after 10 seconds;
- `robots.txt` is respected;
- query-string variants are excluded;
- redirects are limited to 10;
- each HTML response is limited to 5 MiB;
- new error-level regressions have a zero budget.

Edit the generated file when the site needs a longer delay, a custom sitemap,
rule suppressions, severity overrides, or report branding. CLI flags still
take precedence over the file.

Use `--config <path>` to create the configuration at another path. Relative
paths are resolved inside the initialized project directory.

### `.gitignore`

The command recommends ignoring runtime-only files:

```gitignore
.seo-audit.checkpoint.ndjson
.seo-audit/history/
seo-audit-report.html
seo-audit-report.html.json
```

It intentionally does not ignore `.seo-audit.json`. A production baseline can
be committed when a repository uses regression checks. Existing `.gitignore`
content is preserved and missing recommendations are appended only after
confirmation, with `--yes`, or with `--force`.

### `.github/workflows/seo-audit.yml`

The workflow is optional. Select one mode with `--workflow`:

- `none` creates no workflow;
- `manual` runs only from the GitHub Actions **Run workflow** button;
- `scheduled` runs every Monday at 06:00 UTC and can also be started manually;
- `pull-request` compares a preview deployment with a committed production
  baseline for each pull request.

Manual and scheduled modes read the target URL from `seo-audit.config.json`.
They are useful when content is published through a CMS or another process
that does not create pull requests. Reports are retained as workflow
artifacts; no crawl data is sent to a project-owned server.

Pull-request mode requires two repository preparations:

1. Run `seo-audit scan` against production and commit `.seo-audit.json`.
2. Set the GitHub Actions repository variable `SEO_AUDIT_PREVIEW_URL` to the
   preview deployment URL.

The generated workflow validates both requirements before starting the scan.

## Existing-file safety

`init` compares generated content with files already on disk:

- identical files are reported as `unchanged`;
- protected files with different content are reported as `skipped` in a
  non-interactive run;
- an interactive run asks before replacing each protected file;
- `--force` is the only non-interactive option that replaces protected files;
- `--yes` accepts safe defaults and `.gitignore` additions, but does not replace
  an existing config or workflow.

This makes the command safe to run again after upgrading the CLI.

## Options

```text
seo-audit init [url]

--directory <path>  Initialize another project directory
--config <path>     Choose the generated config path
--workflow <mode>   none, manual, scheduled, or pull-request
--yes               Accept safe defaults without prompting
--force             Replace protected generated files
--json              Print a machine-readable result
```

The URL must include `http://` or `https://`. When it is omitted in an
interactive terminal, `init` asks for it.

## Next step

Review the configuration, then create the first local baseline and report:

```bash
seo-audit scan
```

The URL is read from `seo-audit.config.json`, so it does not need to be repeated.
