import { parentPort, workerData } from "node:worker_threads";
import { calculateTrendSummary, type TrendOptions } from "@seo-crawl-audit/core/node";

interface WorkerInput { directory: string; options: TrendOptions }
const input = workerData as WorkerInput;
try {
  const summary = await calculateTrendSummary(input.directory, {
    ...input.options,
    onProgress: (completed, total) => parentPort?.postMessage({ type: "progress", completed, total }),
  });
  parentPort?.postMessage({ type: "result", summary });
} catch (error) {
  parentPort?.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
