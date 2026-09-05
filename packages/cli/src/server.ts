import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  audit,
  buildSiteMetrics,
  collectSiteMetrics,
  createRdapDomainProvider,
  planScan,
  resolveConfig,
  scan,
  type ScanEvent,
  type PageRenderer,
} from "@seo-crawl-audit/core";
import { createFileCheckpointStore, writeReport, writeSnapshot } from "@seo-crawl-audit/core/node";

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
  fetch?: typeof globalThis.fetch;
}

export interface LocalUiServer {
  url: string;
  close(): Promise<void>;
}

async function loadRenderer(mode: unknown): Promise<PageRenderer | undefined> {
  if (mode === undefined || mode === "http") return undefined;
  if (mode !== "playwright") throw new Error("render mode must be http or playwright");
  try {
    const moduleName = "@seo-crawl-audit/renderer-playwright";
    const adapter = await import(moduleName) as { createPlaywrightRenderer(): Promise<PageRenderer> };
    return await adapter.createPlaywrightRenderer();
  } catch (error) {
    if (error instanceof Error && /Playwright|Chromium|playwright/.test(error.message)) throw error;
    throw new Error("Install Playwright rendering with: npm install --save-dev @seo-crawl-audit/renderer-playwright playwright && npx playwright install chromium", { cause: error });
  }
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEO Crawl Audit</title><style>
:root{color-scheme:light;--accent:#3157d5;--bg:#f5f7fb;--surface:#fff;--text:#172033;--muted:#64748b;--line:#dbe2ea}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}main{width:min(940px,calc(100% - 32px));margin:48px auto}.brand{display:flex;align-items:center;gap:14px}.mark{display:grid;width:52px;height:52px;border-radius:14px;background:var(--accent);color:#fff;font-size:25px;font-weight:900;place-items:center}h1{margin:0;font-size:32px}.muted{color:var(--muted)}.panel{margin-top:24px;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 16px 45px rgba(31,42,68,.08)}.form{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:12px}label span{display:block;margin-bottom:5px;color:var(--muted)}input,select,button{width:100%;min-height:44px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit}.check{display:flex;align-items:center;gap:8px;margin-top:14px}.check input{width:18px;min-height:18px}.check span{margin:0}button{width:auto;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}button.secondary{background:#fff;color:var(--text)}button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;gap:10px;margin-top:16px}.progress{height:13px;margin:20px 0 10px;overflow:hidden;border-radius:999px;background:#e8edf3}.progress i{display:block;width:0;height:100%;background:var(--accent);transition:width .25s}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.stat{padding:14px;border-radius:12px;background:#f8fafc}.stat strong{display:block;font-size:23px}.status{font-weight:800;text-transform:capitalize}.links{display:flex;gap:14px;margin-top:18px}a{color:var(--accent)}@media(max-width:760px){.form,.stats{grid-template-columns:1fr 1fr}.form label:first-child{grid-column:1/-1}}@media(max-width:430px){.form,.stats{grid-template-columns:1fr}}
</style></head><body><main><div class="brand"><div class="mark">✓</div><div><h1>SEO Crawl Audit</h1><div class="muted">Free, local-first site crawler</div></div></div><section class="panel"><div class="form"><label><span>Website URL</span><input id="url" type="url" placeholder="https://example.com/" required></label><label><span>Pages</span><input id="pages" type="number" min="1" max="10000" value="100"></label><label><span>Concurrency</span><input id="concurrency" type="number" min="1" max="20" value="5"></label><label><span>Delay, ms</span><input id="delay" type="number" min="0" max="60000" value="100"></label><label><span>Rendering</span><select id="render"><option value="http">Fast HTTP</option><option value="playwright">Playwright (optional)</option></select></label></div><label class="check"><input id="publicMetrics" type="checkbox" checked><span>Include public domain data from RDAP</span></label><div class="actions"><button id="start">Start scan</button><button id="cancel" class="secondary" disabled>Stop safely</button></div><div class="progress"><i id="bar"></i></div><div><span class="status" id="status">Idle</span> <span class="muted" id="message">Ready to scan locally.</span></div><div class="muted" id="current"></div><div class="stats"><div class="stat"><strong id="completed">0</strong>Pages</div><div class="stat"><strong id="errors">0</strong>Errors</div><div class="stat"><strong id="warnings">0</strong>Warnings</div><div class="stat"><strong id="info">0</strong>Info</div></div><div class="links"><a id="report" href="/report" target="_blank" hidden>Open HTML report</a></div></section></main><script>
const byId=(id)=>document.querySelector("#"+id);function renderState(value){const running=["planning","scanning"].includes(value.status);byId("status").textContent=value.status;byId("message").textContent=value.message||"";byId("current").textContent=value.currentUrl||"";byId("completed").textContent=value.completed+(value.total?" / "+value.total:"");byId("bar").style.width=(value.total?Math.min(100,value.completed/value.total*100):0)+"%";byId("start").disabled=running;byId("cancel").disabled=!running;byId("report").hidden=!value.reportReady;if(value.summary){byId("errors").textContent=value.summary.error;byId("warnings").textContent=value.summary.warning;byId("info").textContent=value.summary.info}}async function state(){const response=await fetch("/api/state");renderState(await response.json())}const events=new EventSource("/api/events");events.onmessage=(event)=>renderState(JSON.parse(event.data));events.onerror=()=>{byId("message").textContent="Live updates disconnected; reconnecting…"};byId("start").addEventListener("click",async()=>{const body={url:byId("url").value,maxPages:Number(byId("pages").value),concurrency:Number(byId("concurrency").value),delay:Number(byId("delay").value),render:byId("render").value,publicMetrics:byId("publicMetrics").checked};const response=await fetch("/api/scan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!response.ok){const result=await response.json();byId("message").textContent=result.error||"Could not start scan"}});byId("cancel").addEventListener("click",async()=>{await fetch("/api/cancel",{method:"POST"})});state();
</script></body></html>`;

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
  const fetch = options.fetch ?? globalThis.fetch;
  let reportHtml: string | null = null;
  let controller: AbortController | null = null;
  let state: UiState = { status: "idle", url: null, completed: 0, total: 0, retries: 0, errors: 0, startedAt: null, currentUrl: null, message: "Ready to scan locally.", reportReady: false, summary: null };
  const eventStreams = new Set<ServerResponse>();
  const publish = () => {
    const event = `data: ${JSON.stringify(state)}\n\n`;
    for (const stream of eventStreams) stream.write(event);
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
      const issues = audit(result.snapshot);
      const counts = issues.reduce((total, issue) => ({ ...total, [issue.severity]: total[issue.severity] + 1 }), { error: 0, warning: 0, info: 0 });
      const siteMetrics = input.publicMetrics === false
        ? buildSiteMetrics(result.snapshot)
        : await collectSiteMetrics(result.snapshot, { providers: [createRdapDomainProvider()], fetch, signal: controller.signal });
      const reportData = { mode: "scan" as const, startUrl: result.snapshot.siteUrl, generatedAt: result.snapshot.generatedAt, pages: result.snapshot.pages, issues, partial: result.snapshot.partial, targetPages: config.maxPages, engineVersion: result.snapshot.engineVersion, ruleSetVersion: result.snapshot.ruleSetVersion, branding: result.snapshot.config.report, siteMetrics };
      await Promise.all([writeSnapshot(snapshotPath, result.snapshot), writeReport(reportPath, reportData)]);
      reportHtml = await readFile(reportPath, "utf8");
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
      const path = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
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
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" }); response.end(reportHtml); return;
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
        if (controller) { json(response, 409, { error: "a scan is already running" }); return; }
        const input = await body(request);
        void startScan(input);
        json(response, 202, { status: "started" });
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

export async function serveCommand(port: number, signal?: AbortSignal): Promise<number> {
  const server = await createLocalUiServer({ port });
  console.log(`SEO Crawl Audit local UI is running at ${server.url}`);
  console.log("All scan data stays on this device. Press Ctrl+C to stop.");
  if (signal?.aborted) { await server.close(); return 130; }
  await new Promise<void>((resolveWait) => {
    signal?.addEventListener("abort", () => resolveWait(), { once: true });
  });
  await server.close();
  return signal?.aborted ? 130 : 0;
}
