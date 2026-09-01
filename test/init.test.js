import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/dist/cli.js";
import { initializeProject, workflowContent } from "../packages/cli/dist/init.js";
import { loadConfig } from "../packages/core/dist/node.js";

test("init creates a validated safe config and local artifact recommendations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-init-"));
  const result = await initializeProject({
    directory,
    url: "https://example.com",
    workflow: "none",
    yes: true,
    interactive: false,
  });

  assert.equal(result.url, "https://example.com/");
  assert.deepEqual(result.files.map((file) => file.status), ["created", "created"]);
  const configPath = join(directory, "seo-audit.config.json");
  const configSource = await readFile(configPath, "utf8");
  const config = await loadConfig(configPath);
  assert.match(configSource, /MelnixDev\/seo-crawl-audit\/v0\/packages\/core\/config\.schema\.json/);
  assert.deepEqual(config, {
    url: "https://example.com/",
    sitemap: "auto",
    maxPages: 100,
    concurrency: 5,
    delay: 100,
    timeout: 10_000,
    respectRobots: true,
    includeQuery: false,
    maxRedirects: 10,
    maxResponseBytes: 5 * 1024 * 1024,
    enabledRules: null,
    severityOverrides: {},
    suppressions: [],
    regressionBudgets: { error: 0 },
    report: {},
  });
  const gitignore = await readFile(join(directory, ".gitignore"), "utf8");
  assert.match(gitignore, /^# SEO Crawl Audit/m);
  assert.match(gitignore, /^\.seo-audit\.checkpoint\.ndjson$/m);
  assert.match(gitignore, /^\.seo-audit\/history\/$/m);
  assert.doesNotMatch(gitignore, /^\.seo-audit\.json$/m);
});

test("init never replaces existing generated files without explicit consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-init-protected-"));
  const workflowDirectory = join(directory, ".github/workflows");
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(join(directory, "seo-audit.config.json"), "custom config\n");
  await writeFile(join(directory, ".gitignore"), "node_modules/\n");
  await writeFile(join(workflowDirectory, "seo-audit.yml"), "custom workflow\n");

  const result = await initializeProject({
    directory,
    url: "https://example.com/",
    workflow: "scheduled",
    yes: true,
    interactive: false,
  });

  assert.deepEqual(result.files.map((file) => file.status), ["skipped", "updated", "skipped"]);
  assert.equal(await readFile(join(directory, "seo-audit.config.json"), "utf8"), "custom config\n");
  assert.equal(await readFile(join(workflowDirectory, "seo-audit.yml"), "utf8"), "custom workflow\n");
  assert.match(await readFile(join(directory, ".gitignore"), "utf8"), /^node_modules\/$/m);
});

test("init replaces protected files only after confirmation or --force", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-init-confirm-"));
  const configPath = join(directory, "seo-audit.config.json");
  await writeFile(configPath, "old\n");
  const questions = [];
  const confirmed = await initializeProject({
    directory,
    url: "https://example.com/",
    workflow: "none",
    interactive: true,
    ask: async (question) => {
      questions.push(question);
      return "yes";
    },
  });
  assert.equal(confirmed.files[0].status, "updated");
  assert.ok(questions.some((question) => question.includes("Replace it")));

  await writeFile(configPath, "old again\n");
  const forced = await initializeProject({
    directory,
    url: "https://example.org/",
    workflow: "none",
    force: true,
    interactive: false,
  });
  assert.equal(forced.files[0].status, "updated");
  assert.match(await readFile(configPath, "utf8"), /https:\/\/example\.org\//);
});

test("init workflow templates cover manual, scheduled, and preview checks", () => {
  const manual = workflowContent("manual");
  assert.match(manual, /workflow_dispatch:/);
  assert.doesNotMatch(manual, /schedule:/);
  assert.match(manual, /MelnixDev\/seo-crawl-audit@v0/);
  assert.match(manual, /if: always\(\)/);

  const scheduled = workflowContent("scheduled");
  assert.match(scheduled, /schedule:/);
  assert.match(scheduled, /cron: "0 6 \* \* 1"/);
  assert.match(scheduled, /workflow_dispatch:/);

  const pullRequest = workflowContent("pull-request");
  assert.match(pullRequest, /pull_request:/);
  assert.match(pullRequest, /vars\.SEO_AUDIT_PREVIEW_URL/);
  assert.match(pullRequest, /baseline: \.seo-audit\.json/);
  assert.match(pullRequest, /Validate preview audit setup/);
  assert.match(pullRequest, /Commit \.seo-audit\.json as the production baseline/);
});

test("CLI init supports deterministic non-interactive setup and JSON output", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-init-cli-"));
  const messages = [];
  const originalLog = console.log;
  console.log = (...values) => { messages.push(values.join(" ")); };
  context.after(() => { console.log = originalLog; });

  assert.equal(await main([
    "init",
    "https://example.com/",
    "--directory", directory,
    "--config", "config/seo.json",
    "--workflow", "scheduled",
    "--yes",
    "--json",
  ]), 0);
  const output = JSON.parse(messages.at(-1));
  assert.equal(output.command, "init");
  assert.equal(output.workflow, "scheduled");
  assert.equal((await loadConfig(join(directory, "config/seo.json"))).url, "https://example.com/");
  assert.match(await readFile(join(directory, ".github/workflows/seo-audit.yml"), "utf8"), /Scheduled SEO audit/);
});

test("init rejects incomplete URLs, unknown workflow modes, and extra arguments", async (context) => {
  const messages = [];
  const originalError = console.error;
  console.error = (...values) => { messages.push(values.join(" ")); };
  context.after(() => { console.error = originalError; });

  assert.equal(await main(["init", "example.com", "--yes"]), 2);
  assert.equal(await main(["init", "https://example.com/", "--workflow", "nightly", "--yes"]), 2);
  assert.equal(await main(["init", "https://example.com/", "extra", "--yes"]), 2);
  assert.match(messages.join("\n"), /full HTTP\(S\) URL/);
  assert.match(messages.join("\n"), /--workflow must be/);
  assert.match(messages.join("\n"), /Unexpected argument/);
});

test("init help does not require a URL or read a project config", async (context) => {
  const messages = [];
  const originalLog = console.log;
  console.log = (...values) => { messages.push(values.join(" ")); };
  context.after(() => { console.log = originalLog; });
  assert.equal(await main(["init", "--help", "--config", "/definitely/missing/config.json"]), 0);
  assert.match(messages.join("\n"), /seo-audit init \[url\]/);
});
