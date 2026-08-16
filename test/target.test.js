import test from "node:test";
import assert from "node:assert/strict";
import { mapUrlToBaseline, mapUrlToTarget } from "../packages/core/dist/target.js";

test("maps production pages to a preview origin", () => {
  assert.equal(
    mapUrlToTarget(
      "https://example.com/docs/getting-started?lang=uk",
      "https://example.com/",
      "https://preview.example.net/",
    ),
    "https://preview.example.net/docs/getting-started?lang=uk",
  );
});

test("maps preview redirects back before baseline comparison", () => {
  assert.equal(
    mapUrlToBaseline(
      "https://preview.example.net/new-path",
      "https://example.com/",
      "https://preview.example.net/",
    ),
    "https://example.com/new-path",
  );
});

test("does not rewrite external URLs", () => {
  assert.equal(
    mapUrlToBaseline(
      "https://external.example.org/path",
      "https://example.com/",
      "https://preview.example.net/",
    ),
    "https://external.example.org/path",
  );
});
