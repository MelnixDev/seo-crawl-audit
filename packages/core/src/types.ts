export type Severity = "error" | "warning" | "info";
export type IssueScope = "page" | "site";
export type IssueOwner = "seo" | "content" | "developer";

export type ScanConfigInput = Partial<ScanConfigV1> & Pick<ScanConfigV1, "url">;
export type EngineLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

export interface ScanConfigV1 {
  schemaVersion: 1;
  url: string;
  sitemap: "auto" | "none" | string;
  maxPages: number;
  concurrency: number;
  delay: number;
  timeout: number;
  respectRobots: boolean;
  includeQuery: boolean;
  maxRedirects: number;
  maxResponseBytes: number;
  enabledRules: string[] | null;
  severityOverrides: Record<string, Severity>;
  suppressions: Suppression[];
  regressionBudgets: Record<string, number>;
  report: ReportBranding;
}

export interface Suppression {
  rule: string;
  urlPattern: string;
  reason: string;
  expiresAt?: string;
}

export interface ReportBranding {
  agencyName?: string;
  logo?: string;
  primaryColor?: string;
}

export interface ReportData {
  mode?: "scan" | "check";
  startUrl?: string;
  generatedAt?: string;
  pages?: Array<{ url: string }>;
  issues?: Partial<Issue>[];
  newIssues?: Partial<Issue>[];
  ongoingIssues?: Partial<Issue>[];
  resolvedIssues?: Partial<Issue>[];
  unchangedIssues?: Partial<Issue>[];
  partial?: boolean;
  complete?: boolean;
  targetPages?: number | null;
  engineVersion?: string;
  ruleSetVersion?: string;
  branding?: ReportBranding;
}

export interface ReportOptions {
  branding?: ReportBranding;
}

export interface PageSnapshot {
  url: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  blockedByRobots: boolean;
  error: string | null;
  title: string | null;
  description: string | null;
  canonical: string | null;
  canonicalRaw: string | null;
  robots: string | null;
  xRobotsTag: string | null;
  lang: string | null;
  h1Count: number;
  openGraph: { title: string | null; description: string | null; image: string | null };
  twitter: { card: string | null; title: string | null; description: string | null; image: string | null };
  hreflang: Array<{ lang: string; url: string | null }>;
  jsonLd: Array<{ valid: boolean; value?: unknown; error?: string }>;
  images: Array<{ src: string | null; alt: string | null }>;
  links: string[];
  internalLinks: string[];
  externalLinks: string[];
  wordCount: number;
  contentHash: string | null;
  depth: number;
  redirectChain: Array<{ url: string; status: number; location: string | null }>;
  responseBytes: number;
}

export interface RobotsState {
  url: string;
  status: number | null;
  sha256: string | null;
  error: string | null;
  denyAll?: boolean;
}

export interface SitemapState {
  url: string;
  urls: string[];
  sitemapCount: number;
  truncated: boolean;
  error?: string | null;
}

export interface LinkGraphSummary {
  internalEdges: number;
  externalEdges: number;
  orphanUrls: string[];
  brokenInternalUrls: string[];
}

export interface CrawlStatistics {
  requested: number;
  completed: number;
  succeeded: number;
  failed: number;
  blockedByRobots: number;
  redirected: number;
  durationMs: number;
  truncated: boolean;
  partial: boolean;
}

export interface SnapshotV2 {
  schemaVersion: 2;
  engineVersion: string;
  ruleSetVersion: string;
  generatedAt: string;
  siteUrl: string;
  configurationHash: string;
  config: ScanConfigV1;
  robots: RobotsState;
  sitemap: SitemapState | null;
  pages: PageSnapshot[];
  linkGraph: LinkGraphSummary;
  statistics: CrawlStatistics;
  partial: boolean;
  /** Compatibility view used by the pre-0.2 CLI. */
  source: {
    startUrl: string;
    maxPages: number;
    requestDelay: number;
    includeQuery: boolean;
    respectRobots: boolean;
    sitemap: string | null;
  };
  truncated: boolean;
}

export interface Issue {
  fingerprint: string;
  ruleId: string;
  /** Compatibility alias for ruleId. */
  rule: string;
  severity: Severity;
  scope: IssueScope;
  url: string;
  message: string;
  evidence: Record<string, unknown>;
  owner: IssueOwner;
  remediation: string;
  documentationUrl: string;
  before?: unknown;
  after?: unknown;
  lifecycle?: "new" | "ongoing" | "resolved" | "unchanged";
  suppressed?: { reason: string; expiresAt?: string };
}

export interface DiffResult {
  complete: boolean;
  newIssues: Issue[];
  ongoingIssues: Issue[];
  resolvedIssues: Issue[];
  unchangedIssues: Issue[];
  issues: Issue[];
  budgetExceeded: Array<{ budget: string; allowed: number; actual: number }>;
}

export interface CheckpointIdentity {
  schemaVersion: 2;
  pageSchemaVersion: 1;
  siteUrl: string;
  sitemapUrl: string | null;
  includeQuery: boolean;
  respectRobots: boolean;
  timeout: number;
  maxRedirects: number;
  maxResponseBytes: number;
  userAgent: string;
}

export interface CheckpointState {
  identity: CheckpointIdentity;
  pages: PageSnapshot[];
}

export interface CheckpointStore {
  load(identity: CheckpointIdentity): Promise<CheckpointState | null>;
  append(identity: CheckpointIdentity, page: PageSnapshot): Promise<void>;
  clear(identity: CheckpointIdentity): Promise<void>;
  flush?(): Promise<void>;
}

export interface StorageAdapter {
  loadCheckpoint?(key: string): Promise<unknown | null>;
  saveCheckpoint?(key: string, value: unknown): Promise<void>;
  removeCheckpoint?(key: string): Promise<void>;
}

export type ScanEvent =
  | { type: "plan-start"; url: string }
  | { type: "robots"; robots: RobotsState }
  | { type: "sitemap"; sitemap: SitemapState | null; candidateCount: number | null }
  | { type: "scan-start"; url: string; total: number }
  | { type: "resume"; completed: number; total: number }
  | { type: "page"; page: PageSnapshot; completed: number; total: number }
  | { type: "retry"; url: string; attempt: number; delayMs: number }
  | { type: "checkpoint"; page: PageSnapshot; completed: number; total: number }
  | { type: "progress"; page: PageSnapshot; completed: number; total: number }
  | { type: "complete"; completed: number; total: number; partial?: false }
  | { type: "cancelled"; completed: number; total: number; partial: true };

export interface PlanScanOptions {
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  logger?: EngineLogger;
  onEvent?: (event: ScanEvent) => void | Promise<void>;
}

export interface ScanPlan {
  planVersion: 1;
  config: ScanConfigV1;
  startUrl: string;
  origin: string;
  userAgent: string;
  robots: RobotsState & { body: string; denyAll: boolean; rules: Array<{ type: "allow" | "disallow"; path: string }> };
  sitemap: SitemapState | null;
  candidateUrls: string[];
  candidateCount: number | null;
  mode: "sitemap" | "links";
}

export interface ScanOptions extends PlanScanOptions {
  storage?: StorageAdapter;
  checkpointStore?: CheckpointStore;
  resume?: boolean;
  limit?: number;
  retainCheckpoint?: boolean;
  onProgress?: (completed: number, total: number) => void;
  cachedPages?: PageSnapshot[];
  onBatch?: (pages: PageSnapshot[]) => void | Promise<void>;
}

export interface ScanResult {
  snapshot: SnapshotV2;
  startUrl: string;
  pages: PageSnapshot[];
  robots: RobotsState & { rules?: unknown[]; body?: string };
  sitemap: SitemapState | null;
  truncated: boolean;
  partial?: boolean;
  durationMs?: number;
  /** Compatibility view; resolved scan settings live in snapshot.config. */
  options: object;
}
