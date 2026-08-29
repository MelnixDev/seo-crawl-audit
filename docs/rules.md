# SEO Crawl Audit rules

**English** | [Українська](rules.uk.md)

Every finding has a stable rule ID, severity, owner, evidence, remediation, and
fingerprint. Rules report concrete risks; the tool does not calculate a general
SEO score.

Severity means:

- `error` — likely to prevent crawling, indexing, or access, and blocks a normal
  regression check;
- `warning` — an important SEO or content-quality problem;
- `info` — useful context that should be reviewed but does not block by default.

## Access, indexing, and redirects

### page-unreachable

The page request failed after bounded retries. Owner: `developer`. Restore the
page, fix networking, or remove references to a deliberately retired URL.

### http-error

The page returned HTTP 4xx or 5xx. Owner: `developer`. Return a successful
response, or a deliberate redirect to a valid replacement.

### robots-blocked

The page is disallowed by the matching `robots.txt` group. Owner: `developer`.
Allow it only when search crawlers should access it.

### noindex

The HTML contains a `noindex` meta directive. Owner: `seo`. This is
informational in a standalone audit because it can be intentional.

### x-robots-noindex

The HTTP `X-Robots-Tag` contains `noindex`. Owner: `developer`. Confirm that the
header is deliberate; remove it when the page should be indexed.

### redirect-loop

The redirect chain returns to an already visited URL. Owner: `developer`. Break
the cycle and redirect directly to the final destination.

### long-redirect-chain

More than three redirects are required. Owner: `developer`. Replace intermediate
hops with a direct redirect.

### http-on-https-site

An HTTPS site exposes an internal HTTP URL in crawl or metadata output. Owner:
`developer`. Use HTTPS consistently.

## Canonicals

### missing-canonical

No canonical declaration was found. Owner: `seo`. Add one when URL variants or
duplicate paths can exist.

### invalid-canonical

A canonical value cannot be resolved as HTTP(S). Owner: `developer`. Use a valid
absolute URL or a valid relative reference.

### cross-domain-canonical

The canonical points to another origin. Owner: `seo`. Confirm that this
cross-site consolidation is deliberate.

### canonical-target-error

The canonical target is part of the scan but is unavailable. Owner: `developer`.
Point the canonical to a successful, indexable destination.

## Sitemap consistency

### sitemap-unavailable

The configured sitemap could not be fetched or parsed. Owner: `developer`.
Restore a reachable, valid XML sitemap.

### noindex-in-sitemap

A sitemap URL is marked `noindex`. Owner: `seo`. Remove it from the sitemap or
make it indexable.

### redirect-in-sitemap

A sitemap URL redirects. Owner: `seo`. Put its final canonical URL in the
sitemap.

### orphan-sitemap-page

A sitemap page has no discovered internal links. Owner: `seo`. Add useful
internal navigation or confirm that it is intentionally isolated.

### crawlable-not-in-sitemap

A successful, crawlable page was discovered outside the sitemap. Owner: `seo`.
Add it to the sitemap or deliberately exclude it.

### sitemap-url-count-drop

The sitemap lost at least 20% and at least five URLs compared with the baseline.
Owner: `seo`. Investigate accidental exclusions or generation failures.

## Titles, descriptions, and headings

### missing-title

The page has no non-empty HTML title. Owner: `content`. Add a unique,
descriptive title.

### duplicate-title

Multiple crawled pages use the same title. Owner: `content`. Differentiate each
page by its intent.

### title-length

The title is shorter than 10 or longer than 60 characters. Owner: `content`.
Treat the range as a review signal, not a guarantee of search rendering.

### missing-description

The page has no meta description. Owner: `content`. Add a useful summary where
search-result messaging matters.

### duplicate-description

Multiple pages use the same description. Owner: `content`. Write a description
that reflects the individual page.

### description-length

The description is shorter than 50 or longer than 160 characters. Owner:
`content`. Review clarity and likely truncation.

### missing-h1

No H1 heading is present. Owner: `content`. Add a clear primary heading.

### multiple-h1

More than one H1 is present. Owner: `content`. This is informational; review the
document hierarchy rather than changing it mechanically.

## Links, language, structured data, and content

### broken-internal-link

An internal link points to a crawled target that failed or returned an error.
Owner: `developer`. Restore, update, or remove the link.

### invalid-hreflang

An alternate has an invalid BCP 47 language tag or unresolved URL. Owner: `seo`.
Correct the language and target.

### invalid-language

The `html` language value is not a valid BCP 47 tag. Owner: `developer`. Set the
document language correctly.

### malformed-json-ld

An `application/ld+json` block is not valid JSON. Owner: `developer`. Correct
the JSON syntax before validating its vocabulary.

### duplicate-content

Normalized visible text has the same SHA-256 value on multiple pages. Owner:
`content`. Consolidate or meaningfully differentiate exact duplicates.

### image-missing-alt

An image lacks an `alt` attribute. Owner: `content`. Add meaningful alternative
text, or an empty attribute for decorative images.

### low-word-count

The page has fewer than 200 visible words. Owner: `content`. This is only a
review prompt; concise pages can be entirely appropriate.

### missing-open-graph

Open Graph title, description, or image is absent. Owner: `content`. Add the
fields when social previews matter.

### missing-twitter-metadata

Twitter card, title, description, or image is absent. Owner: `content`. Add the
fields when that sharing surface matters.

## Regression-only rules

### robots-changed

The `robots.txt` content hash changed. Review the exact deployment change.

### page-missing

A baseline page was not checked in the current snapshot.

### status-regression

A previously successful page now returns an error status.

### new-noindex

A page gained a meta or `X-Robots-Tag` `noindex` directive. This is error-level
because accidental indexing loss is high risk.

### title-removed

A previously present title is now absent.

### title-changed

The title changed. Review whether the content or deployment intended it.

### description-removed

A previously present description is now absent.

### canonical-removed

A previously present canonical is now absent.

### canonical-changed

The canonical target changed. A new cross-origin target is promoted to an error.

### h1-removed

A page that had an H1 no longer has one.

### redirect-changed

The final redirect destination changed. A new cross-origin destination is
promoted to an error.
