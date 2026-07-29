import {
  appendFile,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { extname } from "node:path";

const SCHEMA_VERSION = 1;

function header(source) {
  return {
    type: "seo-audit-checkpoint",
    schemaVersion: SCHEMA_VERSION,
    source,
  };
}

function isCompatible(value, source) {
  return (
    value?.type === "seo-audit-checkpoint" &&
    value.schemaVersion === SCHEMA_VERSION &&
    JSON.stringify(value.source) === JSON.stringify(source)
  );
}

export function checkpointPathForOutput(output) {
  const extension = extname(output);
  if (!extension) {
    return `${output}.checkpoint.ndjson`;
  }

  return `${output.slice(0, -extension.length)}.checkpoint.ndjson`;
}

export async function initializeCheckpoint(path, source) {
  try {
    const lines = (await readFile(path, "utf8")).split("\n");
    const savedHeader = JSON.parse(lines[0]);

    if (isCompatible(savedHeader, source)) {
      const pages = [];
      for (const line of lines.slice(1)) {
        if (!line.trim()) {
          continue;
        }

        try {
          const record = JSON.parse(line);
          if (record?.type === "page" && record.page?.url) {
            pages.push(record.page);
          }
        } catch {
          // A process can stop halfway through its final line. Earlier records
          // remain valid and are still safe to resume from.
        }
      }

      return { pages, resumed: pages.length > 0 };
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }

  await writeFile(path, `${JSON.stringify(header(source))}\n`, "utf8");
  return { pages: [], resumed: false };
}

export async function appendCheckpointPages(path, pages) {
  if (pages.length === 0) {
    return;
  }

  const records = pages
    .map((page) => JSON.stringify({ type: "page", page }))
    .join("\n");
  await appendFile(path, `${records}\n`, "utf8");
}

export async function removeCheckpoint(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
