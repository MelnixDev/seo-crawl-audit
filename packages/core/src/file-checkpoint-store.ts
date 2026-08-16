import { appendFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.#replace(identity);
      return null;
    }

    const lines = content.split("\n");
    let savedHeader: unknown;
    try {
      savedHeader = JSON.parse(lines[0] ?? "");
    } catch {
      await this.#replace(identity);
      return null;
    }
    if (!compatible(savedHeader, identity)) {
      await this.#replace(identity);
      return null;
    }

    this.#identity = identity;
    const pages = new Map<string, PageSnapshot>();
    const records = lines.slice(1);
    let lastRecordIndex = records.length - 1;
    while (lastRecordIndex >= 0 && !records[lastRecordIndex]?.trim()) lastRecordIndex -= 1;
    for (const [index, line] of records.entries()) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { type?: unknown; page?: Partial<PageSnapshot> };
        if (record.type === "page" && typeof record.page?.url === "string") {
          pages.set(record.page.url, record.page as PageSnapshot);
        }
      } catch (error) {
        if (index !== lastRecordIndex) {
          throw new Error(`corrupt checkpoint record ${index + 2} in ${this.path}`, { cause: error });
        }
        // The process may stop halfway through its final append. Complete
        // records before that unfinished tail remain valid.
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

  async flush(): Promise<void> {
    await this.#writeQueue;
  }
}

export function createFileCheckpointStore(path: string): FileCheckpointStore {
  return new FileCheckpointStore(path);
}
