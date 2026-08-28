import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { migrateSnapshot } from "./baseline.js";
import { DEFAULT_CONFIG_FILE, validateConfig } from "./config.js";
import { renderHtmlReport } from "./html-report.js";
import type { HistorySnapshotRecord, ReportData, ReportOptions, ScanConfigV1, SnapshotV2 } from "./types.js";

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

export async function writeReport(
  path: string,
  data: ReportData,
  options: ReportOptions = {},
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, renderHtmlReport(data, options), "utf8");
  await rename(temporaryPath, path);
}

export const writeHtmlReport = writeReport;

function historyFileName(snapshot: SnapshotV2): string {
  const timestamp = snapshot.generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  return `${timestamp}-${snapshot.configurationHash.slice(0, 8)}.snapshot.json`;
}

/** Saves a full local snapshot using an atomic write and returns its path. */
export async function writeHistorySnapshot(directory: string, snapshot: SnapshotV2): Promise<string> {
  const resolvedDirectory = resolve(directory);
  await mkdir(resolvedDirectory, { recursive: true });
  const path = join(resolvedDirectory, historyFileName(snapshot));
  await writeSnapshot(path, snapshot);
  return path;
}

/** Reads local history in chronological order, optionally filtered by site. */
export async function readHistorySnapshots(directory: string, siteUrl?: string): Promise<HistorySnapshotRecord[]> {
  const resolvedDirectory = resolve(directory);
  let names: string[];
  try {
    names = await readdir(resolvedDirectory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const records: HistorySnapshotRecord[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".snapshot.json")).sort()) {
    const path = join(resolvedDirectory, name);
    const snapshot = await readSnapshot(path);
    if (!siteUrl || snapshot.siteUrl === siteUrl) records.push({ path, snapshot });
  }
  return records.sort((left, right) => left.snapshot.generatedAt.localeCompare(right.snapshot.generatedAt) || left.path.localeCompare(right.path));
}
