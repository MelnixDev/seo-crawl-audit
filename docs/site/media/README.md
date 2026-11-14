# Native plugin release media — 0.17.1

These screenshots are unretouched viewport captures of the actual 0.17.1 HTML report generated through the bundled plugin MCP launcher. They show the selected crab header and engine version. They do not simulate an installed Codex or Claude interface.

The local three-page fixture is defined in demo-fixture.mjs: root, catalog and guide. It deliberately repeats titles and omits metadata. All visible URLs are loopback fixture addresses; no customer site, credentials or personal paths are shown.

Capture workflow: initialize, tools/list (8 tools), seo_audit_plan, seo_audit_scan (maxPages 3, robots respected), seo_audit_issues and seo_audit_report. Real browser actions switch Pages/Issues, search catalog and filter severity Error. Screenshots retain the complete browser viewport without compositing or pasted logos. PNG files are lossless format conversions of the browser JPEG captures, not enhanced redraws.

- native-report-overview.png: report overview, 1185×669.
- native-report-pages.png: actual Page Explorer, 1185×669.
- native-report-issues.png: actual Issues view filtered to Error, 1185×669.
- native-workflow.mp4: approximately 14-second silent preview assembled from four real browser capture states, held 3.5 seconds each. This is a capture sequence, not a continuous screen recording. No simulated UI, narration or music.
- native-demo-report.html: same actual generated report, with only noindex/nofollow added for public hosting.
- logo.png: selected 512px production crab artwork.

The larger /demo/ report uses explicit synthetic regression fixtures, not current measurements of quotes.toscrape.com. Both examples are demonstrations. GUI client installation remains a separate verification gate; metadata discovery is not a visual picker acceptance claim.
