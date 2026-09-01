import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ask as defaultAsk } from "./ui.js";
import type { CliValues } from "./args.js";

export type InitWorkflow = "none" | "manual" | "scheduled" | "pull-request";
export type InitFileStatus = "created" | "updated" | "unchanged" | "skipped";

export interface InitFileResult {
  path: string;
  status: InitFileStatus;
}

export interface InitResult {
  directory: string;
  url: string;
  workflow: InitWorkflow;
  files: InitFileResult[];
}

export interface InitializeProjectOptions {
  directory?: string;
  url?: string;
  configPath?: string;
  workflow?: string;
  yes?: boolean;
  force?: boolean;
  interactive?: boolean;
  ask?: (question: string) => Promise<string>;
}

const CONFIG_SCHEMA_URL = "https://raw.githubusercontent.com/MelnixDev/seo-crawl-audit/v0/packages/core/config.schema.json";
const DEFAULT_CONFIG_FILE = "seo-audit.config.json";
const DEFAULT_WORKFLOW_FILE = ".github/workflows/seo-audit.yml";
const GITIGNORE_RECOMMENDATIONS = [
  ".seo-audit.checkpoint.ndjson",
  ".seo-audit/history/",
  "seo-audit-report.html",
  "seo-audit-report.html.json",
];

function normalizeSiteUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new Error("init URL must be a full HTTP(S) URL", { cause: error });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("init URL must be a full HTTP(S) URL");
  }
  url.hash = "";
  return url.href;
}

function parseWorkflow(input: string | undefined): InitWorkflow {
  const normalized = (input ?? "none").trim().toLowerCase();
  const aliases: Record<string, InitWorkflow> = {
    "": "none",
    none: "none",
    manual: "manual",
    scheduled: "scheduled",
    schedule: "scheduled",
    "pull-request": "pull-request",
    pull_request: "pull-request",
    pr: "pull-request",
  };
  const workflow = aliases[normalized];
  if (!workflow) throw new Error("--workflow must be none, manual, scheduled, or pull-request");
  return workflow;
}

function configContent(url: string): string {
  return `${JSON.stringify({
    $schema: CONFIG_SCHEMA_URL,
    url,
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
  }, null, 2)}\n`;
}

function actionSteps(extraInputs = "", preflight = ""): string {
  return `      - uses: actions/checkout@v6${preflight}
      - name: Run SEO Crawl Audit
        id: seo
        uses: MelnixDev/seo-crawl-audit@v0
        with:
          config: seo-audit.config.json
          fail-on: error
          report: seo-audit-report.html${extraInputs}
      - name: Upload SEO report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: seo-crawl-audit-report
          path: |
            \${{ steps.seo.outputs.report }}
            \${{ steps.seo.outputs.summary }}
          if-no-files-found: warn
`;
}

export function workflowContent(workflow: Exclude<InitWorkflow, "none">): string {
  if (workflow === "manual") {
    return `name: SEO audit

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
${actionSteps()}`;
  }
  if (workflow === "scheduled") {
    return `name: Scheduled SEO audit

on:
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
${actionSteps()}`;
  }
  const preflight = `
      - name: Validate preview audit setup
        env:
          PREVIEW_URL: \${{ vars.SEO_AUDIT_PREVIEW_URL }}
        run: |
          if [ -z "$PREVIEW_URL" ]; then
            echo "Set the SEO_AUDIT_PREVIEW_URL repository variable." >&2
            exit 1
          fi
          if [ ! -f .seo-audit.json ]; then
            echo "Commit .seo-audit.json as the production baseline." >&2
            exit 1
          fi`;
  return `name: SEO preview regression check

on:
  pull_request:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
${actionSteps(`
          url: \${{ vars.SEO_AUDIT_PREVIEW_URL }}
          baseline: .seo-audit.json`, preflight)}`;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function shouldReplace(path: string, options: Required<Pick<InitializeProjectOptions, "force" | "interactive">> & Pick<InitializeProjectOptions, "ask">): Promise<boolean> {
  if (options.force) return true;
  if (!options.interactive || !options.ask) return false;
  const answer = await options.ask(`${path} already exists. Replace it? [y/N] `);
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

async function writeProtectedFile(
  path: string,
  content: string,
  options: Required<Pick<InitializeProjectOptions, "force" | "interactive">> & Pick<InitializeProjectOptions, "ask">,
): Promise<InitFileResult> {
  const existing = await readExisting(path);
  if (existing === content) return { path, status: "unchanged" };
  if (existing !== null && !(await shouldReplace(path, options))) return { path, status: "skipped" };
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, existing === null ? { encoding: "utf8", flag: "wx" } : { encoding: "utf8" });
  } catch (error) {
    if (existing === null && errorCode(error) === "EEXIST") return { path, status: "skipped" };
    throw error;
  }
  return { path, status: existing === null ? "created" : "updated" };
}

async function updateGitignore(
  path: string,
  options: Required<Pick<InitializeProjectOptions, "force" | "yes" | "interactive">> & Pick<InitializeProjectOptions, "ask">,
): Promise<InitFileResult> {
  const existing = await readExisting(path);
  const lines = new Set((existing ?? "").split(/\r?\n/u));
  const missing = GITIGNORE_RECOMMENDATIONS.filter((entry) => !lines.has(entry));
  if (missing.length === 0) return { path, status: "unchanged" };
  if (existing !== null && !options.force && !options.yes) {
    if (!options.interactive || !options.ask) return { path, status: "skipped" };
    const answer = await options.ask(`Add SEO Crawl Audit recommendations to ${path}? [Y/n] `);
    if (["n", "no"].includes(answer.trim().toLowerCase())) return { path, status: "skipped" };
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  const heading = existing === null || !existing.includes("# SEO Crawl Audit") ? "# SEO Crawl Audit\n" : "";
  const addition = `${prefix}${heading}${missing.join("\n")}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${existing ?? ""}${addition}`, "utf8");
  return { path, status: existing === null ? "created" : "updated" };
}

export async function initializeProject(options: InitializeProjectOptions = {}): Promise<InitResult> {
  const directory = resolve(options.directory ?? process.cwd());
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const prompt = options.ask ?? defaultAsk;
  let rawUrl = options.url?.trim() ?? "";
  if (!rawUrl && interactive && !options.yes) rawUrl = await prompt("Full site URL: ");
  if (!rawUrl) throw new Error("init requires a full site URL");
  const url = normalizeSiteUrl(rawUrl);

  let rawWorkflow = options.workflow;
  if (rawWorkflow === undefined && interactive && !options.yes) {
    rawWorkflow = await prompt("GitHub workflow [none/manual/scheduled/pull-request] (none): ");
  }
  const workflow = parseWorkflow(rawWorkflow);
  const configPath = options.configPath
    ? (isAbsolute(options.configPath) ? options.configPath : resolve(directory, options.configPath))
    : join(directory, DEFAULT_CONFIG_FILE);
  const fileOptions = {
    force: options.force ?? false,
    yes: options.yes ?? false,
    interactive,
    ask: prompt,
  };
  const files: InitFileResult[] = [
    await writeProtectedFile(configPath, configContent(url), fileOptions),
    await updateGitignore(join(directory, ".gitignore"), fileOptions),
  ];
  if (workflow !== "none") {
    files.push(await writeProtectedFile(join(directory, DEFAULT_WORKFLOW_FILE), workflowContent(workflow), fileOptions));
  }
  return { directory, url, workflow, files };
}

export async function initCommand(url: string | undefined, values: CliValues): Promise<number> {
  const result = await initializeProject({
    ...(values.directory !== undefined ? { directory: values.directory } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    ...(values.workflow !== undefined ? { workflow: values.workflow } : {}),
    ...(values.yes !== undefined ? { yes: values.yes } : {}),
    ...(values.force !== undefined ? { force: values.force } : {}),
  });
  if (values.json) {
    console.log(JSON.stringify({ command: "init", ...result }, null, 2));
    return 0;
  }
  console.log(`Initialized SEO Crawl Audit for ${result.url}`);
  for (const file of result.files) console.log(`  ${file.status.padEnd(9)} ${file.path}`);
  if (result.workflow === "pull-request") {
    console.log("Set the SEO_AUDIT_PREVIEW_URL repository variable and commit .seo-audit.json before enabling the PR check.");
  }
  console.log("Review seo-audit.config.json, then run: seo-audit scan");
  return 0;
}
