import test from "node:test";
import assert from "node:assert/strict";
import { createPlaywrightRenderer } from "../packages/renderer-playwright/dist/index.js";

function fakePlaywright() {
  const state = { active: 0, maximum: 0, aborted: 0, continued: 0, pagesClosed: 0, contextClosed: 0, browserClosed: 0 };
  const module = {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                let handler;
                return {
                  async route(_pattern, value) { handler = value; },
                  on() {},
                  async goto(url) {
                    state.active += 1;
                    state.maximum = Math.max(state.maximum, state.active);
                    await Promise.all(["media", "script"].map((resourceType) => handler({
                      request: () => ({ resourceType: () => resourceType }),
                      abort: async () => { state.aborted += 1; },
                      continue: async () => { state.continued += 1; },
                    })));
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    state.active -= 1;
                    const request = { url: () => url, redirectedFrom: () => null, response: async () => null };
                    return { status: () => 200, headers: async () => ({ "content-type": "text/html" }), request: () => request };
                  },
                  async waitForLoadState() {},
                  async content() { return "<html><body><h1>Rendered</h1></body></html>"; },
                  url() { return "https://example.com/rendered"; },
                  async close() { state.pagesClosed += 1; },
                };
              },
              async close() { state.contextClosed += 1; },
            };
          },
          async close() { state.browserClosed += 1; },
        };
      },
    },
  };
  return { module, state };
}

const request = (url) => ({ url, timeout: 1_000, maxResponseBytes: 10_000, userAgent: "seo-audit/test" });

test("Playwright renderer reuses a browser, blocks media, and bounds concurrency", async () => {
  const fake = fakePlaywright();
  const renderer = await createPlaywrightRenderer({ playwright: fake.module, concurrency: 2, networkIdleTimeout: 0 });
  const results = await Promise.all([
    renderer.render(request("https://example.com/one")),
    renderer.render(request("https://example.com/two")),
    renderer.render(request("https://example.com/three")),
  ]);
  assert.equal(renderer.id, "playwright-chromium-v1");
  assert.equal(fake.state.maximum, 2);
  assert.equal(fake.state.aborted, 3);
  assert.equal(fake.state.continued, 3);
  assert.equal(results[0].finalUrl, "https://example.com/rendered");
  assert.match(results[0].html, /Rendered/);
  await renderer.close();
  await renderer.close();
  assert.equal(fake.state.contextClosed, 1);
  assert.equal(fake.state.browserClosed, 1);
});

test("Playwright renderer reports invalid setup without falling back", async () => {
  await assert.rejects(createPlaywrightRenderer({ concurrency: 0, playwright: {} }), /positive integer/);
  await assert.rejects(createPlaywrightRenderer({ playwright: { chromium: { launch: async () => { throw new Error("missing binary"); } } } }), /playwright install chromium/);
});
