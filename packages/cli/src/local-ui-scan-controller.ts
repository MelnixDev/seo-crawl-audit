import { resolveConfig, type ScanConfigV1, type ScanPlan } from "@seo-crawl-audit/core";

export const MAX_LOCAL_UI_PAGES = 50_000;
export const LARGE_SCAN_THRESHOLD = 5_000;

export interface FullScanDecision {
  limit: number;
  confirmation?: {
    candidateCount: number;
    estimatedSeconds: number;
    message: string;
  };
}

function profilePageLimit(input: Record<string, unknown>): number {
  const profile = String(input.profile ?? "custom");
  if (profile === "quick") return 100;
  if (profile === "standard") return 1_000;
  if (profile === "full") return MAX_LOCAL_UI_PAGES;
  if (profile !== "custom") throw new Error("scan profile must be quick, standard, full, or custom");
  const pages = Number(input.maxPages ?? 100);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_LOCAL_UI_PAGES) {
    throw new Error(`pages must be an integer between 1 and ${MAX_LOCAL_UI_PAGES}`);
  }
  return pages;
}

export function resolveLocalScanConfig(input: Record<string, unknown>, url: string): ScanConfigV1 {
  return resolveConfig({
    url,
    maxPages: profilePageLimit(input),
    concurrency: Number(input.concurrency ?? 5),
    delay: Number(input.delay ?? 100),
  });
}

export function decideFullScan(plan: ScanPlan, input: Record<string, unknown>): FullScanDecision {
  if (input.profile !== "full") return { limit: plan.config.maxPages };
  if (plan.mode !== "sitemap" || plan.candidateCount === null) {
    throw new Error("Full sitemap mode needs a discovered sitemap. Choose Custom for link discovery.");
  }
  if (plan.sitemap?.truncated || plan.candidateCount > MAX_LOCAL_UI_PAGES) {
    throw new Error(`The sitemap exceeds the ${MAX_LOCAL_UI_PAGES.toLocaleString("en-US")} page safety limit.`);
  }
  const limit = plan.candidateCount;
  if (limit <= LARGE_SCAN_THRESHOLD || input.confirmLargeScan === true) return { limit };
  const estimatedSeconds = Math.ceil(limit * (plan.config.delay + 250) / Math.max(1, plan.config.concurrency) / 1_000);
  return {
    limit,
    confirmation: {
      candidateCount: limit,
      estimatedSeconds,
      message: `Scan up to ${limit.toLocaleString("en-US")} pages with concurrency ${plan.config.concurrency} and ${plan.config.delay} ms delay? Estimated minimum duration: ${estimatedSeconds.toLocaleString("en-US")} seconds.`,
    },
  };
}
