import { access, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrateSnapshot } from "./baseline.js";
import { DEFAULT_CONFIG_FILE, validateConfig } from "./config.js";
import { renderHtmlReport } from "./html-report.js";
import type { ReportBranding, ScanConfigV1, SnapshotV2 } from "./types.js";

export async function findConfigFile(cwd = process.cwd()): Promise<string | null> {
  const path = resolve(cwd, DEFAULT_CONFIG_FILE);
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}

export async function loadConfig(path?: string | null): Promise<Partial<ScanConfigV1>> {
  const resolvedPath = path ? resolve(path) : await findConfigFile();
  if (!resolvedPath) return {};
  try {
    return validateConfig(JSON.parse(await readFile(resolvedPath, "utf8")));
  } catch (error) {
    throw new Error(`invalid config ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function writeSnapshot(path: string, snapshot: SnapshotV2): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export const writeBaseline = writeSnapshot;

export async function readSnapshot(path: string): Promise<SnapshotV2> {
  try {
    return migrateSnapshot(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`invalid snapshot JSON: ${path}`, { cause: error });
    }
    if (error instanceof Error && error.message.startsWith("unsupported")) {
      throw new Error(`unsupported or invalid baseline: ${path}`, { cause: error });
    }
    throw error;
  }
}

export const readBaseline = readSnapshot;

export interface ReportFileInput {
  mode?: "scan" | "check";
  startUrl?: string;
  generatedAt?: string;
  pages?: Array<{ url: string }>;
  issues?: Array<Record<string, unknown>>;
  newIssues?: Array<Record<string, unknown>>;
  ongoingIssues?: Array<Record<string, unknown>>;
  resolvedIssues?: Array<Record<string, unknown>>;
  unchangedIssues?: Array<Record<string, unknown>>;
  partial?: boolean;
  targetPages?: number | null;
  engineVersion?: string;
  ruleSetVersion?: string;
  branding?: ReportBranding;
}

export async function writeReport(
  path: string,
  data: ReportFileInput,
  options: { branding?: ReportBranding } = {},
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, renderHtmlReport(data, options), "utf8");
  await rename(temporaryPath, path);
}

export const writeHtmlReport = writeReport;
