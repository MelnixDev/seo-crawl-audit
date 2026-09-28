import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { migrateSnapshot } from "./baseline.js";
import type { SnapshotV2 } from "./types.js";

export interface HistoryCatalogEntry {
  runId: string;
  name: string;
  size: number;
  mtimeMs: number;
  digest: string;
  generatedAt: string;
  siteUrl: string;
  engineVersion: string;
  ruleSetVersion: string;
  configurationHash: string;
  pages: number;
  partial: boolean;
  truncated: boolean;
}

export interface HistoryCatalog {
  schemaVersion: 1;
  revision: string;
  entries: HistoryCatalogEntry[];
  warnings: string[];
}

function digest(content: string): string { return createHash("sha256").update(content).digest("hex"); }
function safeName(name: string): boolean { return basename(name) === name && name.endsWith(".snapshot.json") && !name.includes("/") && !name.includes("\\"); }

async function inspect(directory: string, name: string): Promise<{ content: string; size: number; mtimeMs: number }> {
  if (!safeName(name)) throw new Error("invalid history file name");
  const path = join(directory, name);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("history entry is not a regular file");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error("history file changed while opening");
    const content = await handle.readFile("utf8");
    const after = await lstat(path);
    if (!after.isFile() || after.ino !== opened.ino || after.dev !== opened.dev || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("history file changed while reading");
    return { content, size: opened.size, mtimeMs: opened.mtimeMs };
  } finally { await handle.close(); }
}

/** Rebuildable bounded catalogue: only one snapshot is parsed at a time. */
export async function readHistoryCatalog(directory: string): Promise<HistoryCatalog> {
  const root = resolve(directory);
  let names: string[];
  try { names = (await readdir(root)).filter(safeName).sort(); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { schemaVersion: 1, revision: digest(""), entries: [], warnings: [] };
    throw error;
  }
  const cachePath = join(root, "catalog.v1.json");
  let cached = new Map<string, HistoryCatalogEntry>();
  try {
    const data: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (data && typeof data === "object" && "entries" in data && Array.isArray(data.entries)) {
      cached = new Map(data.entries.filter((entry: unknown) => entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string").map((entry: HistoryCatalogEntry) => [entry.name, entry]));
    }
  } catch { /* The catalogue is a disposable cache. */ }
  const entries: HistoryCatalogEntry[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    try {
      const metadata = await lstat(join(root, name));
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not a regular file");
      const old = cached.get(name);
      if (old && old.size === metadata.size && old.mtimeMs === metadata.mtimeMs && old.digest && old.runId) { entries.push(old); continue; }
      const file = await inspect(root, name);
      const hash = digest(file.content);
      const snapshot = migrateSnapshot(JSON.parse(file.content));
      entries.push({ runId: digest(`${name}\0${hash}`), name, size: file.size, mtimeMs: file.mtimeMs, digest: hash,
        generatedAt: snapshot.generatedAt, siteUrl: snapshot.siteUrl, engineVersion: snapshot.engineVersion,
        ruleSetVersion: snapshot.ruleSetVersion, configurationHash: snapshot.configurationHash,
        pages: snapshot.pages.length, partial: snapshot.partial, truncated: snapshot.truncated });
    } catch (error) { warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  entries.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || right.runId.localeCompare(left.runId));
  const revision = digest(entries.map((entry) => entry.runId).join("\n"));
  const catalog: HistoryCatalog = { schemaVersion: 1, revision, entries, warnings };
  const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog)}\n`, "utf8");
  await rename(temporary, cachePath);
  return catalog;
}

export async function readCatalogSnapshot(directory: string, entry: HistoryCatalogEntry): Promise<SnapshotV2> {
  const file = await inspect(resolve(directory), entry.name);
  if (file.size !== entry.size || digest(file.content) !== entry.digest || digest(`${entry.name}\0${entry.digest}`) !== entry.runId) throw new Error("history run changed; reload the catalogue");
  return migrateSnapshot(JSON.parse(file.content));
}
