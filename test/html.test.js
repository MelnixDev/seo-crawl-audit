import test from "node:test";
import assert from "node:assert/strict";
import { extractSeoData } from "../src/html.js";

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
