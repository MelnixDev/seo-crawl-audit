import { Buffer } from "node:buffer";
import type { PageRenderer, PageRenderRequest, PageRenderResult } from "@seo-crawl-audit/core";

interface PwRequest {
  url(): string;
  resourceType(): string;
  redirectedFrom(): PwRequest | null;
  response(): Promise<PwResponse | null>;
}

interface PwResponse {
  status(): number;
  headers(): Promise<Record<string, string>>;
  request(): PwRequest;
}

interface PwRoute {
  request(): PwRequest;
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface PwDownload { cancel(): Promise<void> }

interface PwPage {
  route(pattern: string, handler: (route: PwRoute) => Promise<void>): Promise<void>;
  on(event: "download", handler: (download: PwDownload) => void): void;
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<PwResponse | null>;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}

interface PwBrowser {
  newContext(options: { userAgent: string; acceptDownloads: false }): Promise<PwContext>;
  close(): Promise<void>;
}

interface PwModule {
  chromium: { launch(options: { headless: boolean }): Promise<PwBrowser> };
}

export interface PlaywrightRendererOptions {
  concurrency?: number;
  headless?: boolean;
  networkIdleTimeout?: number;
  playwright?: unknown;
}

async function loadPlaywright(value?: unknown): Promise<PwModule> {
  if (value) return value as PwModule;
  try {
    const moduleName = "playwright";
    return await import(moduleName) as unknown as PwModule;
  } catch (error) {
    throw new Error("Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium", { cause: error });
  }
}

function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function acquire(): Promise<() => void> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    return () => {
      active -= 1;
      queue.shift()?.();
    };
  };
}

async function redirects(response: PwResponse): Promise<PageRenderResult["redirectChain"]> {
  const chain: PageRenderResult["redirectChain"] = [];
  let previous = response.request().redirectedFrom();
  while (previous) {
    const previousResponse = await previous.response();
    const headers = await previousResponse?.headers();
    chain.unshift({ url: previous.url(), status: previousResponse?.status() ?? 0, location: headers?.location ?? null });
    previous = previous.redirectedFrom();
  }
  return chain;
}

export async function createPlaywrightRenderer(options: PlaywrightRendererOptions = {}): Promise<PageRenderer> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Playwright renderer concurrency must be a positive integer");
  const playwright = await loadPlaywright(options.playwright);
  let browser: PwBrowser;
  try {
    browser = await playwright.chromium.launch({ headless: options.headless ?? true });
  } catch (error) {
    throw new Error("Chromium could not start. Run: npx playwright install chromium", { cause: error });
  }
  let context: PwContext | null = null;
  let contextUserAgent: string | null = null;
  const acquire = createSemaphore(concurrency);
  let closed = false;

  return {
    id: "playwright-chromium-v1",
    async render(request: PageRenderRequest): Promise<PageRenderResult> {
      if (closed) throw new Error("Playwright renderer is closed");
      const release = await acquire();
      let page: PwPage | null = null;
      try {
        request.signal?.throwIfAborted();
        if (!context) {
          context = await browser.newContext({ userAgent: request.userAgent, acceptDownloads: false });
          contextUserAgent = request.userAgent;
        } else if (contextUserAgent !== request.userAgent) {
          throw new Error("A Playwright renderer cannot mix user agents in one browser context");
        }
        page = await context.newPage();
        await page.route("**/*", async (route) => {
          const resourceType = route.request().resourceType();
          if (resourceType === "media") await route.abort();
          else await route.continue();
        });
        page.on("download", (download) => { void download.cancel(); });
        const abort = () => { void page?.close(); };
        request.signal?.addEventListener("abort", abort, { once: true });
        try {
          const response = await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: request.timeout });
          if (!response) throw new Error(`Playwright did not receive a document response for ${request.url}`);
          if ((options.networkIdleTimeout ?? 2_000) > 0) {
            try { await page.waitForLoadState("networkidle", { timeout: Math.min(request.timeout, options.networkIdleTimeout ?? 2_000) }); }
            catch (error) { if (request.signal?.aborted) throw error; }
          }
          request.signal?.throwIfAborted();
          const html = await page.content();
          const responseBytes = Buffer.byteLength(html);
          if (responseBytes > request.maxResponseBytes) throw new Error(`rendered HTML exceeds ${request.maxResponseBytes} bytes`);
          const headers = await response.headers();
          return { finalUrl: page.url(), status: response.status(), headers, html, responseBytes, redirectChain: await redirects(response) };
        } finally {
          request.signal?.removeEventListener("abort", abort);
        }
      } finally {
        await page?.close().catch(() => undefined);
        release();
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await context?.close();
      await browser.close();
    },
  };
}
