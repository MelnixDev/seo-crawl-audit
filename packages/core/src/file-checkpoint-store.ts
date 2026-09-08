import { appendFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  CheckpointIdentity,
  CheckpointState,
  CheckpointStore,
  PageSnapshot,
} from "./types.js";

interface HeaderV2 {
  type: "seo-audit-checkpoint";
  schemaVersion: 2;
  identity: CheckpointIdentity;
}

interface HeaderV1 {
  type: "seo-audit-checkpoint";
  schemaVersion: 1;
  source?: {
    startUrl?: string;
    sitemap?: string | null;
    includeQuery?: boolean;
    respectRobots?: boolean;
  };
}

export interface FileCheckpointInspection {
  path: string;
  status: "missing" | "ready" | "corrupt" | "incompatible";
  schemaVersion: 1 | 2 | null;
  siteUrl: string | null;
  completedPages: number;
  updatedAt: string | null;
  resumable: boolean;
  message: string | null;
}

function header(identity: CheckpointIdentity): HeaderV2 {
  return { type: "seo-audit-checkpoint", schemaVersion: 2, identity };
}

function compatible(saved: unknown, identity: CheckpointIdentity): boolean {
  if (!saved || typeof saved !== "object") return false;
  const candidate = saved as Partial<HeaderV1> | Partial<HeaderV2>;
  if (candidate.type !== "seo-audit-checkpoint") return false;
  if (candidate.schemaVersion === 2) {
    return JSON.stringify((candidate as Partial<HeaderV2>).identity) === JSON.stringify(identity);
  }
  if (candidate.schemaVersion !== 1) return false;
  const source = (candidate as Partial<HeaderV1>).source;
  return source?.startUrl === identity.siteUrl
    && (source.sitemap ?? null) === identity.sitemapUrl
    && (source.includeQuery ?? false) === identity.includeQuery
    && (source.respectRobots ?? true) === identity.respectRobots;
}

export class FileCheckpointStore implements CheckpointStore {
  readonly path: string;
  #identity: CheckpointIdentity | null = null;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async #replace(identity: CheckpointIdentity): Promise<void> {
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(header(identity))}\n`, "utf8");
    await rename(temporaryPath, this.path);
    this.#identity = identity;
  }

  async load(identity: CheckpointIdentity): Promise<CheckpointState | null> {
    await this.flush();
    try {
      await stat(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.#replace(identity);
      return null;
    }
    const input = createReadStream(this.path, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const pages = new Map<string, PageSnapshot>();
    let savedHeader: unknown;
    let lineNumber = 0;
    let pending: { line: string; lineNumber: number } | null = null;
    const parsePage = (recordLine: string, recordLineNumber: number): void => {
      try {
        const record = JSON.parse(recordLine) as { type?: unknown; page?: Partial<PageSnapshot> };
        if (record.type === "page" && typeof record.page?.url === "string") {
          pages.set(record.page.url, record.page as PageSnapshot);
        }
      } catch (error) {
        throw new Error(`corrupt checkpoint record ${recordLineNumber} in ${this.path}`, { cause: error });
      }
    };
    for await (const line of lines) {
      lineNumber += 1;
      if (lineNumber === 1) {
        try { savedHeader = JSON.parse(line); } catch { savedHeader = null; }
        if (!compatible(savedHeader, identity)) {
          lines.close();
          input.destroy();
          await this.#replace(identity);
          return null;
        }
        this.#identity = identity;
        continue;
      }
      if (!line.trim()) continue;
      if (pending) parsePage(pending.line, pending.lineNumber);
      pending = { line, lineNumber };
    }
    if (lineNumber === 0 || !compatible(savedHeader, identity)) {
      await this.#replace(identity);
      return null;
    }
    if (pending) {
      try {
        parsePage(pending.line, pending.lineNumber);
      } catch {
        // An interrupted append may leave only the final NDJSON record
        // incomplete. Every complete record before it remains reusable.
      }
    }
    return { identity, pages: [...pages.values()] };
  }

  append(identity: CheckpointIdentity, page: PageSnapshot): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      if (!this.#identity || JSON.stringify(this.#identity) !== JSON.stringify(identity)) {
        await this.#replace(identity);
      }
      await appendFile(this.path, `${JSON.stringify({ type: "page", page })}\n`, "utf8");
    });
    return this.#writeQueue;
  }

  async clear(identity: CheckpointIdentity): Promise<void> {
    await this.flush();
    if (this.#identity && JSON.stringify(this.#identity) !== JSON.stringify(identity)) return;
    try {
      await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#identity = null;
  }

  /** Clears the currently loaded journal after all durable outputs are safe. */
  async clearCurrent(): Promise<void> {
    if (!this.#identity) return;
    await this.clear(this.#identity);
  }

  async flush(): Promise<void> {
    await this.#writeQueue;
  }
}

export function createFileCheckpointStore(path: string): FileCheckpointStore {
  return new FileCheckpointStore(path);
}

export async function inspectFileCheckpoint(path: string): Promise<FileCheckpointInspection> {
  let updatedAt: string;
  try {
    updatedAt = (await stat(path)).mtime.toISOString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, status: "missing", schemaVersion: null, siteUrl: null, completedPages: 0, updatedAt: null, resumable: false, message: null };
    }
    throw error;
  }

  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let savedHeader: unknown;
  const pages = new Set<string>();
  let lineNumber = 0;
  let pending: { line: string; lineNumber: number } | null = null;
  const parseRecord = (line: string, recordLine: number): FileCheckpointInspection | null => {
    try {
      const record = JSON.parse(line) as { type?: unknown; page?: { url?: unknown } };
      if (record.type === "page" && typeof record.page?.url === "string") pages.add(record.page.url);
    } catch {
      return { path, status: "corrupt", schemaVersion: null, siteUrl: null, completedPages: pages.size, updatedAt, resumable: false, message: `checkpoint record ${recordLine} is corrupt` };
    }
    return null;
  };
  for await (const line of lines) {
    lineNumber += 1;
    if (lineNumber === 1) {
      try { savedHeader = JSON.parse(line); } catch { savedHeader = null; }
      continue;
    }
    if (!line.trim()) continue;
    if (pending) {
      const failure = parseRecord(pending.line, pending.lineNumber);
      if (failure) return failure;
    }
    pending = { line, lineNumber };
  }
  if (!savedHeader) {
    return { path, status: "corrupt", schemaVersion: null, siteUrl: null, completedPages: 0, updatedAt, resumable: false, message: "checkpoint header is not valid JSON" };
  }
  if (typeof savedHeader !== "object" || (savedHeader as { type?: unknown }).type !== "seo-audit-checkpoint") {
    return { path, status: "incompatible", schemaVersion: null, siteUrl: null, completedPages: 0, updatedAt, resumable: false, message: "file is not an SEO Crawl Audit checkpoint" };
  }
  const candidate = savedHeader as Partial<HeaderV1> | Partial<HeaderV2>;
  const schemaVersion = candidate.schemaVersion === 1 || candidate.schemaVersion === 2 ? candidate.schemaVersion : null;
  if (schemaVersion === null) {
    return { path, status: "incompatible", schemaVersion: null, siteUrl: null, completedPages: 0, updatedAt, resumable: false, message: "checkpoint schema is not supported" };
  }
  const siteUrl = schemaVersion === 2
    ? ((candidate as Partial<HeaderV2>).identity?.siteUrl ?? null)
    : ((candidate as Partial<HeaderV1>).source?.startUrl ?? null);
  if (pending) {
    try {
      const record = JSON.parse(pending.line) as { type?: unknown; page?: { url?: unknown } };
      if (record.type === "page" && typeof record.page?.url === "string") pages.add(record.page.url);
    } catch {
      // Only an incomplete final append is recoverable.
    }
  }
  return { path, status: "ready", schemaVersion, siteUrl, completedPages: pages.size, updatedAt, resumable: pages.size > 0, message: null };
}
