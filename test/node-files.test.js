import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReport } from "../packages/core/dist/node.js";

test("concurrent atomic report writes use independent temporary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-atomic-report-"));
  const path = join(directory, "report.html");
  const report = (startUrl) => ({ mode: "scan", startUrl, pages: [], issues: [] });

  await Promise.all([
    writeReport(path, report("https://first.example/")),
    writeReport(path, report("https://second.example/")),
  ]);

  const html = await readFile(path, "utf8");
  assert.match(html, /https:\/\/(?:first|second)\.example\//);
});
