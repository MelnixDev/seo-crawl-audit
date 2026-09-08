import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  audit,
  buildHistorySeries,
  buildSiteMetrics,
  collectSiteMetrics,
  createGoogleSiteEstimateProvider,
  createRdapDomainProvider,
  externalSiteMetrics,
  mergeSiteMetrics,
  planScan,
  resolveConfig,
  scan,
  type ScanEvent,
  type PageRenderer,
  type SiteMetric,
  type SiteMetrics,
  type SnapshotV2,
} from "@seo-crawl-audit/core";
import {
  createFileCheckpointStore,
  readHistorySnapshots,
  readSiteMetricsState,
  readSnapshot,
  writeHistorySnapshot,
  writeReport,
  writeSnapshot,
  writeSiteMetricsState,
} from "@seo-crawl-audit/core/node";
import { createPlaywrightRenderer } from "@seo-crawl-audit/renderer-playwright";

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

const PRODUCT_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%233157d5'/%3E%3Ccircle cx='27' cy='27' r='13' fill='none' stroke='white' stroke-width='6'/%3E%3Cpath d='m37 37 12 12' fill='none' stroke='white' stroke-linecap='round' stroke-width='6'/%3E%3Cpath d='m21 27 5 5 9-11' fill='none' stroke='white' stroke-linecap='round' stroke-linejoin='round' stroke-width='4'/%3E%3C/svg%3E";

function embedReport(html: string): string {
  const style = `<style id="seo-audit-embed-style">header,.report-nav{display:none!important}main{width:min(1600px,calc(100% - 24px));margin:16px auto 32px}.analytics{margin-bottom:12px}</style>`;
  return html.replace("</head>", `${style}</head>`);
}

function withManualGoogleEstimate(metrics: SiteMetrics, input: unknown): SiteMetrics {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) return metrics;
  const estimate: SiteMetric = {
    id: "search.google-site-estimate",
    label: { en: "Google site: estimate", uk: "Приблизно в Google (site:)" },
    value,
    unit: "count",
    source: { id: "google-site-search-manual", label: "Google site:" },
    observedAt: new Date().toISOString(),
    confidence: "low",
    status: "estimate",
    detail: { en: "Approximate public `site:` count entered locally after checking Google. It is not authoritative Search Console coverage.", uk: "Приблизну публічну кількість `site:` введено локально після перевірки Google. Це не точні дані Search Console." },
  };
  return { ...metrics, metrics: [...metrics.metrics.filter((metric) => metric.id !== estimate.id), estimate] };
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

const PAGE_TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="${PRODUCT_FAVICON}" type="image/svg+xml"><title>SEO Crawl Audit</title><style>
:root{color-scheme:light;--accent:#3157d5;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#64748b;--line:#dbe2ea}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}main{width:min(1200px,calc(100% - 32px));margin:48px auto}.brand{display:flex;align-items:center;gap:14px}.mark{display:grid;width:52px;height:52px;border-radius:14px;background:var(--accent);color:#fff;font-size:25px;font-weight:900;place-items:center}h1{margin:0;font-size:32px}.muted{color:var(--muted)}.panel{margin-top:24px;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 16px 45px rgba(31,42,68,.08)}.form{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:12px}label span{display:block;margin-bottom:5px;color:var(--muted)}input,select,button{width:100%;min-height:44px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit}.check{display:flex;align-items:center;gap:8px;margin-top:14px}.check input{width:18px;min-height:18px}.check span{margin:0}button{width:auto;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}button.secondary{background:#fff;color:var(--text)}button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;gap:10px;margin-top:16px}.progress{height:13px;margin:20px 0 10px;overflow:hidden;border-radius:999px;background:#e8edf3}.progress i{display:block;width:0;height:100%;background:var(--accent);transition:width .25s}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.stat{padding:14px;border-radius:12px;background:#f8fafc}.stat strong{display:block;font-size:23px}.status{font-weight:800;text-transform:capitalize}.links{display:flex;gap:14px;margin-top:18px}a{color:var(--accent)}.report-preview{padding:0;overflow:hidden}.report-preview-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 20px;border-bottom:1px solid var(--line)}.report-preview-header h2{margin:0;font-size:18px}.report-frame{display:block;width:100%;height:900px;border:0;background:#fff}@media(max-width:760px){.form,.stats{grid-template-columns:1fr 1fr}.form label:first-child{grid-column:1/-1}.report-frame{height:760px}}@media(max-width:430px){.form,.stats{grid-template-columns:1fr}}
</style></head><body><main><div class="brand"><div class="mark">✓</div><div><h1>SEO Crawl Audit</h1><div class="muted">Free, local-first site crawler</div></div></div><section class="panel"><div class="form"><label><span>Website URL</span><input id="url" type="url" placeholder="https://example.com/" required></label><label><span>Pages</span><input id="pages" type="number" min="1" max="10000" value="100"></label><label><span>Concurrency</span><input id="concurrency" type="number" min="1" max="20" value="5"></label><label><span>Delay, ms</span><input id="delay" type="number" min="0" max="60000" value="100"></label><label><span>Rendering</span><select id="render"><option value="http">Fast HTTP</option><option value="playwright">Playwright (optional)</option></select></label></div><div class="actions"><button id="start">Start SEO scan</button><button id="cancel" class="secondary" disabled>Stop safely</button></div><div class="progress"><i id="bar"></i></div><div><span class="status" id="status">Idle</span> <span class="muted" id="message">Ready to scan locally.</span></div><div class="muted" id="current"></div><div class="stats"><div class="stat"><strong id="completed">0</strong>Pages</div><div class="stat"><strong id="errors">0</strong>Errors</div><div class="stat"><strong id="warnings">0</strong>Warnings</div><div class="stat"><strong id="info">0</strong>Info</div></div><div class="links"><a id="report" href="/report" target="_blank" hidden>Open full report in a new tab</a></div></section><section id="reportPanel" class="panel report-preview" hidden><div class="report-preview-header"><div><h2>Latest local report</h2><div class="muted">Overview, Site Metrics, Issues, and local scan history</div></div><a href="/report" target="_blank">Open full size</a></div><iframe id="reportFrame" class="report-frame" title="SEO Crawl Audit report"></iframe></section></main><script>
const byId=(id)=>document.querySelector("#"+id);let loadedReport="";function renderState(value){const running=["planning","scanning"].includes(value.status);if(value.url&&!byId("url").value)byId("url").value=value.url;byId("status").textContent=value.status;byId("message").textContent=value.message||"";byId("current").textContent=value.currentUrl||"";byId("completed").textContent=value.completed+(value.total?" / "+value.total:"");byId("bar").style.width=(value.total?Math.min(100,value.completed/value.total*100):0)+"%";byId("start").disabled=running;byId("cancel").disabled=!running;byId("report").hidden=!value.reportReady;byId("reportPanel").hidden=!value.reportReady;if(value.reportReady&&value.startedAt&&loadedReport!==value.startedAt){loadedReport=value.startedAt;byId("reportFrame").src="/report?v="+encodeURIComponent(value.startedAt)}if(value.summary){byId("errors").textContent=value.summary.error;byId("warnings").textContent=value.summary.warning;byId("info").textContent=value.summary.info}}async function state(){const response=await fetch("/api/state");renderState(await response.json())}async function submitScan(body){const response=await fetch("/api/scan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(response.status===409&&result.requiresConfirmation){if(window.confirm(result.error+" Existing files will be replaced, while saved history remains available.")){return submitScan({...body,replaceExisting:true})}}if(!response.ok)byId("message").textContent=result.error||"Could not start scan"}const events=new EventSource("/api/events");events.onmessage=(event)=>renderState(JSON.parse(event.data));events.onerror=()=>{byId("message").textContent="Live updates disconnected; reconnecting…"};byId("start").addEventListener("click",()=>submitScan({url:byId("url").value,maxPages:Number(byId("pages").value),concurrency:Number(byId("concurrency").value),delay:Number(byId("delay").value),render:byId("render").value}));byId("cancel").addEventListener("click",async()=>{await fetch("/api/cancel",{method:"POST"})});state();
</script></body></html>`;

const PAGE = PAGE_TEMPLATE
  .replace("Overview, Site Metrics, Issues, and local scan history", "Compact overview preview")
  .replace('target="_blank">Open full size', 'target="_blank" rel="noopener">Open full report')
  .replace('title="SEO Crawl Audit report"', 'title="Compact SEO Crawl Audit report"')
  .replace('src="/report?v="', 'src="/report?embed=1&v="')
  .replace('<section id="reportPanel"', '<section class="panel"><h2>Site Metrics</h2><p class="muted">Optional public Google and RDAP data. Uses the latest local snapshot and does not crawl pages again.</p><div class="form"><label><span>Google site: estimate (optional)</span><input id="googleEstimate" type="number" min="1" step="1" placeholder="e.g. 19300"></label></div><div class="actions"><button id="updateMetrics" class="secondary">Update public metrics</button><a id="googleCheck" href="https://www.google.com/" target="_blank" rel="noopener">Check site: query in Google</a></div><div id="metricsMessage" class="muted">Run an SEO scan first.</div></section><section id="reportPanel"')
  .replace('state();\n</script>', 'const updateGoogleLink=()=>{try{byId("googleCheck").href="https://www.google.com/search?q="+encodeURIComponent("site:"+new URL(byId("url").value).hostname)}catch{byId("googleCheck").href="https://www.google.com/"}};byId("url").addEventListener("input",updateGoogleLink);updateGoogleLink();byId("updateMetrics").addEventListener("click",async()=>{const button=byId("updateMetrics");button.disabled=true;byId("metricsMessage").textContent="Updating public metrics…";try{const response=await fetch("/api/metrics",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({googleEstimate:Number(byId("googleEstimate").value)||null})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not update metrics");byId("metricsMessage").textContent="Public metrics updated. No pages were crawled.";loadedReport="";await state()}catch(error){byId("metricsMessage").textContent=error.message}finally{button.disabled=false}});state();\n</script>');

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
      issues,
      partial: snapshot.partial,
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

  const startScan = async (input: Record<string, unknown>) => {
    let renderer: PageRenderer | undefined;
    try {
      const config = resolveConfig({
        url: String(input.url ?? ""),
        maxPages: Number(input.maxPages ?? 100),
        concurrency: Number(input.concurrency ?? 5),
        delay: Number(input.delay ?? 100),
      });
      controller = new AbortController();
      renderer = await loadRenderer(input.render);
      state = { status: "planning", url: config.url, completed: 0, total: config.maxPages, retries: 0, errors: 0, startedAt: new Date().toISOString(), currentUrl: null, message: "Discovering robots.txt and sitemap…", reportReady: false, summary: null };
      publish();
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
      const plan = await planScan(config, { fetch, signal: controller.signal, onEvent });
      const result = await scan(plan, { fetch, signal: controller.signal, renderer, checkpointStore: createFileCheckpointStore(checkpointPath), onEvent });
      if (!result.snapshot.partial) await writeHistorySnapshot(historyPath, result.snapshot);
      const [issues] = await Promise.all([
        renderCurrentReport(result.snapshot, mergeSiteMetrics(buildSiteMetrics(result.snapshot), await readSiteMetricsState(metricsPath, result.snapshot.siteUrl))),
        writeSnapshot(snapshotPath, result.snapshot),
      ]);
      const counts = issues.reduce((total, issue) => ({ ...total, [issue.severity]: total[issue.severity] + 1 }), { error: 0, warning: 0, info: 0 });
      existingSiteUrl = result.snapshot.siteUrl;
      state = { ...state, status: result.partial ? "cancelled" : "complete", completed: result.snapshot.pages.length, currentUrl: null, message: result.partial ? "Partial results and checkpoint were saved." : "Scan complete. Snapshot and report were saved locally.", reportReady: true, summary: { pages: result.snapshot.pages.length, ...counts } };
      publish();
    } catch (error) {
      state = { ...state, status: controller?.signal.aborted ? "cancelled" : "error", message: error instanceof Error ? error.message : String(error), currentUrl: null };
      publish();
    } finally {
      await renderer?.close?.();
      controller = null;
    }
  };

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      const path = requestUrl.pathname;
      if (request.method === "GET" && path === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:", "x-content-type-options": "nosniff" });
        response.end(PAGE);
        return;
      }
      if (request.method === "GET" && path === "/api/state") { json(response, 200, state); return; }
      if (request.method === "GET" && path === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
        eventStreams.add(response);
        response.write(`data: ${JSON.stringify(state)}\n\n`);
        request.once("close", () => eventStreams.delete(response));
        return;
      }
      if (request.method === "GET" && path === "/report") {
        if (!reportHtml) { json(response, 404, { error: "report is not ready" }); return; }
        const embedded = requestUrl.searchParams.get("embed") === "1" || request.headers["sec-fetch-dest"] === "iframe";
        const content = embedded ? embedReport(reportHtml) : reportHtml;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" }); response.end(content); return;
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
        if (controller || metricsRunning) { json(response, 409, { error: "a scan or metrics update is already running" }); return; }
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
        if (existingSiteUrl && new URL(existingSiteUrl).origin !== requestedUrl.origin) {
          try { await unlink(metricsPath); } catch (error) {
            if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
          }
        }
        void startScan(input);
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
        if (controller || metricsRunning) { json(response, 409, { error: "a scan or metrics update is already running" }); return; }
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
        const collected = withManualGoogleEstimate(
          await collectSiteMetrics(snapshot, { providers: [createGoogleSiteEstimateProvider(), createRdapDomainProvider()], fetch }),
          input.googleEstimate,
        );
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
