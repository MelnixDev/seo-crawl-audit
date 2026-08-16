import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "seo-crawl-audit-packages-"));
const cachePath = join(temporaryRoot, "npm-cache");

async function run(command, args, cwd = projectRoot) {
  return execute(command, args, {
    cwd,
    env: { ...process.env, npm_config_cache: cachePath },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function pack(workspace) {
  const { stdout } = await run("npm", ["pack", "--workspace", workspace, "--json", "--pack-destination", temporaryRoot]);
  const [metadata] = JSON.parse(stdout);
  assert.ok(metadata, `npm pack did not return metadata for ${workspace}`);
  return { metadata, path: join(temporaryRoot, metadata.filename) };
}

try {
  const core = await pack("@seo-crawl-audit/core");
  const cli = await pack("seo-crawl-audit");
  const corePaths = core.metadata.files.map((file) => file.path);
  assert.equal(corePaths.some((path) => path.endsWith(".tsbuildinfo")), false);
  assert.equal(corePaths.some((path) => path.endsWith(".d.ts.map")), false);
  assert.equal(corePaths.includes("dist/index.d.ts"), true);
  assert.equal(corePaths.includes("dist/node.d.ts"), true);
  assert.ok(cli.metadata.unpackedSize <= 500 * 1024, `CLI tarball is ${cli.metadata.unpackedSize} bytes unpacked`);
  assert.ok((await stat(resolve(projectRoot, "packages/action/action-dist/index.cjs"))).size <= 1.2 * 1024 * 1024);

  await writeFile(join(temporaryRoot, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "@seo-crawl-audit/core": `file:${core.path}`,
      "seo-crawl-audit": `file:${cli.path}`,
    },
  }, null, 2)}\n`);
  await run("npm", ["install", "--ignore-scripts"], temporaryRoot);

  await writeFile(join(temporaryRoot, "smoke.mjs"), `
    import { audit, diff, getRuleDefinitions, migrateSnapshot, planScan, renderReport, scan } from "@seo-crawl-audit/core";
    import { createFileCheckpointStore, loadConfig, readSnapshot, writeReport, writeSnapshot } from "@seo-crawl-audit/core/node";
    for (const value of [audit, diff, getRuleDefinitions, migrateSnapshot, planScan, renderReport, scan, createFileCheckpointStore, loadConfig, readSnapshot, writeReport, writeSnapshot]) {
      if (typeof value !== "function") throw new Error("packed export is not callable");
    }
  `);
  await run(process.execPath, [join(temporaryRoot, "smoke.mjs")], temporaryRoot);

  await writeFile(join(temporaryRoot, "smoke.ts"), `
    import { type ScanConfigInput, type ScanPlan, planScan, scan } from "@seo-crawl-audit/core";
    import { createFileCheckpointStore } from "@seo-crawl-audit/core/node";
    const input: ScanConfigInput = { url: "https://example.com/" };
    const planned: Promise<ScanPlan> = planScan(input);
    void planned.then((plan) => scan(plan, { checkpointStore: createFileCheckpointStore("checkpoint.ndjson") }));
  `);
  await run(process.execPath, [
    resolve(projectRoot, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--skipLibCheck",
    join(temporaryRoot, "smoke.ts"),
  ], temporaryRoot);

  const cliPackage = JSON.parse(await readFile(resolve(projectRoot, "packages/cli/package.json"), "utf8"));
  const { stdout: versionOutput } = await run(process.execPath, [join(temporaryRoot, "node_modules/seo-crawl-audit/bin/seo-audit.js"), "--version"], temporaryRoot);
  assert.equal(versionOutput.trim(), cliPackage.version);
  console.log(`Packed core root/node imports, TypeScript declarations, and CLI ${cliPackage.version} passed.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
