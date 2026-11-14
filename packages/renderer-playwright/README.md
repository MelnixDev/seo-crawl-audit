# Internal Playwright renderer workspace

This workspace is bundled into the public `seo-crawl-audit` CLI. It is not a
separately published npm SDK; the core workspace is internal as well.

For JavaScript-rendered pages, install Playwright in the consumer project:

```sh
npm install --save-dev playwright
npx playwright install chromium
npx seo-crawl-audit@0.17.0 scan https://example.com/ --render playwright --pages 100
```

One Chromium browser and context are reused. Browser pages are bounded to
concurrency 2 by default. CSS, fonts, scripts and images remain enabled; video,
audio and downloads are blocked. Missing Playwright or Chromium fails with an
actionable error and never silently falls back to HTTP.
