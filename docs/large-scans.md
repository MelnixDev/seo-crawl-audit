# Large scans and resume

SEO Crawl Audit supports up to 50,000 pages in the local web UI and MCP. HTTP
remains the default renderer; Playwright is optional and materially slower.

## Local web UI profiles

- **Quick** scans up to 100 pages.
- **Standard** scans up to 1,000 pages.
- **Full sitemap** scans every URL in the discovered sitemap, up to 50,000.
- **Custom** accepts a limit from 1 to 50,000 and can discover internal links
  when no sitemap exists.

Full sitemap always runs discovery first. Above 5,000 discovered URLs, the UI
shows the URL count, configured delay and concurrency, and an estimated minimum
duration. Crawling starts only after confirmation. Full sitemap is unavailable
when no sitemap is found; use Custom for a same-origin link crawl instead.

The CLI keeps its existing `--all` behavior:

```bash
seo-audit scan https://example.com/ --all \
  --output .seo-audit.json \
  --report seo-audit-report.html
```

## Checkpoint safety

Completed PageSnapshot records are appended to a versioned NDJSON journal. Page
bodies are never stored. The journal is retained after cancellation or failure,
and compatible retries reuse successful pages while refreshing transient and
HTTP 5xx failures. It is removed only after the final snapshot and report have
been written successfully.

Run the same command to resume. Use `seo-audit status` to inspect saved progress
without loading the entire journal into memory. Do not edit the journal: only an
incomplete final record from an interrupted write is ignored.

## MCP safety

`seo_audit_scan` accepts `fullSitemap: true`. A sitemap above 5,000 URLs returns
a preflight response with `requiresConfirmation: true` and does not request HTML
pages. Repeat the call with `confirmLargeScan: true` only after the user approves
the displayed load. The maximum is 50,000 pages.

## Responsible settings

Keep `robots.txt`, response-size limits, and a per-origin delay enabled. The
default delay is 100 ms and concurrency is 5. Increase the delay for a small or
third-party site. Large scans should be limited to sites you own or have clear
permission to crawl.
