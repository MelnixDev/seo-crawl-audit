# Project diagnostics

`seo-audit doctor` checks whether the local project is ready for an audit. It
does not perform a page crawl and does not inspect the technology used to build
the target website.

```bash
seo-audit doctor https://example.com/
```

When `seo-audit.config.json` contains `url`, the positional URL is optional:

```bash
seo-audit doctor
```

## What it checks

### Local runtime

The command verifies that the machine running the CLI has Node.js 20.19 or
newer. Node.js is required by the local CLI, not by the audited website. The
website can use PHP, WordPress, Laravel, Python, Java, .NET, a static-site
generator, or any other server technology.

### Configuration

The selected `seo-audit.config.json` is parsed through the same validator used
by `scan` and `check`. Unknown properties, invalid URLs, unsafe numeric values,
and malformed suppressions are reported with a concrete remediation.

The URL argument takes precedence over the URL stored in the configuration.
Use `--config <path>` for a non-default file and `--directory <path>` to inspect
another project directory.

### Local output access

Doctor checks whether the current process can write through the nearest
existing directories for:

- the JSON baseline;
- the HTML report, unless `--no-report` is used;
- local snapshot history, unless `--no-history` is used.

It does not create or modify these files during diagnostics.

### Minimal network readiness

The online check requests:

- the configured start URL once and verifies its HTTP status and content type;
- `robots.txt` through the normal crawler planning policy;
- the declared, configured, or conventionally discovered sitemap.

No linked HTML pages are crawled. Sitemap discovery may try the conventional
`/sitemap.xml`, `/sitemap.xml.gz`, and `/sitemap_index.xml` locations when no
sitemap is declared.

An unavailable homepage or a `401`/`403` response is a failure. A non-HTML
homepage, missing robots.txt, or absent automatically discovered sitemap is a
warning with a suggested next step. A configured sitemap that cannot be loaded
is a failure.

## Offline mode

Use `--offline` to validate only runtime, configuration, target URL, and local
output access:

```bash
seo-audit doctor --offline
```

Homepage, robots, and sitemap checks are reported as `SKIP`. No network request
is made.

## Machine-readable result

```bash
seo-audit doctor --json
```

The JSON object contains:

- `healthy` — `true` when no check failed;
- `offline` — whether network checks were disabled;
- normalized `url`;
- every check with `pass`, `warning`, `fail`, or `skipped` status;
- optional structured evidence and remediation;
- totals grouped by status.

Warnings do not make the project unhealthy. They identify optional or
recoverable setup improvements.

## Exit codes

```text
0    Diagnostics completed without failed checks
1    One or more diagnostic checks failed
2    Invalid CLI syntax or an unexpected diagnostic failure
130  Diagnostics were interrupted by SIGINT or SIGTERM
```

The command never uploads configuration or diagnostic results to a hosted
service.
