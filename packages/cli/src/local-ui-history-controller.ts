import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readHistoryCatalog, type HistoryCatalogEntry } from "@seo-crawl-audit/core/node";

type Phase = "read" | "evaluate" | "render" | "write";
interface ComparisonManifest { schemaVersion: 1; jobId: string; fromId: string; toId: string; siteUrl: string; completedAt: string }
interface JobState { status: "idle" | "running" | "ready" | "error"; jobId: string | null; phase: Phase | null; message: string | null; reportReady: boolean }

function fileError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export class HistoryRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

export class LocalHistoryController {
  private active: { worker: Worker; jobId: string; directory: string } | null = null;
  private committing = false;
  private state: JobState = { status: "idle", jobId: null, phase: null, message: null, reportReady: false };
  private manifest: ComparisonManifest | null = null;

  constructor(private readonly historyDirectory: string, private readonly comparisonsDirectory: string) {}

  async initialize(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(join(this.comparisonsDirectory, "latest.json"), "utf8"));
      if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1
        || !("jobId" in value) || typeof value.jobId !== "string" || !/^[a-f0-9-]{36}$/.test(value.jobId)) return;
      const manifest = value as ComparisonManifest;
      await Promise.all([
        readFile(join(this.comparisonsDirectory, manifest.jobId, "report.html")),
        readFile(join(this.comparisonsDirectory, manifest.jobId, "summary.json")),
      ]);
      this.manifest = manifest;
      this.state = { status: "ready", jobId: manifest.jobId, phase: null, message: null, reportReady: true };
    } catch (error) { if (!fileError(error, "ENOENT")) this.state = { ...this.state, message: "Saved comparison could not be restored." }; }
  }

  status(): JobState { return { ...this.state }; }
  busy(): boolean { return this.active !== null || this.committing; }

  async list(siteUrl: string | null, limit: number, cursor: string | null, offset = 0): Promise<{ status: number; body: unknown }> {
    const catalog = await readHistoryCatalog(this.historyDirectory);
    const selectedSite = siteUrl ?? catalog.entries[0]?.siteUrl ?? null;
    const entries = selectedSite ? catalog.entries.filter((entry) => entry.siteUrl === selectedSite) : catalog.entries;
    let position = offset;
    if (cursor) {
      let decoded: { revision?: unknown; offset?: unknown; siteUrl?: unknown };
      try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as typeof decoded; }
      catch { return { status: 400, body: { error: "invalid history cursor" } }; }
      if (!decoded || !Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0 || decoded.siteUrl !== selectedSite) return { status: 400, body: { error: "invalid history cursor" } };
      if (decoded.revision !== catalog.revision) return { status: 409, body: { error: "history changed; reload the run list", reloadNeeded: true } };
      position = Number(decoded.offset);
    }
    const runs = entries.slice(position, position + limit).map((entry) => ({ runId: entry.runId, generatedAt: entry.generatedAt,
      siteUrl: entry.siteUrl, engineVersion: entry.engineVersion, ruleSetVersion: entry.ruleSetVersion,
      configurationHash: entry.configurationHash, pages: entry.pages, partial: entry.partial, truncated: entry.truncated }));
    const nextOffset = position + runs.length;
    const nextCursor = nextOffset < entries.length ? Buffer.from(JSON.stringify({ revision: catalog.revision, siteUrl: selectedSite, offset: nextOffset })).toString("base64url") : null;
    return { status: 200, body: { schemaVersion: 1, revision: catalog.revision, total: entries.length, offset: position, limit, runs, nextCursor, warnings: catalog.warnings.length, rebuilding: false } };
  }

  async report(): Promise<string | null> {
    if (!this.manifest) return null;
    return readFile(join(this.comparisonsDirectory, this.manifest.jobId, "report.html"), "utf8");
  }

  async result(): Promise<unknown | null> {
    if (!this.manifest) return null;
    return JSON.parse(await readFile(join(this.comparisonsDirectory, this.manifest.jobId, "summary.json"), "utf8")) as unknown;
  }

  async export(format: "markdown" | "csv"): Promise<string | null> {
    if (!this.manifest) return null;
    const name = format === "markdown" ? "summary.md" : "groups.csv";
    try { return await readFile(join(this.comparisonsDirectory, this.manifest.jobId, name), "utf8"); }
    catch (error) { if (fileError(error, "ENOENT")) return null; throw error; }
  }

  async start(fromId: string, toId: string): Promise<{ jobId: string }> {
    if (this.busy()) throw new HistoryRequestError("a comparison is already running", 409);
    if (fromId === toId) throw new HistoryRequestError("select two different runs", 400);
    const catalog = await readHistoryCatalog(this.historyDirectory);
    const from = catalog.entries.find((entry) => entry.runId === fromId);
    const to = catalog.entries.find((entry) => entry.runId === toId);
    if (!from || !to) throw new HistoryRequestError("history run not found; reload the run list", 404);
    if (from.siteUrl !== to.siteUrl) throw new HistoryRequestError("history runs must belong to the same site URL", 409);
    if (from.generatedAt > to.generatedAt) throw new HistoryRequestError("Before run is newer than After run; swap the runs", 409);
    const jobId = randomUUID();
    const directory = join(this.comparisonsDirectory, jobId);
    const worker = new Worker(new URL("./comparison-worker.js", import.meta.url), {
      workerData: { historyDirectory: this.historyDirectory, outputDirectory: directory, from, to, evaluatedAt: new Date().toISOString() },
    });
    this.active = { worker, jobId, directory };
    this.state = { status: "running", jobId, phase: "read", message: null, reportReady: this.manifest !== null };
    worker.on("message", (message: { phase?: Phase | "complete" | "error"; message?: string }) => {
      if (this.active?.jobId !== jobId) return;
      if (message.phase === "error") this.state = { ...this.state, message: message.message ?? "Comparison failed." };
      else if (message.phase && message.phase !== "complete") this.state = { ...this.state, phase: message.phase };
    });
    worker.once("error", (error) => { if (this.active?.jobId === jobId) this.state = { ...this.state, message: error.message }; });
    worker.once("exit", (code) => { void this.finish(jobId, from, to, code); });
    return { jobId };
  }

  private async finish(jobId: string, from: HistoryCatalogEntry, to: HistoryCatalogEntry, code: number): Promise<void> {
    if (this.active?.jobId !== jobId) return;
    const directory = this.active.directory;
    this.active = null;
    this.committing = true;
    try {
      if (code !== 0 || this.state.message) throw new Error(this.state.message ?? `Comparison worker exited with code ${code}`);
      await Promise.all(["report.html", "summary.json", "summary.md", "groups.csv"].map((name) => readFile(join(directory, name))));
      const manifest: ComparisonManifest = { schemaVersion: 1, jobId, fromId: from.runId, toId: to.runId, siteUrl: to.siteUrl, completedAt: new Date().toISOString() };
      await mkdir(this.comparisonsDirectory, { recursive: true });
      const temporary = join(this.comparisonsDirectory, `latest.${jobId}.tmp`);
      await writeFile(temporary, `${JSON.stringify(manifest)}\n`, "utf8");
      await rename(temporary, join(this.comparisonsDirectory, "latest.json"));
      this.manifest = manifest;
      this.state = { status: "ready", jobId, phase: null, message: null, reportReady: true };
    } catch (error) {
      this.state = { status: "error", jobId, phase: null, message: error instanceof Error ? error.message : String(error), reportReady: this.manifest !== null };
      await rm(directory, { recursive: true, force: true });
    } finally {
      this.committing = false;
    }
  }

  async cancel(): Promise<boolean> {
    const active = this.active;
    if (!active) return false;
    this.active = null;
    await active.worker.terminate();
    await rm(active.directory, { recursive: true, force: true });
    this.state = { status: this.manifest ? "ready" : "idle", jobId: this.manifest?.jobId ?? null, phase: null, message: "Comparison cancelled.", reportReady: this.manifest !== null };
    return true;
  }
}
