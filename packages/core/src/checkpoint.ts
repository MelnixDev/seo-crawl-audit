import {
  appendFile,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { extname } from "node:path";
import type { PageSnapshot } from "./types.js";

const SCHEMA_VERSION = 1;

interface LegacyCheckpointHeader {
  type: "seo-audit-checkpoint";
  schemaVersion: 1;
  source: Record<string, unknown>;
}

interface LegacyCheckpointResult {
  pages: Array<Partial<PageSnapshot> & Pick<PageSnapshot, "url">>;
  resumed: boolean;
}

function header(source: Record<string, unknown>): LegacyCheckpointHeader {
  return {
    type: "seo-audit-checkpoint",
    schemaVersion: SCHEMA_VERSION,
    source,
  };
}

function isCompatible(value: unknown, source: Record<string, unknown>): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacyCheckpointHeader>;
  return (
    candidate.type === "seo-audit-checkpoint" &&
    candidate.schemaVersion === SCHEMA_VERSION &&
    JSON.stringify(candidate.source) === JSON.stringify(source)
  );
}

export function checkpointPathForOutput(output: string): string {
  const extension = extname(output);
  if (!extension) {
    return `${output}.checkpoint.ndjson`;
  }

  return `${output.slice(0, -extension.length)}.checkpoint.ndjson`;
}

export async function initializeCheckpoint(path: string, source: Record<string, unknown>): Promise<LegacyCheckpointResult> {
  try {
    const lines = (await readFile(path, "utf8")).split("\n");
    const savedHeader = JSON.parse(lines[0]);

    if (isCompatible(savedHeader, source)) {
      const pages: LegacyCheckpointResult["pages"] = [];
      for (const line of lines.slice(1)) {
        if (!line.trim()) {
          continue;
        }

        try {
          const record = JSON.parse(line) as { type?: unknown; page?: Partial<PageSnapshot> };
          if (record.type === "page" && typeof record.page?.url === "string") {
            pages.push(record.page as Partial<PageSnapshot> & Pick<PageSnapshot, "url">);
          }
        } catch {
          // A process can stop halfway through its final line. Earlier records
          // remain valid and are still safe to resume from.
        }
      }

      return { pages, resumed: pages.length > 0 };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }

  await writeFile(path, `${JSON.stringify(header(source))}\n`, "utf8");
  return { pages: [], resumed: false };
}

export async function appendCheckpointPages(
  path: string,
  pages: ReadonlyArray<Partial<PageSnapshot> & Pick<PageSnapshot, "url">>,
): Promise<void> {
  if (pages.length === 0) {
    return;
  }

  const records = pages
    .map((page) => JSON.stringify({ type: "page", page }))
    .join("\n");
  await appendFile(path, `${records}\n`, "utf8");
}

export async function removeCheckpoint(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
