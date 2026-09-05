import { createInterface } from "node:readline/promises";
import type { PageSnapshot, ScanPlan } from "@seo-crawl-audit/core";

export interface ScanSelection { mode: "fixed" | "all" | "step"; target: number }

export function parseScanMenuSelection(input: string, totalPages: number): ScanSelection | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "" || normalized === "1") return { mode: "fixed", target: Math.min(100, totalPages) };
  if (normalized === "2" || normalized === "all") return { mode: "all", target: totalPages };
  if (normalized === "3" || normalized === "step") return { mode: "step", target: totalPages };
  const number = Number.parseInt(normalized, 10);
  return /^\d+$/.test(normalized) && number > 0 ? { mode: "fixed", target: Math.min(number, totalPages) } : null;
}

export async function ask(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await readline.question(question)).trim(); }
  finally { readline.close(); }
}

export async function chooseScanPlan(totalPages: number): Promise<ScanSelection> {
  while (true) {
    console.log(`\nSitemap contains ${totalPages.toLocaleString("en-US")} page(s).`);
    console.log("How many pages should be scanned?");
    console.log("  1) First 100");
    console.log(`  2) All ${totalPages.toLocaleString("en-US")}`);
    console.log("  3) 100 at a time with confirmation");
    console.log("  Or enter an exact number, for example 500.");
    const selection = parseScanMenuSelection(await ask("Choose [1]: "), totalPages);
    if (!selection) { console.log("Enter 1, 2, 3, all, step, or a positive number."); continue; }
    if (selection.mode === "all") {
      const confirmation = await ask(`This will request ${totalPages.toLocaleString("en-US")} pages. Continue? [y/N] `);
      if (!["y", "yes"].includes(confirmation.toLowerCase())) continue;
    }
    return selection;
  }
}

export interface ProgressDetails {
  elapsedMs: number;
  retries: number;
  errors: number;
  currentUrl?: string;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function formatProgress(checked: number, target: number, details?: ProgressDetails): string {
  const ratio = target === 0 ? 1 : Math.min(checked / target, 1);
  const percent = (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0);
  const filled = Math.round(ratio * 20);
  const base = `[${"█".repeat(filled)}${"░".repeat(20 - filled)}] ${percent}% · ${checked.toLocaleString("en-US")} / ${target.toLocaleString("en-US")} pages`;
  if (!details) return base;
  const elapsedMinutes = details.elapsedMs / 60_000;
  const pagesPerMinute = elapsedMinutes > 0 ? checked / elapsedMinutes : 0;
  const remaining = Math.max(0, target - checked);
  const etaMs = pagesPerMinute > 0 ? (remaining / pagesPerMinute) * 60_000 : null;
  const metrics = [
    `elapsed ${formatDuration(details.elapsedMs)}`,
    `${pagesPerMinute.toFixed(pagesPerMinute < 10 ? 1 : 0)} pages/min`,
    `ETA ${etaMs === null ? "—" : formatDuration(etaMs)}`,
    `retries ${details.retries}`,
    `errors ${details.errors}`,
  ];
  if (details.currentUrl) {
    const clipped = details.currentUrl.length > 60 ? `${details.currentUrl.slice(0, 57)}…` : details.currentUrl;
    metrics.push(clipped);
  }
  return `${base} · ${metrics.join(" · ")}`;
}

export function printProgress(
  checked: number,
  target: number,
  persistent = false,
  output: NodeJS.WriteStream = process.stdout,
  details?: ProgressDetails,
): void {
  const message = formatProgress(checked, target, details);
  const log = output === process.stderr ? console.error : console.log;
  if (output.isTTY && !persistent) {
    output.write(`\r${message}`);
    if (checked >= target) output.write("\n");
  } else if (output.isTTY || checked >= target || checked % 1_000 === 0) log(message);
}

export function printPreflight(
  plan: ScanPlan,
  selection: ScanSelection,
  checkpointEnabled: boolean,
  output: NodeJS.WriteStream = process.stdout,
): void {
  const sitemap = plan.sitemap
    ? `found, ${(plan.candidateCount ?? plan.sitemap.urls.length).toLocaleString("en-US")} URL(s)`
    : "not found; internal links";
  const lines = [
    "Scan plan",
    `  Target: ${plan.startUrl}`,
    `  Sitemap: ${sitemap}`,
    `  Robots: ${plan.config.respectRobots ? "respected" : "ignored"}`,
    `  Limit: ${selection.target.toLocaleString("en-US")} page(s)`,
    `  Concurrency: ${plan.config.concurrency}`,
    `  Delay: ${plan.config.delay} ms`,
    `  Checkpoint: ${checkpointEnabled ? "enabled" : "disabled"}`,
  ];
  if (selection.target > 1_000) lines.push(`  Notice: this is a large scan and may take a long time.`);
  printStatus(lines.join("\n"), output);
}

export function createProgressReporter(
  target: number,
  persistent: boolean,
  output: NodeJS.WriteStream = process.stdout,
  now: () => number = Date.now,
): { retry(): void; progress(page: PageSnapshot, completed: number): void } {
  const startedAt = now();
  let retries = 0;
  let errors = 0;
  const failed = new Set<string>();
  return {
    retry() { retries += 1; },
    progress(page, completed) {
      if ((page.error || (page.status !== null && page.status >= 400)) && !failed.has(page.url)) {
        failed.add(page.url);
        errors += 1;
      }
      const currentUrl = (() => {
        try { return new URL(page.url).pathname || "/"; }
        catch { return page.url; }
      })();
      printProgress(completed, target, persistent, output, {
        elapsedMs: now() - startedAt,
        retries,
        errors,
        currentUrl,
      });
    },
  };
}

export function printStatus(message: string, output: NodeJS.WriteStream = process.stdout): void {
  if (output.isTTY) output.write("\r\x1b[2K");
  if (output === process.stderr) console.error(message);
  else console.log(message);
}

export function health(pages: PageSnapshot[]) {
  return pages.reduce((summary, page) => {
    if (page.error || page.blockedByRobots || (page.status ?? 500) >= 400) summary.unavailable += 1;
    if (!page.title) summary.missingTitle += 1;
    if (!page.description) summary.missingDescription += 1;
    if (!page.canonical) summary.missingCanonical += 1;
    if (page.h1Count === 0) summary.missingH1 += 1;
    if (/(^|[\s,])noindex($|[\s,])/i.test(page.robots ?? "")) summary.noindex += 1;
    return summary;
  }, { unavailable: 0, missingTitle: 0, missingDescription: 0, missingCanonical: 0, missingH1: 0, noindex: 0 });
}

export function printHealth(summary: ReturnType<typeof health>): void {
  console.log(`Current health: ${summary.unavailable} unavailable, ${summary.missingTitle} missing title, ${summary.missingDescription} missing description, ${summary.missingCanonical} missing canonical, ${summary.missingH1} missing H1, ${summary.noindex} noindex.`);
}
