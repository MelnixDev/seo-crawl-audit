# Observed site architecture

The Pages view derives link relationships from the saved snapshot without
requesting additional pages. It counts distinct source URLs: repeated links on
one page count once, fragment links are normalized, and self-links are excluded.

Use the sortable **Observed inlinks** column and **Site architecture** filter to
find pages with zero or one observed source, pages linking to known errors or
redirects, and pages at crawl depth four or greater. These are views of crawl
data, not new SEO rules or evidence of Google index coverage.

Opening a page shows paginated incoming sources, broken outgoing targets, and
redirecting targets. Click a checked URL to inspect its details. The existing
redirect-chain section shows recorded status and destination evidence.

A broken target requires a checked HTTP 4xx/5xx response or a recorded network
failure. Unchecked and robots-blocked targets are not classified as broken.
An empty incoming list means no sources were found **in this crawl**; it does
not prove that the page has no links elsewhere on the site. This distinction
also applies to complete sitemap crawls, which may omit pages outside the sitemap.

The URL-template field filters inferred patterns across checked pages, including
pages without issues. Autocomplete suggests the 100 largest template groups
with their page counts; typed filtering also works for all remaining groups.
Patterns are inferred from URL structure and are not confirmed application routes.

CSV exports every filtered row, with template, depth, observed inlink count,
broken/redirecting target counts, and existing page fields. Detailed metadata
is unavailable for older reports supplied with URL-only data; these counts
remain unknown rather than zero. English and Ukrainian are supported.
