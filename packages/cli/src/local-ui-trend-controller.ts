import { Worker } from "node:worker_threads";
import { readHistoryCatalog, type TrendLimit, type TrendSummaryV1 } from "@seo-crawl-audit/core/node";
import { ENGINE_VERSION, RULE_SET_VERSION } from "@seo-crawl-audit/core";

interface TrendState {
  status: "idle" | "running" | "ready" | "cancelled" | "error";
  completed: number;
  total: number;
  message: string | null;
  resultReady: boolean;
}

export class LocalTrendController {
  private active: Worker | null = null;
  private state: TrendState = { status: "idle", completed: 0, total: 0, message: null, resultReady: false };
  private latest: TrendSummaryV1 | null = null;
  private cache = new Map<string, TrendSummaryV1>();

  constructor(private readonly directory: string) {}
  status(): TrendState { return { ...this.state }; }
  result(): TrendSummaryV1 | null { return this.latest; }
  busy(): boolean { return this.active !== null; }

  async start(input: { siteUrl?: string; limit: TrendLimit; ruleId?: string; template?: string }): Promise<void> {
    if (this.active) throw new Error("trend calculation is already running");
    const catalog = await readHistoryCatalog(this.directory);
    const selectedSite = input.siteUrl ?? catalog.entries[0]?.siteUrl ?? null;
    // Suppressions expire at the end of a UTC day; midnight invalidation is conservative.
    const day = new Date().toISOString().slice(0, 10);
    const key = JSON.stringify({ revision: catalog.revision, warnings: catalog.warnings, site: selectedSite, limit: input.limit,
      rule: input.ruleId, template: input.template, engine: ENGINE_VERSION, rules: RULE_SET_VERSION, day });
    const cached = this.cache.get(key);
    if (cached) { this.latest = cached; this.state = { status: "ready", completed: cached.points.length, total: cached.points.length, message: null, resultReady: true }; return; }
    const worker = new Worker(new URL("./trend-worker.js", import.meta.url), { workerData: { directory: this.directory,
      options: { siteUrl: selectedSite ?? undefined, limit: input.limit, ruleId: input.ruleId, template: input.template } } });
    this.active = worker;
    this.state = { status: "running", completed: 0, total: Math.min(input.limit, catalog.entries.filter((entry) => entry.siteUrl === selectedSite).length), message: null, resultReady: this.latest !== null };
    let completedSummary: TrendSummaryV1 | null = null;
    worker.on("message", (message: { type: "progress"; completed: number; total: number } | { type: "result"; summary: TrendSummaryV1 } | { type: "error"; message: string }) => {
      if (this.active !== worker) return;
      if (message.type === "progress") this.state = { ...this.state, completed: message.completed, total: message.total };
      else if (message.type === "result") completedSummary = message.summary;
      else this.state = { ...this.state, message: message.message };
    });
    worker.once("error", (error) => { if (this.active === worker) this.state = { ...this.state, message: error.message }; });
    worker.once("exit", (code) => {
      if (this.active !== worker) return;
      this.active = null;
      if (code === 0 && completedSummary) {
        this.latest = completedSummary;
        this.cache.set(key, completedSummary);
        if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
        this.state = { status: "ready", completed: completedSummary.points.length, total: completedSummary.points.length, message: null, resultReady: true };
      } else this.state = { ...this.state, status: "error", message: this.state.message ?? `trend worker exited with code ${code}`, resultReady: this.latest !== null };
    });
  }

  async cancel(): Promise<boolean> {
    const worker = this.active;
    if (!worker) return false;
    this.active = null;
    await worker.terminate();
    this.state = { ...this.state, status: "cancelled", message: null, resultReady: this.latest !== null };
    return true;
  }
}
