# Authenticated scans

SEO Crawl Audit can inspect preview, staging, and other protected sites without
putting credentials in command arguments or project files. Store request
headers as a JSON object in an environment variable and pass only that
variable's name with `--headers-env`.

## Local CLI

Bash, zsh, and compatible shells:

```bash
export SEO_AUDIT_SITE_HEADERS='{"Authorization":"Bearer replace-me"}'
seo-audit doctor https://preview.example.com/ \
  --headers-env SEO_AUDIT_SITE_HEADERS
seo-audit scan https://preview.example.com/ \
  --headers-env SEO_AUDIT_SITE_HEADERS
seo-audit check https://preview.example.com/ \
  --headers-env SEO_AUDIT_SITE_HEADERS
```

PowerShell:

```powershell
$env:SEO_AUDIT_SITE_HEADERS = '{"Authorization":"Bearer replace-me"}'
seo-audit scan https://preview.example.com/ `
  --headers-env SEO_AUDIT_SITE_HEADERS
```

Multiple headers can be supplied in the same JSON object:

```bash
export SEO_AUDIT_SITE_HEADERS='{"Authorization":"Bearer replace-me","X-Preview-Key":"replace-me"}'
```

`compare` keeps separate credentials for each origin:

```bash
export SEO_AUDIT_PRODUCTION_HEADERS='{"Authorization":"Bearer production-token"}'
export SEO_AUDIT_PREVIEW_HEADERS='{"Authorization":"Bearer preview-token"}'
seo-audit compare \
  --production https://example.com/ \
  --preview https://preview.example.com/ \
  --production-headers-env SEO_AUDIT_PRODUCTION_HEADERS \
  --preview-headers-env SEO_AUDIT_PREVIEW_HEADERS
```

## GitHub Action

Save the complete JSON object as a GitHub Actions secret, for example
`SEO_AUDIT_SITE_HEADERS`. Expose it to the audit step as an environment
variable and pass only its name to the Action:

```yaml
- uses: MelnixDev/seo-crawl-audit@v0
  with:
    url: https://preview.example.com/
    headers-env: SEO_AUDIT_SITE_HEADERS
    report: seo-audit-report.html
  env:
    SEO_AUDIT_SITE_HEADERS: ${{ secrets.SEO_AUDIT_SITE_HEADERS }}
```

Do not paste the secret itself into `headers-env`; that input is a variable
name, not a token.

## Security boundary

- Header values are read only at runtime.
- Header values are not accepted in `seo-audit.config.json`.
- Header values are not written to snapshots, checkpoints, local history,
  reports, CSV exports, JSON summaries, or terminal output.
- Interrupted authenticated scans use a separate checkpoint namespace derived
  from the environment variable name, never from its secret value.
- Private headers are attached only to requests whose origin exactly matches
  the configured site origin.
- A redirect or sitemap hosted on another origin does not receive the private
  headers.
- Normal HTTP safety rules still apply: use HTTPS for credentials and grant
  the narrowest access required for read-only crawling.

If the environment variable is absent, contains invalid JSON, is not a JSON
object, or contains a non-string value, the command stops before crawling and
returns exit code `2`.
