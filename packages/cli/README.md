# SEO Crawl Audit

Free, open-source, local-first SEO crawler and regression audit tool.

`seo-audit` crawls server-rendered pages, saves a versioned JSON snapshot,
finds concrete SEO problems, and detects regressions after a deployment. It
needs no account or API key. Page HTML is processed in memory; normalized
results stay in local JSON, checkpoint, CSV, and self-contained HTML files.

[Open the interactive example report](https://melnixdev.github.io/seo-crawl-audit/)
or [view its source file](examples/quotes-toscrape-report.html).

## Report preview

The report is a self-contained HTML file: open it locally, share it as an
artifact, or publish the same file on GitHub Pages. Charts and filters work
without a server.

### Overview and local history

![SEO Crawl Audit summary cards and local scan history](https://raw.githubusercontent.com/MelnixDev/seo-crawl-audit/main/docs/images/report-overview.jpg)

The overview keeps scan coverage, issue counts, and locally stored trends in
one place.

### Interactive issue analytics

![SEO Crawl Audit interactive issue statistics](https://raw.githubusercontent.com/MelnixDev/seo-crawl-audit/main/docs/images/report-analytics.jpg)

Select a severity, rule, lifecycle state, or page template to filter the issue
table immediately.

### English and Ukrainian reports

![SEO Crawl Audit issue table in Ukrainian](https://raw.githubusercontent.com/MelnixDev/seo-crawl-audit/main/docs/images/report-ukrainian.jpg)

The language switch translates the report UI and routes rule documentation to
the matching English or Ukrainian reference.

## Highlights

- automatic `robots.txt`, sitemap, sitemap-index, and gzip sitemap support;
- bounded concurrency with a per-origin request delay;
- retries for timeouts, `429`, and temporary `5xx`, including `Retry-After`;
- redirect-chain and redirect-loop detection;
- 40+ explicit audit and regression rules with stable fingerprints;
- SnapshotV2 with automatic baseline v1 migration;
- `new`, `ongoing`, `resolved`, and `unchanged` issue lifecycle;
- resumable scans and a useful report even after interruption;
- local SnapshotV2 history with issue, page-count, sitemap, and crawl-depth
  trends—without a hosted account;
- English/Ukrainian report localization, filters, CSV export, print layout,
  and local report branding;
- interactive issue statistics for severity, frequent checks, ownership, and
  regression lifecycle, with chart-to-table filtering;
- a production-versus-preview release guard with safe environment-based
  authentication for private deployments;
- configuration, suppressions with expiry, severity overrides, and budgets;
- a self-contained GitHub Action that runs inside the GitHub runner;
- typed engine API with injectable `fetch`, checkpoints, events, logger, and
  `AbortSignal`.

The project intentionally does not calculate an opaque overall SEO score.
Every finding names the affected URL, rule, risk, evidence, owner, and suggested
remediation.

## Requirements and installation

Node.js 20.19 or newer is required.

Run without installing:

```bash
npx seo-crawl-audit https://example.com/
```

Or install the CLI globally:

```bash
npm install --global seo-crawl-audit
seo-audit --version
```

For repository development:

```bash
git clone https://github.com/MelnixDev/seo-crawl-audit.git
cd seo-crawl-audit
npm install
npm run build
npm link --workspace seo-crawl-audit
```

## Five-minute example

[Quotes to Scrape](https://quotes.toscrape.com/) is a public educational site
made for crawler practice. It is unrelated to this project and keeps the
example small.

```bash
seo-audit scan https://quotes.toscrape.com/ \
  --no-sitemap \
  --pages 10 \
  --output quotes-baseline.json \
  --report quotes-report.html
```

Run a comparison later:

```bash
seo-audit check https://quotes.toscrape.com/ \
  --baseline quotes-baseline.json \
  --pages 10 \
  --report quotes-changes.html
```

## Commands

### `seo-audit <url>`

Shortcut for `seo-audit scan <url>`.

```bash
seo-audit https://example.com/
```

### `seo-audit scan <url>`

Crawls a site, audits its current state, saves SnapshotV2, and optionally writes
an HTML report.

```bash
seo-audit scan https://example.com/
seo-audit scan https://example.com/ --pages 250
seo-audit scan https://example.com/ --all
```

When a sitemap is found in an interactive terminal, the menu offers the first
100 pages, every sitemap URL, groups of 100 with confirmation, or a custom
number. `--pages` and `--all` skip the menu. If no sitemap is found, press Enter
to continue through same-origin internal links, or enter the full sitemap URL.

### `seo-audit check [url]`

Crawls again and compares the result with a saved baseline.

```bash
seo-audit check
seo-audit check https://preview.example.com/
seo-audit check --baseline production-seo.json --strict
```

Without `url`, the saved site URL is used. A different origin supports
production-to-preview comparison while keeping paths comparable. New
error-level findings return exit code `1`; `--strict` also blocks on warnings.
If `scan` receives SIGINT or SIGTERM, it flushes completed pages, writes the
partial snapshot/report, keeps the checkpoint, and exits with code `130`.

### `seo-audit compare`

Scans production, requests the same paths from a preview deployment, and
reports only SEO regressions introduced by the preview:

```bash
seo-audit compare \
  --production https://example.com/ \
  --preview https://preview-123.example.dev/ \
  --pages 100 \
  --report preview-seo-report.html
```

For a protected deployment, put request headers in an environment variable as
a JSON object and pass only its name on the command line:

```bash
export SEO_AUDIT_PREVIEW_HEADERS='{"Authorization":"Bearer …"}'
seo-audit compare \
  --production https://example.com/ \
  --preview https://preview-123.example.dev/ \
  --preview-headers-env SEO_AUDIT_PREVIEW_HEADERS
```

Header values are used only by the injected request adapter. They are never
written to snapshots, reports, checkpoints, or JSON output. Errors block the
release with exit code `1`; `--strict` also blocks on warnings.

### `seo-audit report [baseline]`

Regenerates HTML from a saved snapshot without network requests.

```bash
seo-audit report
seo-audit report quotes-baseline.json --report quotes-report.html
```

### `seo-audit history [url]`

Lists locally saved runs and creates an HTML report with issue trends:

```bash
seo-audit history https://example.com/
seo-audit history --history-dir ./audit-history --report history.html
```

Compare any two saved runs without crawling:

```bash
seo-audit history \
  --from .seo-audit/history/older.snapshot.json \
  --to .seo-audit/history/newer.snapshot.json \
  --report selected-runs.html
```

## Options

```text
--baseline <file>       Baseline input for check (default: .seo-audit.json)
--config <file>         Config file (default: seo-audit.config.json)
--output <file>         Snapshot output for scan (default: .seo-audit.json)
--report <file>         HTML report output (default: seo-audit-report.html)
--no-report             Disable automatic HTML report generation
--no-cache              Disable checkpoint caching and resume
--pages <number>        Scan an exact number of pages
--all                   Scan every URL found in the sitemap
--max-pages <number>    Deprecated alias for --pages
--concurrency <number>  Concurrent requests (default: 5)
--delay <ms>            Delay between starts per origin (default: 100)
--timeout <ms>          Per-request timeout (default: 10000)
--sitemap <url>         Use a specific sitemap or sitemap index
--no-sitemap            Skip sitemap discovery and crawl internal links
--include-query         Treat query-string URLs as separate pages
--ignore-robots         Ignore robots.txt disallow rules
--strict                Fail check on warnings as well as errors
--production <url>      Production URL for compare
--preview <url>         Preview deployment URL for compare
--production-headers-env <name>
                        Read production headers from a JSON environment variable
--preview-headers-env <name>
                        Read preview headers from a JSON environment variable
--history-dir <path>    Local snapshot history directory
--no-history            Do not save this scan to local history
--from <snapshot>       Older snapshot for an explicit history comparison
--to <snapshot>         Newer snapshot for an explicit history comparison
--json                  Print machine-readable output
--help                  Show help
--version               Show the installed version
```

## Configuration

The repository includes [`seo-audit.config.json`](seo-audit.config.json) and a
[JSON Schema](packages/core/config.schema.json). CLI flags take precedence over
the config file, which takes precedence over the saved baseline, followed by
safe defaults.

```json
{
  "$schema": "./packages/core/config.schema.json",
  "url": "https://example.com/",
  "sitemap": "auto",
  "maxPages": 100,
  "concurrency": 5,
  "delay": 100,
  "timeout": 10000,
  "respectRobots": true,
  "includeQuery": false,
  "enabledRules": null,
  "severityOverrides": {
    "low-word-count": "info"
  },
  "suppressions": [
    {
      "rule": "missing-description",
      "urlPattern": "/legal/**",
      "reason": "Description intentionally omitted",
      "expiresAt": "2027-01-01"
    }
  ],
  "regressionBudgets": {
    "error": 0,
    "warning": 3
  },
  "report": {
    "agencyName": "Example Agency",
    "logo": "https://example.com/logo.png",
    "primaryColor": "#3157d5"
  }
}
```

Expired suppressions stop matching automatically, so the issue appears again.
`urlPattern` accepts `*` within one path segment and `**` across segments.

## What is checked

The rule registry covers access and HTTP failures, meta and header `noindex`,
robots blocking, canonical validity and targets, redirects, sitemap consistency,
titles, descriptions, headings, internal links, orphan pages, hreflang,
structured data syntax, language declarations, exact duplicate content, social
metadata, image alt attributes, and low word count.

Regression-only checks cover newly introduced indexing blocks, status changes,
metadata removal or edits, redirect changes, robots changes, and sharp sitemap
URL loss.

[Read the rule-by-rule documentation](https://github.com/MelnixDev/seo-crawl-audit/blob/main/docs/rules.md) ·
[Українська версія довідника правил](https://github.com/MelnixDev/seo-crawl-audit/blob/main/docs/rules.uk.md).

## Snapshots, lifecycle, and checkpoints

SnapshotV2 records schema, engine and rule-set versions, generated time, config
hash, robots and sitemap state, normalized page data, link-graph summary, and
crawl statistics. Baseline schema v1 is upgraded automatically when read.

Issues use a stable 24-character fingerprint. A comparison separates:

- `newIssues` — absent from the previous snapshot;
- `ongoingIssues` — same issue identity with changed evidence;
- `resolvedIssues` — present before but absent now;
- `unchangedIssues` — same identity and evidence.

`DiffResult.complete` is `false` for partial or truncated comparisons. Findings
on checked pages are still reported, while unchecked pages are not falsely
classified as missing or resolved.

During `scan`, completed normalized page results are appended to
`.seo-audit.checkpoint.ndjson`. Full HTML is not cached. Running the same
compatible command resumes without requesting saved pages again. The checkpoint
is removed after completion and retained after interruption. Successful pages
are reused; transient failures and HTTP 5xx results are refreshed. Only an
unfinished final NDJSON record is recoverable—earlier corruption is reported.

Every completed scan and check also saves a full SnapshotV2 beside the selected
baseline under `.seo-audit/history/`. Use `--history-dir` to move it or
`--no-history` for an ephemeral run. History is read directly from disk; no URL,
snapshot, or metric is uploaded. The HTML trend view shows errors, warnings,
informational findings, new/resolved issues, page count, sitemap count, and
maximum crawl depth.

## HTML and CSV report

The portable HTML file contains no external script, font, or tracking request.
It includes:

- an `English / Українська` language selector that translates the complete
  interface, rule names, findings, remediation, lifecycle labels, and CSV;
- dependency-free interactive charts for severity, most frequent checks,
  inferred page templates, and owner or regression-lifecycle distribution;
  selecting a chart item filters
  the issue table and selecting it again clears that filter;
- summary cards and partial-scan state;
- current and lifecycle tabs;
- severity, rule, inferred template, owner, and URL/text filters;
- evidence, before/after values, remediation, and fingerprint;
- engine and rule-set versions;
- client-side CSV export;
- print-friendly PDF layout;
- optional local agency name, logo, and primary color;
- clear clean-report and no-filter-match states.

Template grouping turns repeated findings such as `/products/red-shoe` and
`/products/blue-shirt` into `/products/:slug`. Numeric IDs, UUIDs, dates, and
hashes have stable placeholders. Grouping changes only presentation: rule IDs,
evidence, snapshots, and issue fingerprints remain unchanged.

Writes are atomic. Interactive scans refresh a partial report while results are
being checkpointed, so interruption does not discard already completed work.

## GitHub Action

The Action crawls entirely inside the GitHub runner. It produces exit status,
JSON summary, HTML report, job summary, and annotations for error-level
regressions.

```yaml
name: SEO regression check
on: [pull_request]

jobs:
  seo:
    runs-on: ubuntu-latest
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

[Read all Action inputs and outputs](docs/github-action.md).

## Core API and repository structure

The npm workspace separates reusable concerns:

```text
packages/core    @seo-crawl-audit/core — scan, audit, diff, snapshots, reports
packages/cli     seo-crawl-audit       — terminal UX and npm executable
packages/action  @seo-crawl-audit/action — GitHub runner entry point
```

```ts
import { audit, planScan, scan } from "@seo-crawl-audit/core";
import { createFileCheckpointStore } from "@seo-crawl-audit/core/node";

const plan = await planScan({ url: "https://example.com/", maxPages: 100 });
const result = await scan(plan, {
  signal: controller.signal,
  checkpointStore: createFileCheckpointStore(".seo-audit.checkpoint.ndjson"),
  onEvent(event) {
    if (event.type === "progress") console.log(event.completed, event.total);
  },
});

const issues = audit(result.snapshot);
```

[Read the typed public API guide](docs/public-api.md) and the
[architecture notes](docs/architecture.md).

## Responsible crawling and safe defaults

- delay: `100 ms` between request starts per origin;
- concurrency: `5`;
- timeout: `10 s`;
- `robots.txt` respected;
- same-origin page discovery;
- query strings excluded;
- HTML limited to `5 MiB` and robots to `512 KiB`;
- retries are bounded and use exponential backoff with jitter;
- `Retry-After` is honored up to 30 seconds;
- redirects are limited to 10.

Use a longer delay for a small site or a server you do not control:

```bash
seo-audit https://example.com/ --delay 500
```

Use `--delay 0` only for local or explicitly controlled fixtures.

## Current scope

- server-rendered HTML; JavaScript rendering is not included;
- same-origin crawl discovery;
- sitemap and internal-link seeding;
- non-HTML responses are recorded but not parsed for page metadata;
- authenticated pages are not supported;
- results are normalized and ordered for reproducible output.

## Development

```bash
npm run build
npm test
npm run check
```

CI covers Node.js 20, 22, and 24. Tests use local HTTP fixtures for robots,
sitemaps, gzip, retries, redirects, cancellation, checkpoint resume, migration,
rules, lifecycle, HTML escaping, npm packaging, and the GitHub Action.

## License

MIT
