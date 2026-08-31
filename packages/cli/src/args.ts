import { parseArgs } from "node:util";
import { resolveConfig, type ScanConfigInput, type ScanConfigV1, type SnapshotV2 } from "@seo-crawl-audit/core";

export interface CliValues {
  baseline?: string;
  config?: string;
  output?: string;
  report?: string;
  "no-report"?: boolean;
  "no-cache"?: boolean;
  pages?: string;
  all?: boolean;
  "max-pages"?: string;
  concurrency?: string;
  delay?: string;
  timeout?: string;
  sitemap?: string;
  "no-sitemap"?: boolean;
  "include-query"?: boolean;
  "ignore-robots"?: boolean;
  strict?: boolean;
  json?: boolean;
  help?: boolean;
  version?: boolean;
  production?: string;
  preview?: string;
  "production-headers-env"?: string;
  "preview-headers-env"?: string;
  "history-dir"?: string;
  "no-history"?: boolean;
  from?: string;
  to?: string;
  directory?: string;
  workflow?: string;
  yes?: boolean;
  force?: boolean;
  __config?: Partial<ScanConfigV1>;
}

export function parseCliArgs(args: string[]): { values: CliValues; positionals: string[] } {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      baseline: { type: "string" }, config: { type: "string" }, output: { type: "string" }, report: { type: "string" },
      "no-report": { type: "boolean" }, "no-cache": { type: "boolean" }, pages: { type: "string" }, all: { type: "boolean" },
      "max-pages": { type: "string" }, concurrency: { type: "string" }, delay: { type: "string" }, timeout: { type: "string" },
      sitemap: { type: "string" }, "no-sitemap": { type: "boolean" }, "include-query": { type: "boolean" },
      "ignore-robots": { type: "boolean" }, strict: { type: "boolean" }, json: { type: "boolean" },
      help: { type: "boolean" }, version: { type: "boolean" },
      production: { type: "string" }, preview: { type: "string" },
      "production-headers-env": { type: "string" }, "preview-headers-env": { type: "string" },
      "history-dir": { type: "string" }, "no-history": { type: "boolean" },
      from: { type: "string" }, to: { type: "string" },
      directory: { type: "string" }, workflow: { type: "string" },
      yes: { type: "boolean" }, force: { type: "boolean" },
    },
  }) as { values: CliValues; positionals: string[] };
}

export function withFileConfig(values: CliValues, config: Partial<ScanConfigV1>): CliValues {
  return { ...values, __config: config };
}

function integer(value: string | undefined, name: string, fallback: number, allowZero = false): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }
  return parsed;
}

export function scanConfig(url: string, values: CliValues, baseline?: SnapshotV2): ScanConfigInput {
  if (values.sitemap && values["no-sitemap"]) throw new Error("--sitemap and --no-sitemap cannot be used together");
  const saved: Partial<ScanConfigV1> = baseline?.config ?? {};
  const file = values.__config ?? {};
  const cli: Partial<ScanConfigV1> & { url: string } = {
    url,
    schemaVersion: 1,
    maxPages: integer(values.pages ?? values["max-pages"], values.pages !== undefined ? "--pages" : "--max-pages", file.maxPages ?? saved.maxPages ?? 100),
    concurrency: integer(values.concurrency, "--concurrency", file.concurrency ?? saved.concurrency ?? 5),
    delay: integer(values.delay, "--delay", file.delay ?? saved.delay ?? 100, true),
    timeout: integer(values.timeout, "--timeout", file.timeout ?? saved.timeout ?? 10_000),
  };
  if (values["no-sitemap"]) cli.sitemap = "none";
  else if (values.sitemap) cli.sitemap = values.sitemap;
  if (values["include-query"] !== undefined) cli.includeQuery = values["include-query"];
  if (values["ignore-robots"] !== undefined) cli.respectRobots = !values["ignore-robots"];
  return resolveConfig(cli, file, saved);
}
