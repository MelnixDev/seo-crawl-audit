import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  mkdtemp,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectRoot, "bin", "seo-audit.js");

async function waitFor(check, timeout = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the interrupted scan state");
}

test("interrupted scan leaves a report and resumes without refetching saved pages", async (context) => {
  const requests = new Map();
  let origin;
  const server = createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) ?? 0) + 1);

    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(
        `<urlset>${Array.from(
          { length: 20 },
          (_, index) => `<url><loc>${origin}/page-${index + 1}</loc></url>`,
        ).join("")}</urlset>`,
      );
      return;
    }

    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<title>${request.url}</title><h1>Page</h1>`);
    }, 80);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  origin = `http://127.0.0.1:${server.address().port}`;

  const directory = await mkdtemp(join(tmpdir(), "seo-audit-resume-"));
  const baselinePath = join(directory, "baseline.json");
  const checkpointPath = join(directory, "baseline.checkpoint.ndjson");
  const reportPath = join(directory, "report.html");
  const args = [
    cliPath,
    "scan",
    origin,
    "--sitemap",
    `${origin}/sitemap.xml`,
    "--all",
    "--concurrency",
    "1",
    "--output",
    baselinePath,
    "--report",
    reportPath,
  ];

  const interrupted = spawn(process.execPath, args, {
    cwd: projectRoot,
    stdio: "ignore",
  });
  context.after(() => {
    if (interrupted.exitCode === null) {
      interrupted.kill("SIGKILL");
    }
  });

  await waitFor(async () => {
    try {
      const [checkpointText, reportText] = await Promise.all([
        readFile(checkpointPath, "utf8"),
        readFile(reportPath, "utf8"),
      ]);
      return (
        checkpointText.split("\n").filter(Boolean).length >= 2 &&
        reportText.includes("Page does not have a meta description")
      );
    } catch {
      return false;
    }
  });

  interrupted.kill("SIGINT");
  await once(interrupted, "exit");

  const checkpointLines = (await readFile(checkpointPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .slice(1);
  const cachedUrls = checkpointLines
    .map((line) => JSON.parse(line))
    .filter((record) => record.type === "page")
    .map((record) => new URL(record.page.url).pathname);
  const requestCountsBeforeResume = new Map(requests);
  const partialReport = await readFile(reportPath, "utf8");
  assert.match(partialReport, /Partial SEO scan report/);
  assert.ok(cachedUrls.length > 0);

  const resumed = spawn(process.execPath, args, {
    cwd: projectRoot,
    stdio: "ignore",
  });
  const [exitCode] = await once(resumed, "exit");
  assert.equal(exitCode, 0);

  for (const path of cachedUrls) {
    assert.equal(
      requests.get(path),
      requestCountsBeforeResume.get(path),
      `expected ${path} to be reused from the checkpoint`,
    );
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const completedReport = await readFile(reportPath, "utf8");
  assert.equal(baseline.pages.length, 21);
  assert.doesNotMatch(completedReport, /Partial SEO scan report/);
  await assert.rejects(readFile(checkpointPath, "utf8"), { code: "ENOENT" });
});
