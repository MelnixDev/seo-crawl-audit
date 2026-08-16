import { createBaseline, type BaselineInput } from "./baseline.js";
import type { SnapshotV2 } from "./types.js";

export function normalizeSnapshotInput(input: SnapshotV2 | BaselineInput): SnapshotV2 {
  if (input.schemaVersion === 2) return input as SnapshotV2;
  const legacy = input as BaselineInput;
  const firstPage = legacy.pages?.[0];
  const firstPageUrl = firstPage && typeof firstPage === "object" ? (firstPage as { url?: unknown }).url : undefined;
  const firstUrl = typeof firstPageUrl === "string" ? firstPageUrl : legacy.source?.startUrl ?? "https://invalid.local/";
  return createBaseline({
    ...legacy,
    startUrl: legacy.siteUrl ?? legacy.source?.startUrl ?? firstUrl,
    robots: legacy.robots ?? { url: new URL("/robots.txt", firstUrl).href, status: null, sha256: null, error: null },
    options: legacy.config ?? legacy.options ?? {},
  });
}
