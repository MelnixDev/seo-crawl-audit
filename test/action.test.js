import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("GitHub Action creates local JSON and HTML outputs without an external API", async (context) => {
  let origin;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      return response.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
    }
    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      return response.end(`<urlset><url><loc>${origin}/</loc></url></urlset>`);
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<html lang="en"><head><title>A useful example title</title><meta name="description" content="A useful description that is long enough to represent an ordinary search result snippet."><link rel="canonical" href="${origin}/"><meta property="og:title" content="Example"><meta property="og:description" content="Description"><meta property="og:image" content="${origin}/image.jpg"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="Example"><meta name="twitter:description" content="Description"><meta name="twitter:image" content="${origin}/image.jpg"></head><body><h1>Example</h1>${"Useful local content. ".repeat(220)}</body></html>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "seo-action-"));
  const report = join(directory, "report.html");
  const output = join(directory, "output.txt");
  const summary = join(directory, "summary.md");
  await writeFile(output, "");
  await writeFile(summary, "");
  const child = spawn(process.execPath, ["packages/action/action-dist/index.cjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      "INPUT_URL": origin,
      "INPUT_CONFIG": "",
      "INPUT_FAIL-ON": "none",
      "INPUT_REPORT": report,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const [code] = await once(child, "exit");

  assert.equal(code, 0, `${stderr}\n${stdout}`);
  assert.match(await readFile(report, "utf8"), /SEO baseline audit/);
  const json = JSON.parse(await readFile(`${report}.json`, "utf8"));
  assert.equal(json.pages, 1);
  assert.match(await readFile(output, "utf8"), /report<<ghadelimiter_/);
});
