# Playwright renderer for SEO Crawl Audit

Optional JavaScript rendering for sites whose SEO markup is produced in the
browser. The regular HTTP crawler remains the faster default.

```bash
npm install --save-dev @seo-crawl-audit/renderer-playwright playwright
npx playwright install chromium
```

```js
import { scan } from "@seo-crawl-audit/core";
import { createPlaywrightRenderer } from "@seo-crawl-audit/renderer-playwright";

const renderer = await createPlaywrightRenderer();
try {
  const result = await scan({ url: "https://example.com/" }, { renderer });
  console.log(result.snapshot.pages.length);
} finally {
  await renderer.close?.();
}
```

One Chromium browser and browser context are reused. Browser pages are bounded
to concurrency 2 by default. CSS, fonts, scripts, and images remain enabled;
video, audio, and downloads are blocked. Missing Playwright or Chromium fails
with an actionable error and never falls back silently to HTTP.
