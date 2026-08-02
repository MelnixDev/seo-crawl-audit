import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  createBaseline,
  readBaseline,
  writeBaseline,
} from "./baseline.js";
import { auditBaseline } from "./audit.js";
import {
  appendCheckpointPages,
  checkpointPathForOutput,
  initializeCheckpoint,
  removeCheckpoint,
} from "./checkpoint.js";
import { compareBaselines } from "./compare.js";
import { crawlSite, fetchPages } from "./crawler.js";
import { writeHtmlReport } from "./html-report.js";
import { printIssues, summarizeIssues } from "./report.js";
import { createRequestGate } from "./request-gate.js";
import {
  discoverSitemapUrl,
  loadSitemapUrls,
} from "./sitemap.js";
import { mapUrlToBaseline, mapUrlToTarget } from "./target.js";
import { normalizeUrl } from "./urls.js";

const VERSION = "0.1.2";
const DEFAULT_BASELINE = ".seo-audit.json";
const DEFAULT_REPORT = "seo-audit-report.html";

const HELP = `seo-audit ${VERSION}

Local-first SEO crawler, audit, and regression checker.

Usage:
  seo-audit <url> [options]
  seo-audit scan <url> [options]
  seo-audit check [url] [options]
  seo-audit report [baseline] [options]

Commands:
  <url>   Shortcut for scan.
  scan    Crawl a site and save its SEO baseline.
  check   Crawl again and compare with a saved baseline.
  report  Generate HTML from an existing baseline without crawling.

Options:
  --baseline <file>       Baseline file for check (default: .seo-audit.json)
  --output <file>         Output file for scan (default: .seo-audit.json)
  --report <file>         HTML report path (default: seo-audit-report.html)
  --no-report             Do not generate the automatic HTML report
  --no-cache              Disable scan checkpoint caching and resume
  --pages <number>        Scan an exact number of pages
  --all                   Scan every URL found in the sitemap
  --max-pages <number>    Deprecated alias for --pages
  --concurrency <number>  Concurrent requests (default: 5)
  --delay <ms>            Delay between request starts (default: 100)
  --timeout <ms>          Request timeout in milliseconds (default: 10000)
  --sitemap <url>         Seed the crawl from a sitemap or sitemap index
  --no-sitemap            Skip sitemap discovery and crawl internal links
  --include-query         Treat query-string URLs as separate pages
  --ignore-robots         Crawl URLs disallowed by robots.txt
  --strict                Fail check on warnings as well as errors
  --json                  Print machine-readable command output
  --help                  Show this help
  --version               Show the version

Exit codes:
  0  No blocking regressions
  1  SEO regressions detected
  2  Invalid input or crawler failure
`;

function positiveInteger(value, name, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, name, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseCliArgs(args) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      baseline: { type: "string" },
      output: { type: "string" },
      report: { type: "string" },
      "no-report": { type: "boolean" },
      "no-cache": { type: "boolean" },
      pages: { type: "string" },
      all: { type: "boolean" },
      "max-pages": { type: "string" },
      concurrency: { type: "string" },
      delay: { type: "string" },
      timeout: { type: "string" },
      sitemap: { type: "string" },
      "no-sitemap": { type: "boolean" },
      "include-query": { type: "boolean" },
      "ignore-robots": { type: "boolean" },
      strict: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
  });
}

function shouldGenerateReport(values, force = false) {
  if (force) {
    return true;
  }

  if (values["no-report"]) {
    return false;
  }

  return (
    values.report !== undefined ||
    (process.stdin.isTTY && process.stdout.isTTY && !values.json)
  );
}

function getReportOutput(values) {
  return resolve(values.report ?? DEFAULT_REPORT);
}

async function generateReport(values, payload, force = false) {
  if (!shouldGenerateReport(values, force)) {
    return null;
  }

  const output = getReportOutput(values);
  await writeHtmlReport(output, payload);
  return output;
}

function crawlerOptions(values, baseline) {
  return {
    maxPages: positiveInteger(
      values.pages ?? values["max-pages"],
      values.pages !== undefined ? "--pages" : "--max-pages",
      baseline?.source.maxPages ?? 100,
    ),
    concurrency: positiveInteger(values.concurrency, "--concurrency", 5),
    requestDelay: nonNegativeInteger(
      values.delay,
      "--delay",
      baseline?.source.requestDelay ?? 100,
    ),
    timeout: positiveInteger(values.timeout, "--timeout", 10_000),
    includeQuery:
      values["include-query"] ?? baseline?.source.includeQuery ?? false,
    respectRobots:
      values["ignore-robots"] === undefined
        ? (baseline?.source.respectRobots ?? true)
        : !values["ignore-robots"],
    sitemap: values["no-sitemap"]
      ? null
      : (values.sitemap ?? baseline?.source.sitemap ?? null),
  };
}

function getHealthSummary(baseline) {
  return baseline.pages.reduce(
    (summary, page) => {
      if (page.error || page.blockedByRobots || (page.status ?? 500) >= 400) {
        summary.unavailable += 1;
      }
      if (!page.title) {
        summary.missingTitle += 1;
      }
      if (!page.description) {
        summary.missingDescription += 1;
      }
      if (!page.canonical) {
        summary.missingCanonical += 1;
      }
      if ((page.h1Count ?? 0) === 0) {
        summary.missingH1 += 1;
      }
      if (/(^|[\s,])noindex($|[\s,])/i.test(page.robots ?? "")) {
        summary.noindex += 1;
      }
      return summary;
    },
    {
      unavailable: 0,
      missingTitle: 0,
      missingDescription: 0,
      missingCanonical: 0,
      missingH1: 0,
      noindex: 0,
    },
  );
}

export function parseScanMenuSelection(input, totalPages) {
  const normalized = input.trim().toLowerCase();

  if (normalized === "" || normalized === "1") {
    return { mode: "fixed", target: Math.min(100, totalPages) };
  }
  if (normalized === "2" || normalized === "all") {
    return { mode: "all", target: totalPages };
  }
  if (normalized === "3" || normalized === "step") {
    return { mode: "step", target: totalPages };
  }

  const number = Number.parseInt(normalized, 10);
  if (/^\d+$/.test(normalized) && number > 0) {
    return { mode: "fixed", target: Math.min(number, totalPages) };
  }

  return null;
}

function printHealth(health) {
  console.log(
    `Current health: ${health.unavailable} unavailable, ${health.missingTitle} missing title, ${health.missingDescription} missing description, ${health.missingCanonical} missing canonical, ${health.missingH1} missing H1, ${health.noindex} noindex.`,
  );
}

async function chooseScanPlan(totalPages) {
  while (true) {
    console.log(`\nSitemap contains ${totalPages.toLocaleString("en-US")} page(s).`);
    console.log("How many pages should be scanned?");
    console.log("  1) First 100");
    console.log(`  2) All ${totalPages.toLocaleString("en-US")}`);
    console.log("  3) 100 at a time with confirmation");
    console.log("  Or enter an exact number, for example 500.");

    const selection = parseScanMenuSelection(
      await ask("Choose [1]: "),
      totalPages,
    );
    if (!selection) {
      console.log("Enter 1, 2, 3, all, step, or a positive number.");
      continue;
    }

    if (selection.mode === "all") {
      const confirmation = await ask(
        `This will request ${totalPages.toLocaleString("en-US")} pages. Continue? [y/N] `,
      );
      if (!["y", "yes"].includes(confirmation.toLowerCase())) {
        continue;
      }
    }

    return selection;
  }
}

function printProgress(checked, target, { persistent = false } = {}) {
  const ratio = target === 0 ? 1 : Math.min(checked / target, 1);
  const percent = (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0);
  const filled = Math.round(ratio * 20);
  const bar = `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
  const message = `[${bar}] ${percent}% · ${checked.toLocaleString("en-US")} / ${target.toLocaleString("en-US")} pages`;

  if (process.stdout.isTTY && !persistent) {
    process.stdout.write(`\r${message}`);
    if (checked >= target) {
      process.stdout.write("\n");
    }
  } else if (
    process.stdout.isTTY ||
    checked >= target ||
    checked % 1_000 === 0
  ) {
    console.log(message);
  }
}

async function ask(question) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

async function resolveSitemap(startUrl, values, options) {
  if (values.sitemap && values["no-sitemap"]) {
    throw new Error("--sitemap and --no-sitemap cannot be used together");
  }

  if (values["no-sitemap"]) {
    return null;
  }

  if (values.sitemap) {
    return values.sitemap;
  }

  const discovered = await discoverSitemapUrl(startUrl, {
    timeout: options.timeout,
    userAgent: "seo-crawl-audit/0.1.2",
    requestGate: options.requestGate,
  });
  if (discovered) {
    if (!values.json) {
      console.log(`Found sitemap: ${discovered}`);
    }
    return discovered;
  }

  if (process.stdin.isTTY && process.stdout.isTTY && !values.json) {
    const entered = await ask(
      "Sitemap was not found. Enter its full URL, or press Enter to crawl internal links: ",
    );
    return entered || null;
  }

  return null;
}

async function scanCommand(url, values) {
  if (!url) {
    throw new Error("scan requires a URL");
  }

  const output = resolve(values.output ?? DEFAULT_BASELINE);
  const options = crawlerOptions(values);
  options.requestGate = createRequestGate(options.requestDelay);
  const normalizedStartUrl = normalizeUrl(url, undefined, {
    includeQuery: options.includeQuery,
  });
  if (!normalizedStartUrl) {
    throw new Error(`invalid start URL: ${url}`);
  }
  options.sitemap = await resolveSitemap(
    normalizedStartUrl,
    values,
    options,
  );
  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && !values.json;
  let scanPlan = {
    mode: "fixed",
    target: options.maxPages,
  };

  if (options.sitemap) {
    const startUrl = normalizedStartUrl;
    options.sitemapData = await loadSitemapUrls(options.sitemap, {
      ...options,
      maxUrls: 50_000,
      siteOrigin: new URL(startUrl).origin,
    });
    const totalCandidates = new Set([
      startUrl,
      ...options.sitemapData.urls,
    ]).size;

    if (values.all) {
      scanPlan = { mode: "all", target: totalCandidates };
    } else if (
      values.pages !== undefined ||
      values["max-pages"] !== undefined
    ) {
      scanPlan = {
        mode: "fixed",
        target: Math.min(options.maxPages, totalCandidates),
      };
    } else if (isInteractive) {
      scanPlan = await chooseScanPlan(totalCandidates);
    } else {
      scanPlan = {
        mode: "fixed",
        target: Math.min(100, totalCandidates),
      };
    }
  } else if (values.all) {
    throw new Error("--all requires a sitemap");
  }

  const batchSize = Math.min(100, scanPlan.target);
  options.maxPages = batchSize;
  const checkpointEnabled = !values["no-cache"];
  const checkpointPath = checkpointPathForOutput(output);
  const checkpointSource = {
    startUrl: normalizedStartUrl,
    sitemap: options.sitemap,
    includeQuery: options.includeQuery,
    respectRobots: options.respectRobots,
  };
  const checkpoint = checkpointEnabled
    ? await initializeCheckpoint(checkpointPath, checkpointSource)
    : { pages: [], resumed: false };
  const plannedUrls = options.sitemapData
    ? new Set(
        [
          normalizedStartUrl,
          ...options.sitemapData.urls,
        ].slice(0, scanPlan.target),
      )
    : null;
  const cachedPages = checkpoint.pages
    .filter((page) => !plannedUrls || plannedUrls.has(page.url))
    .slice(0, scanPlan.target);
  const savedPages = new Map(
    cachedPages.map((page) => [page.url, page]),
  );
  const reportEnabled = shouldGenerateReport(values);
  const partialReportOutput = reportEnabled
    ? getReportOutput(values)
    : null;
  let lastReportPageCount = -1;
  let lastReportAt = 0;

  if (savedPages.size > 0 && !values.json) {
    console.log(
      `Resuming from checkpoint: ${savedPages.size.toLocaleString("en-US")} page(s) already saved.`,
    );
  }

  const writePartialReport = async (force = false) => {
    if (!partialReportOutput) {
      return;
    }

    const now = Date.now();
    const hasFirstResults =
      lastReportPageCount === 0 && savedPages.size > 0;
    if (
      !force &&
      !hasFirstResults &&
      lastReportPageCount >= 0 &&
      savedPages.size - lastReportPageCount < 100 &&
      now - lastReportAt < 5_000
    ) {
      return;
    }

    const pages = [...savedPages.values()].sort((left, right) =>
      left.url.localeCompare(right.url),
    );
    await writeHtmlReport(partialReportOutput, {
      mode: "scan",
      startUrl: normalizedStartUrl,
      generatedAt: new Date().toISOString(),
      pages,
      issues: auditBaseline({ pages }),
      partial: true,
      targetPages: scanPlan.target,
    });
    lastReportPageCount = savedPages.size;
    lastReportAt = now;
  };

  const saveFreshPages = async (pages, forceReport = false) => {
    const fresh = pages.filter((page) => !savedPages.has(page.url));
    for (const page of fresh) {
      savedPages.set(page.url, page);
    }
    if (checkpointEnabled) {
      await appendCheckpointPages(checkpointPath, fresh);
    }
    await writePartialReport(forceReport);
  };

  await writePartialReport(true);

  const scan = await crawlSite(url, {
    ...options,
    cachedPages,
    onBatch: saveFreshPages,
    onProgress:
      !values.json && scanPlan.mode !== "step"
        ? (checkedPages) =>
            printProgress(
              Math.min(
                Math.max(savedPages.size, checkedPages),
                scanPlan.target,
              ),
              scanPlan.target,
            )
        : undefined,
  });
  const checked = new Map(savedPages);
  for (const page of scan.pages) {
    checked.set(page.url, page);
  }
  if (
    !values.json &&
    process.stdout.isTTY &&
    scanPlan.mode !== "step" &&
    !scan.sitemap &&
    checked.size < scanPlan.target
  ) {
    process.stdout.write("\n");
  }
  const allCandidates = [
    ...new Set([scan.startUrl, ...(scan.sitemap?.urls ?? [])]),
  ];
  let pendingUrls = allCandidates.filter((pageUrl) => !checked.has(pageUrl));

  if (
    scan.sitemap &&
    scanPlan.mode === "step" &&
    scanPlan.target > checked.size &&
    !values.json
  ) {
    printProgress(checked.size, scanPlan.target, {
      persistent: scanPlan.mode === "step",
    });
  }

  while (
    scan.sitemap &&
    pendingUrls.length > 0 &&
    checked.size < scanPlan.target
  ) {
    if (scanPlan.mode === "step") {
      printHealth(
        getHealthSummary({
          pages: [...checked.values()],
        }),
      );
      const nextSize = Math.min(
        100,
        scanPlan.target - checked.size,
        pendingUrls.length,
      );
      const answer = await ask(
        `Check the next ${nextSize} page(s)? [y/N] `,
      );
      if (!["y", "yes"].includes(answer.toLowerCase())) {
        break;
      }
    }

    const batch = pendingUrls.slice(
      0,
      Math.min(100, scanPlan.target - checked.size),
    );
    const additional = await fetchPages(batch, {
      ...options,
      robots: scan.robots,
      onBatch: saveFreshPages,
    });
    for (const page of additional.pages) {
      checked.set(page.url, page);
    }
    await writePartialReport(true);
    pendingUrls = allCandidates.filter(
      (pageUrl) => !checked.has(pageUrl),
    );

    if (!values.json) {
      printProgress(checked.size, scanPlan.target, {
        persistent: scanPlan.mode === "step",
      });
    }
  }

  scan.pages = [...checked.values()].sort((left, right) =>
    left.url.localeCompare(right.url),
  );
  scan.options.maxPages = scanPlan.target;
  scan.truncated =
    checked.size < allCandidates.length || (scan.sitemap?.truncated ?? false);
  const baseline = createBaseline(scan);
  const health = getHealthSummary(baseline);
  await writeBaseline(output, baseline);
  const targetCompleted =
    checked.size >= scanPlan.target || pendingUrls.length === 0;
  let reportOutput;
  if (targetCompleted) {
    if (checkpointEnabled) {
      await removeCheckpoint(checkpointPath);
    }
    reportOutput = await generateReport(values, {
      mode: "scan",
      startUrl: baseline.source.startUrl,
      generatedAt: new Date().toISOString(),
      pages: baseline.pages,
      issues: auditBaseline(baseline),
    });
  } else {
    await writePartialReport(true);
    reportOutput = partialReportOutput;
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          command: "scan",
          pages: baseline.pages.length,
          truncated: baseline.truncated,
          health,
          output,
          report: reportOutput,
          checkpoint: targetCompleted || !checkpointEnabled
            ? null
            : checkpointPath,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Crawled ${baseline.pages.length} page(s)${baseline.truncated ? " (limit reached)" : ""}.`,
    );
    if (baseline.sitemap) {
      console.log(
        `Loaded ${baseline.sitemap.sitemapCount} sitemap file(s) from ${baseline.sitemap.url}.`,
      );
    }
    printHealth(health);
    console.log(`Baseline saved to ${output}`);
    if (reportOutput) {
      console.log(`HTML report saved to ${reportOutput}`);
    }
    if (!targetCompleted && checkpointEnabled) {
      console.log(`Resume checkpoint saved to ${checkpointPath}`);
    }
  }

  return 0;
}

async function checkCommand(url, values) {
  const baselinePath = resolve(values.baseline ?? DEFAULT_BASELINE);
  const baseline = await readBaseline(baselinePath);
  const startUrl = url ?? baseline.source.startUrl;
  const options = crawlerOptions(values, baseline);
  options.requestGate = createRequestGate(options.requestDelay);
  if (options.sitemap) {
    options.sitemap = mapUrlToTarget(
      options.sitemap,
      baseline.source.startUrl,
      startUrl,
    );
  }
  const totalPages = baseline.pages.length;
  const scan = await crawlSite(startUrl, {
    ...options,
    onProgress: values.json
      ? undefined
      : (checkedPages) => printProgress(
          Math.min(checkedPages, totalPages),
          totalPages,
        ),
  });
  const checked = new Map(scan.pages.map((page) => [page.url, page]));
  const targets = baseline.pages.map((page) => ({
    baselineUrl: page.url,
    targetUrl: mapUrlToTarget(
      page.url,
      baseline.source.startUrl,
      scan.startUrl,
    ),
  }));
  const missingUrls = targets
    .map((target) => target.targetUrl)
    .filter((targetUrl) => !checked.has(targetUrl));

  if (missingUrls.length > 0) {
    const additional = await fetchPages(missingUrls, {
      ...options,
      robots: scan.robots,
      onProgress: values.json
        ? undefined
        : (checkedPages) =>
            printProgress(
              Math.min(scan.pages.length + checkedPages, totalPages),
              totalPages,
            ),
    });
    for (const page of additional.pages) {
      checked.set(page.url, page);
    }
  }

  const comparablePages = targets
    .map(({ baselineUrl, targetUrl }) => {
      const page = checked.get(targetUrl);
      if (!page) {
        return null;
      }

      return {
        ...page,
        url: baselineUrl,
        finalUrl: mapUrlToBaseline(
          page.finalUrl,
          baseline.source.startUrl,
          scan.startUrl,
        ),
      };
    })
    .filter(Boolean);
  const current = createBaseline({
    ...scan,
    pages: comparablePages.sort((left, right) =>
      left.url.localeCompare(right.url),
    ),
  });
  const issues = compareBaselines(baseline, current);
  const summary = summarizeIssues(issues);
  const reportOutput = await generateReport(values, {
    mode: "check",
    startUrl,
    generatedAt: new Date().toISOString(),
    pages: current.pages,
    issues,
  });

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          command: "check",
          baseline: baselinePath,
          pages: current.pages.length,
          summary,
          issues,
          report: reportOutput,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Checked ${current.pages.length} page(s).\n`);
    printIssues(issues);
    if (reportOutput) {
      console.log(`HTML report saved to ${reportOutput}`);
    }
  }

  return summary.error > 0 || (values.strict && summary.warning > 0) ? 1 : 0;
}

async function reportCommand(inputPath, values) {
  const baselinePath = resolve(inputPath ?? values.baseline ?? DEFAULT_BASELINE);
  const baseline = await readBaseline(baselinePath);
  const reportOutput = await generateReport(
    values,
    {
      mode: "scan",
      startUrl: baseline.source.startUrl,
      generatedAt: new Date().toISOString(),
      pages: baseline.pages,
      issues: auditBaseline(baseline),
    },
    true,
  );

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          command: "report",
          baseline: baselinePath,
          pages: baseline.pages.length,
          report: reportOutput,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`HTML report saved to ${reportOutput}`);
  }

  return 0;
}

export async function main(args = process.argv.slice(2)) {
  let parsed;

  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    console.error(`${error.message}\n\n${HELP}`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    console.log(VERSION);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return 0;
  }

  let [command, url, ...extra] = positionals;
  if (/^https?:\/\//i.test(command)) {
    extra = positionals.slice(1);
    url = command;
    command = "scan";
  }
  if (extra.length > 0) {
    console.error(`Unexpected argument: ${extra[0]}`);
    return 2;
  }

  try {
    if (command === "scan") {
      return await scanCommand(url, values);
    }
    if (command === "check") {
      return await checkCommand(url, values);
    }
    if (command === "report") {
      return await reportCommand(url, values);
    }

    console.error(`Unknown command: ${command}\n\n${HELP}`);
    return 2;
  } catch (error) {
    console.error(`seo-audit: ${error.message}`);
    return 2;
  }
}
