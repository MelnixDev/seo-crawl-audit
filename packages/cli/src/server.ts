import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  audit,
  buildHistorySeries,
  planScan,
  scan,
  type ScanEvent,
  type ScanPlan,
  type PageRenderer,
  type SiteMetrics,
  type SnapshotV2,
} from "@seo-crawl-audit/core";
import {
  createFileCheckpointStore,
  externalSiteMetrics,
  loadReportSiteMetrics,
  mergeSiteMetrics,
  readHistorySnapshots,
  readSiteMetricsState,
  readSnapshot,
  writeHistorySnapshot,
  writeReport,
  writeSnapshot,
  writeSiteMetricsState,
} from "@seo-crawl-audit/core/node";
import { createPlaywrightRenderer } from "@seo-crawl-audit/renderer-playwright";
import { collectLocalUiMetrics } from "./local-ui-metrics-controller.js";
import { LOCAL_UI_PAGE } from "./local-ui-page.js";
import { LocalHistoryController } from "./local-ui-history-controller.js";
import { decideFullScan, resolveLocalScanConfig } from "./local-ui-scan-controller.js";

interface UiState {
  status: "idle" | "planning" | "scanning" | "complete" | "cancelled" | "error";
  url: string | null;
  completed: number;
  total: number;
  retries: number;
  errors: number;
  startedAt: string | null;
  currentUrl: string | null;
  message: string | null;
  reportReady: boolean;
  summary: { pages: number; error: number; warning: number; info: number } | null;
}

export interface LocalUiOptions {
  host?: string;
  port?: number;
  directory?: string;
  initialUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface LocalUiServer {
  url: string;
  close(): Promise<void>;
}

export interface ServeCommandOptions {
  openBrowser?: boolean;
  initialUrl?: string;
  launchBrowser?: (url: string) => Promise<void>;
}

export interface BrowserLaunchCommand {
  command: string;
  args: string[];
}

export function browserLaunchCommand(url: string, platform = process.platform): BrowserLaunchCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export async function launchDefaultBrowser(url: string): Promise<void> {
  const launch = browserLaunchCommand(url);
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolveLaunch();
    });
  });
}

async function loadRenderer(mode: unknown): Promise<PageRenderer | undefined> {
  if (mode === undefined || mode === "http") return undefined;
  if (mode !== "playwright") throw new Error("render mode must be http or playwright");
  return createPlaywrightRenderer();
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let content = "";
  for await (const chunk of request) {
    content += String(chunk);
    if (content.length > 64 * 1024) throw new Error("request body is too large");
  }
  const parsed: unknown = JSON.parse(content || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

export async function createLocalUiServer(options: LocalUiOptions = {}): Promise<LocalUiServer> {
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("local UI may only bind to a loopback address");
  const directory = resolve(options.directory ?? process.cwd());
  const snapshotPath = resolve(directory, ".seo-audit.json");
  const reportPath = resolve(directory, "seo-audit-report.html");
  const checkpointPath = resolve(directory, ".seo-audit.checkpoint.ndjson");
  const metricsPath = resolve(directory, ".seo-audit.metrics.json");
  const historyPath = resolve(directory, ".seo-audit/history");
  const historyController = new LocalHistoryController(historyPath, resolve(directory, ".seo-audit/comparisons"));
  await historyController.initialize();
  const fetch = options.fetch ?? globalThis.fetch;
  let reportHtml: string | null = null;
  let existingSiteUrl: string | null = null;
  let savedSnapshot: SnapshotV2 | null = null;
  try {
    savedSnapshot = await readSnapshot(snapshotPath);
    existingSiteUrl = savedSnapshot.siteUrl;
    reportHtml = await readFile(reportPath, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  let controller: AbortController | null = null;
  let metricsRunning = false;
  let pendingLargePlan: { key: string; plan: ScanPlan; expiresAt: number } | null = null;
  let state: UiState = { status: "idle", url: options.initialUrl ?? existingSiteUrl, completed: 0, total: 0, retries: 0, errors: 0, startedAt: null, currentUrl: null, message: "Ready to scan locally.", reportReady: false, summary: null };
  if (savedSnapshot && reportHtml) {
    const counts = audit(savedSnapshot).reduce((total, issue) => ({ ...total, [issue.severity]: total[issue.severity] + 1 }), { error: 0, warning: 0, info: 0 });
    state = { ...state, completed: savedSnapshot.pages.length, total: savedSnapshot.config.maxPages, startedAt: savedSnapshot.generatedAt, reportReady: true, summary: { pages: savedSnapshot.pages.length, ...counts }, message: `Saved report available for ${savedSnapshot.siteUrl}.` };
  }
  const eventStreams = new Set<ServerResponse>();
  const publish = () => {
    const event = `data: ${JSON.stringify(state)}\n\n`;
    for (const stream of eventStreams) stream.write(event);
  };

  const renderCurrentReport = async (snapshot: SnapshotV2, siteMetrics: SiteMetrics) => {
    const issues = audit(snapshot);
    const historyRecords = await readHistorySnapshots(historyPath, snapshot.siteUrl);
    const history = buildHistorySeries(historyRecords.map((record) => record.snapshot)) ?? undefined;
    const reportData = {
      mode: "scan" as const,
      startUrl: snapshot.siteUrl,
      generatedAt: snapshot.generatedAt,
      pages: snapshot.pages,
      pageDetails: snapshot.pages,
      issues,
      partial: snapshot.partial,
      complete: !snapshot.partial && !snapshot.truncated,
      targetPages: snapshot.config.maxPages,
      engineVersion: snapshot.engineVersion,
      ruleSetVersion: snapshot.ruleSetVersion,
      branding: snapshot.config.report,
      siteMetrics,
      ...(history ? { history } : {}),
    };
    await writeReport(reportPath, reportData);
    reportHtml = await readFile(reportPath, "utf8");
    return issues;
  };

  if (savedSnapshot && reportHtml) {
    const siteMetrics = await loadReportSiteMetrics(savedSnapshot, metricsPath, {
      onWarning: (message) => console.error(`Warning: ${message}`),
    });
    await renderCurrentReport(savedSnapshot, siteMetrics);
  }

  const startScan = async (input: Record<string, unknown>, plan: ScanPlan, activeController: AbortController) => {
    let renderer: PageRenderer | undefined;
    try {
      renderer = await loadRenderer(input.render);
      const onEvent = (event: ScanEvent) => {
        if (event.type === "sitemap") state.message = event.sitemap ? `Sitemap found with ${event.candidateCount ?? event.sitemap.urls.length} URL(s).` : "No sitemap found; discovering internal links.";
        if (event.type === "scan-start") { state.status = "scanning"; state.total = event.total; state.message = "Crawling pages…"; }
        if (event.type === "retry") state.retries += 1;
        if (event.type === "progress") {
          state.completed = event.completed;
          state.currentUrl = event.page.url;
          if (event.page.error || (event.page.status !== null && event.page.status >= 400)) state.errors += 1;
        }
        publish();
      };
      const store = createFileCheckpointStore(checkpointPath);
      const result = await scan(plan, { fetch, signal: activeController.signal, renderer, checkpointStore: store, retainCheckpoint: true, onEvent });
      if (!result.snapshot.partial) await writeHistorySnapshot(historyPath, result.snapshot);
      const [issues] = await Promise.all([
        renderCurrentReport(result.snapshot, await loadReportSiteMetrics(result.snapshot, metricsPath, {
          onWarning: (message) => console.error(`Warning: ${message}`),
        })),
        writeSnapshot(snapshotPath, result.snapshot),
      ]);
      const counts = issues.reduce((total, issue) => ({ ...total, [issue.severity]: total[issue.severity] + 1 }), { error: 0, warning: 0, info: 0 });
      if (!result.snapshot.partial) await store.clearCurrent();
      existingSiteUrl = result.snapshot.siteUrl;
      state = { ...state, status: result.partial ? "cancelled" : "complete", completed: result.snapshot.pages.length, currentUrl: null, message: result.partial ? "Partial results and checkpoint were saved." : "Scan complete. Snapshot and report were saved locally.", reportReady: true, summary: { pages: result.snapshot.pages.length, ...counts } };
      publish();
    } catch (error) {
      state = { ...state, status: activeController.signal.aborted ? "cancelled" : "error", message: error instanceof Error ? error.message : String(error), currentUrl: null };
      publish();
    } finally {
      await renderer?.close?.();
      if (controller === activeController) controller = null;
    }
  };

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      const path = requestUrl.pathname;
      if (request.method === "GET" && path === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:", "x-content-type-options": "nosniff" });
        response.end(LOCAL_UI_PAGE);
        return;
      }
      if (request.method === "GET" && path === "/api/state") { json(response, 200, state); return; }
      if (request.method === "GET" && path === "/api/history/comparison") { json(response, 200, historyController.status()); return; }
      if (request.method === "GET" && path === "/api/history/comparison/result") {
        const result = await historyController.result();
        if (!result) { json(response, 404, { error: "comparison is not ready" }); return; }
        json(response, 200, result);
        return;
      }
      if (request.method === "GET" && path === "/comparison") {
        const html = await historyController.report();
        if (!html) { json(response, 404, { error: "comparison report is not ready" }); return; }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'", "x-content-type-options": "nosniff" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && (path === "/comparison.md" || path === "/comparison.csv")) {
        const markdown = path.endsWith(".md");
        const value = await historyController.export(markdown ? "markdown" : "csv");
        if (value === null) { json(response, 404, { error: "comparison export is not ready" }); return; }
        response.writeHead(200, { "content-type": markdown ? "text/markdown; charset=utf-8" : "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="seo-crawl-audit-comparison.${markdown ? "md" : "csv"}"`,
          "x-content-type-options": "nosniff", "cache-control": "no-store" });
        response.end(value);
        return;
      }
      if (request.method === "GET" && path === "/api/history") {
        const siteUrl = requestUrl.searchParams.get("siteUrl");
        const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get("offset") ?? "0", 10) || 0);
        const limit = Math.min(100, Math.max(1, Number.parseInt(requestUrl.searchParams.get("limit") ?? "20", 10) || 20));
        const page = await historyController.list(siteUrl, limit, requestUrl.searchParams.get("cursor"), offset);
        json(response, page.status, page.body);
        return;
      }
      if (request.method === "GET" && path === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
        eventStreams.add(response);
        response.write(`data: ${JSON.stringify(state)}\n\n`);
        request.once("close", () => eventStreams.delete(response));
        return;
      }
      if (request.method === "GET" && path === "/report") {
        if (!reportHtml) { json(response, 404, { error: "report is not ready" }); return; }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" }); response.end(reportHtml); return;
      }
      if (request.method === "POST" && (path === "/api/history/compare" || path === "/api/history/comparison/cancel")) {
        const origin = request.headers.origin;
        const address = server.address();
        if (origin && address && typeof address !== "string") {
          const source = new URL(origin);
          if ((source.hostname !== "127.0.0.1" && source.hostname !== "[::1]" && source.hostname !== "::1") || source.port !== String(address.port)) {
            json(response, 403, { error: "cross-origin requests are not allowed" }); return;
          }
        }
        if (path.endsWith("/cancel")) { json(response, 202, { cancelled: await historyController.cancel() }); return; }
        if (controller || metricsRunning || historyController.busy()) { json(response, 409, { error: "another local operation is running" }); return; }
        const input = await body(request);
        if (typeof input.fromId !== "string" || typeof input.toId !== "string" || !/^[a-f0-9]{64}$/.test(input.fromId) || !/^[a-f0-9]{64}$/.test(input.toId)) {
          json(response, 400, { error: "select two valid local run IDs" }); return;
        }
        try { json(response, 202, await historyController.start(input.fromId, input.toId)); }
        catch (error) { json(response, 409, { error: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (request.method === "POST" && path === "/api/scan") {
        const origin = request.headers.origin;
        const address = server.address();
        if (origin && address && typeof address !== "string") {
          const source = new URL(origin);
          if ((source.hostname !== "127.0.0.1" && source.hostname !== "[::1]" && source.hostname !== "::1") || source.port !== String(address.port)) {
            json(response, 403, { error: "cross-origin requests are not allowed" }); return;
          }
        }
        const input = await body(request);
        if (controller || metricsRunning || historyController.busy()) { json(response, 409, { error: "a scan, metrics update or comparison is already running" }); return; }
        const requestedUrl = new URL(String(input.url ?? ""));
        if (existingSiteUrl && new URL(existingSiteUrl).origin !== requestedUrl.origin && input.replaceExisting !== true) {
          json(response, 409, {
            error: `Existing results belong to ${existingSiteUrl}. Confirm replacement before scanning ${requestedUrl.origin}.`,
            existingSiteUrl,
            requestedSiteUrl: requestedUrl.href,
            requiresConfirmation: true,
          });
          return;
        }
        const baseConfig = resolveLocalScanConfig(input, requestedUrl.href);
        const activeController = new AbortController();
        controller = activeController;
        state = { status: "planning", url: baseConfig.url, completed: 0, total: baseConfig.maxPages, retries: 0, errors: 0, startedAt: new Date().toISOString(), currentUrl: null, message: "Discovering robots.txt and sitemap…", reportReady: false, summary: null };
        publish();
        const planKey = JSON.stringify([baseConfig, String(input.render ?? "http")]);
        let plan: ScanPlan;
        const reusablePlan = input.confirmLargeScan === true && pendingLargePlan?.key === planKey && pendingLargePlan.expiresAt > Date.now()
          ? pendingLargePlan.plan
          : null;
        pendingLargePlan = null;
        if (reusablePlan) {
          plan = reusablePlan;
        } else {
          try {
            plan = await planScan(baseConfig, { fetch, signal: activeController.signal });
          } catch (error) {
            controller = null;
            state = { ...state, status: activeController.signal.aborted ? "cancelled" : "error", message: error instanceof Error ? error.message : String(error) };
            publish();
            throw error;
          }
        }
        let decision;
        try {
          // A boolean from the browser is only an acknowledgement when it matches
          // the unexpired plan produced by the immediately preceding preflight.
          // Replanning must always produce a fresh warning, even if a client sends
          // confirmLargeScan on its first request or after changing parameters.
          decision = decideFullScan(plan, { ...input, confirmLargeScan: reusablePlan !== null });
        } catch (error) {
          controller = null;
          state = { ...state, status: "idle", message: error instanceof Error ? error.message : String(error) };
          publish();
          json(response, 409, { error: state.message, ...(input.profile === "full" && plan.mode !== "sitemap" ? { fullSitemapUnavailable: true } : {}) });
          return;
        }
        const limit = decision.limit;
        if (decision.confirmation) {
          pendingLargePlan = { key: planKey, plan, expiresAt: Date.now() + 5 * 60 * 1_000 };
          controller = null;
          state = { ...state, status: "idle", total: limit, message: `Ready to scan ${limit.toLocaleString("en-US")} sitemap URLs after confirmation.` };
          publish();
          json(response, 409, { requiresLargeScanConfirmation: true, ...decision.confirmation });
          return;
        }
        const config = { ...baseConfig, maxPages: limit };
        plan = { ...plan, config };
        if (existingSiteUrl && new URL(existingSiteUrl).origin !== requestedUrl.origin) {
          try { await unlink(metricsPath); } catch (error) {
            if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
          }
        }
        state = { ...state, total: limit };
        void startScan(input, plan, activeController);
        json(response, 202, { status: "started" });
        return;
      }
      if (request.method === "POST" && path === "/api/metrics") {
        const origin = request.headers.origin;
        const address = server.address();
        if (origin && address && typeof address !== "string") {
          const source = new URL(origin);
          if ((source.hostname !== "127.0.0.1" && source.hostname !== "[::1]" && source.hostname !== "::1") || source.port !== String(address.port)) {
            json(response, 403, { error: "cross-origin requests are not allowed" }); return;
          }
        }
        const input = await body(request);
        if (controller || metricsRunning || historyController.busy()) { json(response, 409, { error: "a scan, metrics update or comparison is already running" }); return; }
        metricsRunning = true;
        try {
        let snapshot: SnapshotV2;
        try {
          snapshot = await readSnapshot(snapshotPath);
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            json(response, 409, { error: "run an SEO scan before updating public metrics" }); return;
          }
          throw error;
        }
        let collected = await collectLocalUiMetrics(snapshot, input.googleEstimate, fetch);
        const manualEstimate = typeof input.googleEstimate === "number" ? input.googleEstimate : Number(input.googleEstimate);
        if (!Number.isSafeInteger(manualEstimate) || manualEstimate <= 0) {
          const previous = await readSiteMetricsState(metricsPath, snapshot.siteUrl);
          const savedManualGoogle = previous?.metrics.filter((metric) => metric.id === "search.google-site-estimate" && metric.source.id === "google-site-search-manual") ?? [];
          if (previous && savedManualGoogle.length > 0) {
            collected = mergeSiteMetrics(collected, { ...previous, metrics: savedManualGoogle });
          }
        }
        await writeSiteMetricsState(metricsPath, externalSiteMetrics(collected));
        await renderCurrentReport(snapshot, collected);
        state = { ...state, url: snapshot.siteUrl, startedAt: new Date().toISOString(), reportReady: true, message: "Public metrics updated without crawling pages." };
        publish();
        json(response, 200, { status: "complete", report: "/report" });
        } finally {
          metricsRunning = false;
        }
        return;
      }
      if (request.method === "POST" && path === "/api/cancel") {
        controller?.abort(new Error("cancelled from local UI"));
        json(response, 202, { status: controller ? "cancelling" : "idle" });
        return;
      }
      json(response, 404, { error: "not found" });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4179, host, () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local UI did not receive a TCP address");
  return {
    url: `http://${host === "::1" ? "[::1]" : host}:${address.port}/`,
    close: () => {
      for (const stream of eventStreams) stream.end();
      eventStreams.clear();
      return new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}

export async function serveCommand(
  port: number,
  signal?: AbortSignal,
  options: ServeCommandOptions = {},
): Promise<number> {
  const server = await createLocalUiServer({ port, ...(options.initialUrl ? { initialUrl: options.initialUrl } : {}) });
  console.log(`SEO Crawl Audit local UI is running at ${server.url}`);
  console.log("All scan data stays on this device. Press Ctrl+C to stop.");
  if (options.openBrowser !== false) {
    try {
      await (options.launchBrowser ?? launchDefaultBrowser)(server.url);
    } catch (error) {
      console.error(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Open ${server.url} manually.`);
    }
  }
  if (signal?.aborted) { await server.close(); return 130; }
  await new Promise<void>((resolveWait) => {
    signal?.addEventListener("abort", () => resolveWait(), { once: true });
  });
  await server.close();
  return signal?.aborted ? 130 : 0;
}
