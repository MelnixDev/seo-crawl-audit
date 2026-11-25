import test from "node:test";
import assert from "node:assert/strict";
import { extractSeoData } from "../packages/core/dist/html.js";

test("extracts SEO metadata and links from valid HTML", () => {
  const result = extractSeoData(`
    <!doctype html>
    <html lang="uk">
      <head>
        <title> Example title </title>
        <meta name="description" content="Example description">
        <meta name="robots" content="index,follow">
        <meta property="og:image" content="/cover.jpg">
        <link rel="canonical alternate" href="/canonical">
      </head>
      <body>
        <h1>One</h1>
        <h1>Two</h1>
        <a href="/about">About</a>
      </body>
    </html>
  `);

  assert.equal(result.title, "Example title");
  assert.equal(result.description, "Example description");
  assert.equal(result.robots, "index,follow");
  assert.equal(result.canonical, "/canonical");
  assert.equal(result.lang, "uk");
  assert.equal(result.h1Count, 2);
  assert.equal(result.openGraph.image, "/cover.jpg");
  assert.deepEqual(result.links, ["/about"]);
});

test("combines all generic robots directives and preserves the first base href", () => {
  const result = extractSeoData(`<head>
    <base target="_blank"><base href="/nested/"><base href="/ignored/">
    <meta name="robots" content="index,follow">
    <meta name="ROBOTS" content="noindex,nofollow">
  </head>`);
  assert.equal(result.baseHref, "/nested/");
  assert.equal(result.robots, "index,follow, noindex,nofollow");
  assert.equal(extractSeoData('<base href=""><base href="/ignored/">').baseHref, "");
});

test("retains restrictive robots in either order without applying bot-scoped metadata universally", () => {
  assert.equal(extractSeoData('<meta name="robots" content="noindex"><meta name="robots" content="index">').robots, "noindex, index");
  assert.equal(extractSeoData('<meta name="googlebot" content="noindex"><meta name="robots" content="index">').robots, "index");
});

test("body word count and visible text are independent of the document title", () => {
  const body = '<h1>Article heading</h1><p>Two words</p><svg><title>An icon label</title></svg><script>ignored()</script>';
  const extract = (title) => extractSeoData(`<head><title>${title}</title><meta name="description" content="SEO metadata"></head><body>${body}</body>`);
  const before = extract("An unnecessarily long document title");
  const after = extract("A shorter title");
  assert.notEqual(before.title, after.title);
  assert.equal(before.visibleText, "Article heading Two words");
  assert.equal(before.wordCount, 4);
  assert.equal(after.visibleText, before.visibleText);
  assert.equal(after.wordCount, before.wordCount);
});
