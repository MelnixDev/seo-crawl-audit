# SEO Crawl Audit

`seo-audit` is a local-first command-line crawler that finds current on-page SEO
problems and detects accidental SEO regressions after a site changes.

It is free and open-source software released under the MIT License. It needs no
account, API key, browser extension, or hosted dashboard. Scan results stay on
your computer in readable JSON and self-contained HTML files.

## What you get

- automatic sitemap and sitemap-index discovery;
- a simple terminal menu for 100 pages, the whole sitemap, batches, or a custom
  limit;
- a live progress indicator;
- automatic recovery after an interrupted scan without requesting completed
  pages again;
- configurable spacing between request starts to reduce load on the site;
- a partial HTML report that remains useful even if the process is stopped;
- a saved baseline for later regression checks;
- exit codes suitable for CI and pull-request checks.

## Requirements and installation

Node.js 20.19 or newer is required.

```bash
git clone https://github.com/MelnixDev/seo-crawl-audit.git
cd seo-crawl-audit
npm install
npm link
```

After linking, `seo-audit` can be run from any directory:

```bash
seo-audit --version
seo-audit --help
```

## Five-minute demo

[Quotes to Scrape](https://quotes.toscrape.com/) is a public educational site
made for crawler practice. It is unrelated to this project and keeps the demo
small and reproducible.

```bash
seo-audit scan https://quotes.toscrape.com/ \
  --no-sitemap \
  --pages 10 \
  --output quotes-baseline.json \
  --report quotes-report.html
```

This scans ten internal pages, writes a JSON baseline, and creates a filterable
HTML report. In the current demo scan, the tool finds missing descriptions and
canonical URLs while the pages themselves remain reachable.

[Open the interactive report demo](https://melnixdev.github.io/seo-crawl-audit/)
or [view the included HTML file](examples/quotes-toscrape-report.html). GitHub
shows the source of the repository file, while the Pages version can be used
directly in a browser.

Run a fresh comparison later:

```bash
seo-audit check https://quotes.toscrape.com/ \
  --baseline quotes-baseline.json \
  --pages 10 \
  --report quotes-changes.html
```

## Commands

### `seo-audit <url>`

A shortcut for `seo-audit scan <url>`.

```bash
seo-audit https://example.com/
```

### `seo-audit scan <url>`

Crawls a site, audits its current SEO state, and saves a baseline.

```bash
seo-audit scan https://example.com/
seo-audit scan https://example.com/ --pages 250
seo-audit scan https://example.com/ --all
```

By default, the command:

1. reads `robots.txt`;
2. looks for a declared sitemap;
3. tries `/sitemap.xml` and `/sitemap_index.xml` when needed;
4. shows an interactive scan-size menu when a sitemap is found;
5. saves the baseline to `.seo-audit.json`;
6. creates `seo-audit-report.html` in an interactive terminal.

The menu offers the first 100 pages, the whole sitemap, batches of 100 with
confirmation, or any positive number entered by the user. `--pages` and `--all`
skip that menu.

If no sitemap is found, the interactive command asks for its full URL. Pressing
Enter instead starts a same-origin internal-link crawl.

### `seo-audit check [url]`

Crawls the site again and compares it with a saved baseline.

```bash
seo-audit check
seo-audit check https://preview.example.com/
seo-audit check --baseline production-seo.json --strict
```

When `url` is omitted, the source URL stored in the baseline is used. Supplying
a different origin is useful for comparing a production baseline with a preview
deployment; same-path page and canonical URLs are mapped between the origins.

An error-level regression returns exit code `1`. Warnings also return `1` when
`--strict` is enabled.

### `seo-audit report [baseline]`

Builds a new HTML audit report from an existing baseline without crawling or
making network requests.

```bash
seo-audit report
seo-audit report quotes-baseline.json
seo-audit report quotes-baseline.json --report quotes-report.html
```

The default input is `.seo-audit.json`, and the default output is
`seo-audit-report.html`.

## HTML report

The report is one portable HTML file with no external scripts, fonts, tracking,
or uploaded data. It contains:

- summary cards for checked and affected pages;
- error, warning, and informational issue counts;
- free-text search across URL, rule, message, before, and after values;
- severity and rule filters;
- paginated results with 100, 250, or 500 rows per page;
- direct links to affected pages;
- before/after values for regression checks.

During an interactive `scan`, the report is created immediately and refreshed
after the first completed request batch, then periodically as the scan grows.
Writes are atomic, so interruption should not leave a half-written HTML file.
A partial report clearly says that it contains saved results and shows
`checked / target` page counts.

Interactive `scan` and `check` commands create the default report automatically.
For scripts or CI, request one explicitly:

```bash
seo-audit scan https://example.com/ --report audit.html
seo-audit check --report regressions.html
```

Use `--no-report` when an HTML file is not needed.

## Resume cache and interrupted scans

`scan` stores completed page results in an append-only checkpoint beside the
baseline. For the default `.seo-audit.json` output, its name is:

```text
.seo-audit.checkpoint.ndjson
```

The checkpoint contains extracted SEO results and discovered links, not full
page HTML. Each completed request batch is appended immediately. If the process
is stopped, run the same compatible scan command again:

```bash
seo-audit https://example.com/ --all
```

The command reports how many pages were recovered and skips those URLs. A cache
is reused only when the start URL, sitemap, query-string policy, and robots
policy match. An incompatible checkpoint is replaced automatically.

The checkpoint is removed after the requested scan target finishes. It remains
when a stepped scan is stopped before its target or when the process is
interrupted. Checkpoint files are excluded by the included `.gitignore`.

To deliberately make every request without reading or writing a checkpoint:

```bash
seo-audit https://example.com/ --pages 100 --no-cache
```

`check` never reuses the scan checkpoint because regression detection must
observe the current response from every baseline URL.

## What is checked

The baseline audit reports:

- unreachable pages and request failures;
- HTTP 4xx and 5xx responses;
- pages blocked by `robots.txt`;
- missing titles;
- missing meta descriptions;
- missing canonical URLs;
- missing or multiple H1 headings;
- `noindex` directives.

The regression check detects:

- a previously working page becoming unavailable;
- a new `noindex` directive;
- a page becoming blocked by `robots.txt`;
- a removed or changed title;
- a removed meta description;
- a removed or changed canonical URL;
- a removed H1 heading;
- a changed redirect destination;
- a changed `robots.txt`.

Errors represent changes or conditions likely to block indexing or make a page
unusable. Warnings identify important metadata problems. Informational findings
are worth reviewing but do not fail a normal check.

## Options

```text
--baseline <file>       Baseline input for check (default: .seo-audit.json)
--output <file>         Baseline output for scan (default: .seo-audit.json)
--report <file>         HTML report output (default: seo-audit-report.html)
--no-report             Disable automatic HTML report generation
--no-cache              Disable scan checkpoint caching and resume
--pages <number>        Scan an exact number of pages
--all                   Scan every URL found in the sitemap
--max-pages <number>    Deprecated alias for --pages
--concurrency <number>  Concurrent requests (default: 5)
--delay <ms>            Delay between request starts (default: 100)
--timeout <ms>          Per-request timeout (default: 10000)
--sitemap <url>         Use a specific sitemap or sitemap index
--no-sitemap            Skip sitemap discovery and crawl internal links
--include-query         Treat query-string URLs as separate pages
--ignore-robots         Ignore robots.txt disallow rules
--strict                Fail check on warnings as well as errors
--json                  Print machine-readable command output
--help                  Show command help
--version               Show the installed version
```

`--sitemap` and `--no-sitemap` cannot be used together. `--all` requires a
sitemap because an internal-link crawl cannot know the site's complete URL set
in advance.

## Files

### Baseline JSON

The baseline records the source configuration, including the request delay,
sitemap and robots metadata, and the extracted SEO state of every scanned page.
`check` reuses that delay unless `--delay` overrides it. The file is
deterministic enough to review and commit when a team wants versioned regression
protection.

### Checkpoint NDJSON

The checkpoint is temporary recovery state. It is append-only for efficient
large scans and should not be committed.

### HTML report

The report is a self-contained human-readable artifact. It can be opened
locally, attached to a CI run, or shared as a file without exposing data to a
third-party service.

## JSON output and exit codes

Use `--json` for automation:

```bash
seo-audit check --json
```

Exit codes:

```text
0  Scan completed, or no blocking regressions were found
1  SEO regressions were found
2  Invalid input, invalid baseline, or crawler failure
```

With `--strict`, warnings count as blocking regressions for exit code `1`.

## GitHub Actions example

Create and commit a production baseline first. Then compare a deployed preview
in pull requests:

```yaml
name: SEO regression check

on:
  pull_request:

jobs:
  seo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: node bin/seo-audit.js check https://preview.example.com/ --strict --json
```

Add `--report seo-regressions.html` and upload that file as a workflow artifact
when a human-readable CI report is useful.

## Responsible crawling

The crawler respects `robots.txt` by default, stays on the starting origin,
starts requests at least 100 milliseconds apart, limits concurrency to five
in-flight requests, and applies a ten-second timeout. The same request gate is
used for `robots.txt`, sitemap discovery, sitemap files, and HTML pages.

Use a longer delay for a smaller site or a server you do not control:

```bash
seo-audit https://example.com/ --delay 500
```

`--delay 500` allows at most two new request starts per second. The default
`--delay 100` allows at most ten. A value of `0` disables the delay and is best
reserved for a local or otherwise trusted environment:

```bash
seo-audit http://localhost:3000/ --delay 0
```

A very short value such as `--delay 10` can start up to 100 requests per second,
so it is not a polite default for a public website. Increase concurrency or
reduce the delay only on sites you are allowed to test.

## Current scope

- server-rendered HTML only; JavaScript rendering is not included;
- same-origin crawling;
- sitemap and sitemap-index seeding;
- query strings are removed by default to avoid crawl traps;
- non-HTML URLs are not parsed for SEO metadata;
- HTML responses are limited to 5 MiB;
- `robots.txt` responses are limited to 512 KiB;
- authenticated pages are not supported.

## Development

```bash
npm test
npm run check
```

The test suite covers crawling, robots rules, sitemap discovery, URL mapping,
baseline comparisons, checkpoint recovery, HTML report safety, filtering data,
and CLI behavior.

## License

MIT
