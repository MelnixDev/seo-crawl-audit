# Native plugin release media

These images and the silent MP4 show an actual report produced by the bundled
0.17.0 STDIO MCP server. They do not show an installed Codex or Claude interface.

The local three-page fixture was explicitly created for this demonstration:
`/`, `/catalog/`, and `/guide/`. The two inner pages repeat their title, and all
three omit descriptions. The fixture uses localhost only; no customer website,
credentials, hosted service or invented production metrics are involved.

The capture called `initialize`, `tools/list`, `seo_audit_plan`,
`seo_audit_scan` (three-page cap, robots respected), `seo_audit_issues` (limit5)
and `seo_audit_report` through the actual plugin launcher. The generated
self-contained report is `native-demo-report.html`; the public copy adds only a noindex/nofollow meta tag so fixture content is not a search landing page.

- `native-report-overview.png`: initial rendered report, 1440×1000.
- `native-report-pages.png`: actual Page Explorer after switching sections.
- `native-report-issues.png`: actual findings table.
- `native-workflow.mp4`: one continuous browser recording of the report,
  switching sections, searching a URL and filtering issues. No synthetic client
  UI, narration, background music, retimed actions or fabricated installation.

The release-preparation evidence includes the MCP transcript and visual QA
results. Native GUI installation and first use remain a separate verification
step. AI-client data policies are separate from local artifact storage.

The report screenshots and recording are retained from engine 0.17.0, before the crab header refresh. They are real historical fixture captures, not retouched images of the 0.17.1 interface. `logo.png` is the selected 512px production crab artwork.
