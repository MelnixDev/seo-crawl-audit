import { resolve } from "node:path";
import {
  audit,
  diff,
  migrateSnapshot,
  planScan,
  scan,
  type PageSnapshot,
  type ReportData,
  type ScanPlan,
  type ScanResult,
  type SnapshotV2,
} from "@seo-crawl-audit/core";
import {
  checkpointPathForOutput,
  createFileCheckpointStore,
  readSnapshot,
  writeReport,
  writeSnapshot,
} from "@seo-crawl-audit/core/node";
import { scanConfig, type CliValues } from "./args.js";
import { printIssues, summarizeIssues } from "./report.js";
import { ask, chooseScanPlan, health, printHealth, printProgress, type ScanSelection } from "./ui.js";

const DEFAULT_BASELINE = ".seo-audit.json";
const DEFAULT_REPORT = "seo-audit-report.html";

function reportEnabled(values: CliValues, force = false): boolean {
  return force || (!values["no-report"] && (values.report !== undefined || (process.stdin.isTTY && process.stdout.isTTY && !values.json)));
}

async function saveReport(values: CliValues, data: ReportData, force = false): Promise<string | null> {
  if (!reportEnabled(values, force)) return null;
  const output = resolve(values.report ?? DEFAULT_REPORT);
  await writeReport(output, data);
  return output;
}

function mapUrl(url: string | null, fromStart: string, toStart: string): string | null {
  if (!url) return url;
  try {
    const source = new URL(fromStart);
    const target = new URL(toStart);
    const candidate = new URL(url);
    if (candidate.origin !== source.origin) return url;
    candidate.protocol = target.protocol;
    candidate.host = target.host;
    const sourceRoot = source.pathname.replace(/\/$/, "");
    const targetRoot = target.pathname.replace(/\/$/, "");
    if (sourceRoot && candidate.pathname.startsWith(sourceRoot)) {
      candidate.pathname = `${targetRoot}${candidate.pathname.slice(sourceRoot.length)}` || "/";
    }
    return candidate.href;
  } catch {
    return url;
  }
}

function mapPage(page: PageSnapshot, fromStart: string, toStart: string): PageSnapshot {
  const mapList = (values: string[]) => values.map((value) => mapUrl(value, fromStart, toStart) ?? value).sort();
  return {
    ...page,
    url: mapUrl(page.url, fromStart, toStart) ?? page.url,
    finalUrl: mapUrl(page.finalUrl, fromStart, toStart),
    canonical: mapUrl(page.canonical, fromStart, toStart),
    canonicalRaw: mapUrl(page.canonicalRaw, fromStart, toStart),
    links: mapList(page.links),
    internalLinks: mapList(page.internalLinks),
    externalLinks: mapList(page.externalLinks),
    images: page.images.map((image) => ({ ...image, src: mapUrl(image.src, fromStart, toStart) })),
    hreflang: page.hreflang.map((alternate) => ({ ...alternate, url: mapUrl(alternate.url, fromStart, toStart) })),
    redirectChain: page.redirectChain.map((redirect) => ({
      ...redirect,
      url: mapUrl(redirect.url, fromStart, toStart) ?? redirect.url,
      location: mapUrl(redirect.location, fromStart, toStart),
    })),
  };
}

export function headersFromEnvironment(variableName: string | undefined): Record<string, string> {
  if (!variableName) return {};
  const encoded = process.env[variableName];
  if (!encoded) throw new Error(`environment variable ${variableName} is empty or missing`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`environment variable ${variableName} must contain a JSON object`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`environment variable ${variableName} must contain a JSON object`);
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(`header ${name} in ${variableName} must be a string`);
    headers[name] = value;
  }
  return headers;
}

function fetchWithHeaders(headers: Record<string, string>): typeof globalThis.fetch {
  if (Object.keys(headers).length === 0) return globalThis.fetch;
  return (input, init) => {
    const merged = new Headers(init?.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return globalThis.fetch(input, { ...init, headers: merged });
  };
}

function reportData(snapshot: SnapshotV2, mode: "scan" | "check", issues = audit(snapshot), extra: Partial<ReportData> = {}): ReportData {
  return {
    mode,
    startUrl: snapshot.siteUrl,
    generatedAt: snapshot.generatedAt,
    pages: snapshot.pages,
    issues,
    partial: snapshot.partial,
    engineVersion: snapshot.engineVersion,
    ruleSetVersion: snapshot.ruleSetVersion,
    branding: snapshot.config.report,
    ...extra,
  };
}

async function resolvePlan(url: string, values: CliValues, baseline: SnapshotV2 | undefined, signal?: AbortSignal): Promise<ScanPlan> {
  let config = scanConfig(url, values, baseline);
  let plan = await planScan(config, { signal });
  if (plan.mode === "links" && config.sitemap === "auto" && process.stdin.isTTY && process.stdout.isTTY && !values.json) {
    const entered = await ask("Sitemap was not found. Enter its full URL, or press Enter to crawl internal links: ");
    if (entered) {
      config = { ...config, sitemap: entered };
      plan = await planScan(config, { signal });
    }
  }
  return plan;
}

function selectScan(plan: ScanPlan, values: CliValues): Promise<ScanSelection> | ScanSelection {
  if (plan.candidateCount === null) {
    if (values.all) throw new Error("--all requires a sitemap");
    return { mode: "fixed", target: plan.config.maxPages };
  }
  if (values.all) return { mode: "all", target: plan.candidateCount };
  if (values.pages !== undefined || values["max-pages"] !== undefined) {
    return { mode: "fixed", target: Math.min(plan.config.maxPages, plan.candidateCount) };
  }
  if (process.stdin.isTTY && process.stdout.isTTY && !values.json) return chooseScanPlan(plan.candidateCount);
  return { mode: "fixed", target: Math.min(100, plan.candidateCount) };
}

export async function scanCommand(url: string | undefined, values: CliValues, signal?: AbortSignal): Promise<number> {
  if (!url) throw new Error("scan requires a URL");
  const output = resolve(values.output ?? DEFAULT_BASELINE);
  const plan = await resolvePlan(url, values, undefined, signal);
  const selection = await selectScan(plan, values);
  const checkpointPath = checkpointPathForOutput(output);
  const store = values["no-cache"] ? undefined : createFileCheckpointStore(checkpointPath);
  const collected = new Map<string, PageSnapshot>();
  const partialReportPath = reportEnabled(values) ? resolve(values.report ?? DEFAULT_REPORT) : null;
  let lastReportAt = 0;
  let lastReportCount = -1;

  const writePartial = async (force = false) => {
    if (!partialReportPath || collected.size === 0) return;
    const now = Date.now();
    if (!force && collected.size - lastReportCount < 100 && now - lastReportAt < 5_000) return;
    const partialSnapshot = migrateSnapshot({
      schemaVersion: 1,
      startUrl: plan.startUrl,
      robots: plan.robots,
      sitemap: plan.sitemap,
      options: { ...plan.config, maxPages: selection.target },
      pages: [...collected.values()],
      partial: true,
      truncated: true,
    });
    await writeReport(partialReportPath, reportData(partialSnapshot, "scan", audit(partialSnapshot), { partial: true, targetPages: selection.target }));
    lastReportAt = now;
    lastReportCount = collected.size;
  };

  let requested = selection.mode === "step" ? Math.min(100, selection.target) : selection.target;
  let result: ScanResult | null = null;
  let stoppedEarly = false;
  while (requested > 0) {
    result = await scan(plan, {
      signal,
      limit: requested,
      checkpointStore: store,
      retainCheckpoint: selection.mode === "step" && requested < selection.target,
      async onBatch(pages) {
        for (const page of pages) collected.set(page.url, page);
        await writePartial();
      },
      onEvent(event) {
        if (event.type === "progress" && !values.json) printProgress(event.completed, requested, selection.mode === "step");
      },
    });
    for (const page of result.pages) collected.set(page.url, page);
    await writePartial(true);
    if (result.partial || selection.mode !== "step" || requested >= selection.target) break;
    printHealth(health(result.pages));
    const nextSize = Math.min(100, selection.target - requested);
    const answer = await ask(`Check the next ${nextSize} page(s)? [y/N] `);
    if (!["y", "yes"].includes(answer.toLowerCase())) { stoppedEarly = true; break; }
    requested = Math.min(selection.target, requested + 100);
  }
  if (!result) throw new Error("scan did not produce a result");

  await writeSnapshot(output, result.snapshot);
  const incomplete = result.partial || stoppedEarly;
  const finalReport = incomplete
    ? partialReportPath
    : await saveReport(values, reportData(result.snapshot, "scan"));
  const summary = health(result.snapshot.pages);
  if (values.json) {
    console.log(JSON.stringify({
      command: "scan",
      pages: result.snapshot.pages.length,
      truncated: result.snapshot.truncated,
      health: summary,
      output,
      report: finalReport,
      checkpoint: incomplete && store ? checkpointPath : null,
    }, null, 2));
  } else {
    console.log(`Crawled ${result.snapshot.pages.length} page(s)${result.snapshot.truncated ? " (limit reached)" : ""}.`);
    if (result.snapshot.sitemap) console.log(`Loaded ${result.snapshot.sitemap.sitemapCount} sitemap file(s) from ${result.snapshot.sitemap.url}.`);
    printHealth(summary);
    console.log(`Baseline saved to ${output}`);
    if (finalReport) console.log(`HTML report saved to ${finalReport}`);
    if (incomplete && store) console.log(`Resume checkpoint saved to ${checkpointPath}`);
  }
  return result.partial ? 130 : 0;
}

export async function checkCommand(url: string | undefined, values: CliValues, signal?: AbortSignal): Promise<number> {
  const baselinePath = resolve(values.baseline ?? DEFAULT_BASELINE);
  const baseline = await readSnapshot(baselinePath);
  const targetStart = url ?? baseline.siteUrl;
  const basePlan = await planScan({ ...scanConfig(targetStart, values, baseline), sitemap: "none" }, { signal });
  const targets = baseline.pages.map((page) => ({
    baselineUrl: page.url,
    targetUrl: mapUrl(page.url, baseline.siteUrl, basePlan.startUrl) ?? page.url,
  }));
  const targetUrls = [...new Set(targets.map(({ targetUrl }) => targetUrl))];
  const plan: ScanPlan = {
    ...basePlan,
    mode: "sitemap",
    candidateUrls: targetUrls,
    candidateCount: targetUrls.length,
    sitemap: {
      url: `${basePlan.origin}/.seo-audit-targets`,
      urls: targetUrls,
      sitemapCount: 0,
      truncated: false,
      error: null,
    },
  };
  const result = await scan(plan, {
    signal,
    limit: targetUrls.length,
    onEvent(event) { if (event.type === "progress" && !values.json) printProgress(event.completed, targetUrls.length); },
  });
  const checked = new Map(result.pages.map((page) => [page.url, page]));
  const pages = targets.flatMap(({ baselineUrl, targetUrl }) => {
    const page = checked.get(targetUrl);
    return page ? [{ ...page, url: baselineUrl, finalUrl: mapUrl(page.finalUrl, basePlan.startUrl, baseline.siteUrl) }] : [];
  });
  const current = migrateSnapshot({
    ...result.snapshot,
    siteUrl: baseline.siteUrl,
    config: { ...result.snapshot.config, url: baseline.siteUrl },
    sitemap: baseline.sitemap,
    pages,
  });
  const comparison = diff(baseline, current, {
    enabledRules: current.config.enabledRules,
    severityOverrides: current.config.severityOverrides,
    suppressions: current.config.suppressions,
  });
  const issues = comparison.newIssues;
  const summary = summarizeIssues(issues);
  const report = await saveReport(values, reportData(current, "check", issues, comparison));
  if (values.json) console.log(JSON.stringify({ command: "check", baseline: baselinePath, pages: current.pages.length, summary, issues, lifecycle: comparison, report }, null, 2));
  else {
    console.log(`Checked ${current.pages.length} page(s).\n`);
    printIssues(issues);
    if (report) console.log(`HTML report saved to ${report}`);
  }
  if (result.partial) return 130;
  return summary.error > 0 || comparison.budgetExceeded.length > 0 || (values.strict && summary.warning > 0) ? 1 : 0;
}

export async function compareCommand(values: CliValues, signal?: AbortSignal): Promise<number> {
  const productionUrl = values.production;
  const previewUrl = values.preview;
  if (!productionUrl || !previewUrl) throw new Error("compare requires --production and --preview URLs");
  const productionFetch = fetchWithHeaders(headersFromEnvironment(values["production-headers-env"]));
  const previewFetch = fetchWithHeaders(headersFromEnvironment(values["preview-headers-env"]));

  const productionPlan = await planScan(scanConfig(productionUrl, values), { signal, fetch: productionFetch });
  const selection = await selectScan(productionPlan, values);
  const production = await scan(productionPlan, {
    signal,
    fetch: productionFetch,
    limit: selection.target,
    onEvent(event) {
      if (event.type === "progress" && !values.json) printProgress(event.completed, selection.target);
    },
  });
  if (production.partial) return 130;

  const previewBasePlan = await planScan({ ...scanConfig(previewUrl, values), sitemap: "none" }, { signal, fetch: previewFetch });
  const targetUrls = production.snapshot.pages.map((page) => mapUrl(page.url, productionUrl, previewUrl) ?? page.url);
  const previewPlan: ScanPlan = {
    ...previewBasePlan,
    mode: "sitemap",
    candidateUrls: [...new Set(targetUrls)].sort(),
    candidateCount: targetUrls.length,
    sitemap: {
      url: `${previewBasePlan.origin}/.seo-audit-preview-targets`,
      urls: [...new Set(targetUrls)].sort(),
      sitemapCount: 0,
      truncated: false,
      error: null,
    },
  };
  const preview = await scan(previewPlan, {
    signal,
    fetch: previewFetch,
    limit: targetUrls.length,
    onEvent(event) {
      if (event.type === "progress" && !values.json) printProgress(event.completed, targetUrls.length);
    },
  });
  const previewPages = preview.snapshot.pages.map((page) => mapPage(page, previewUrl, productionUrl));
  const current = migrateSnapshot({
    ...preview.snapshot,
    siteUrl: production.snapshot.siteUrl,
    startUrl: production.snapshot.siteUrl,
    config: { ...preview.snapshot.config, url: production.snapshot.siteUrl },
    robots: {
      ...preview.snapshot.robots,
      url: mapUrl(preview.snapshot.robots.url, previewUrl, productionUrl) ?? preview.snapshot.robots.url,
    },
    sitemap: production.snapshot.sitemap,
    pages: previewPages,
    partial: preview.snapshot.partial,
  });
  const comparison = diff(production.snapshot, current, {
    enabledRules: current.config.enabledRules,
    severityOverrides: current.config.severityOverrides,
    suppressions: current.config.suppressions,
  });
  const issues = comparison.newIssues;
  const summary = summarizeIssues(issues);
  const report = await saveReport(values, reportData(current, "check", issues, {
    ...comparison,
    comparison: { kind: "preview", productionUrl, previewUrl },
  }), true);
  if (values.json) {
    console.log(JSON.stringify({ command: "compare", production: productionUrl, preview: previewUrl, pages: current.pages.length, summary, issues, lifecycle: comparison, report }, null, 2));
  } else {
    console.log(`Compared ${current.pages.length} production page(s) with preview.`);
    printIssues(issues);
    if (report) console.log(`HTML report saved to ${report}`);
  }
  if (preview.partial) return 130;
  return summary.error > 0 || comparison.budgetExceeded.length > 0 || (values.strict && summary.warning > 0) ? 1 : 0;
}

export async function reportCommand(inputPath: string | undefined, values: CliValues): Promise<number> {
  const baselinePath = resolve(inputPath ?? values.baseline ?? DEFAULT_BASELINE);
  const baseline = await readSnapshot(baselinePath);
  const report = await saveReport(values, reportData(baseline, "scan"), true);
  if (values.json) console.log(JSON.stringify({ command: "report", baseline: baselinePath, pages: baseline.pages.length, report }, null, 2));
  else console.log(`HTML report saved to ${report}`);
  return 0;
}
