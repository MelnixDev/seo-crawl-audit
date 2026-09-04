import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`release tag must use vMAJOR.MINOR.PATCH, received: ${tag ?? "nothing"}`);
}

const releaseRoot = resolve(process.cwd(), process.argv[3] ?? ".");

async function manifest(path) {
  return JSON.parse(await readFile(resolve(releaseRoot, path), "utf8"));
}

const expectedVersion = tag.slice(1);
const manifests = await Promise.all([
  manifest("package.json"),
  manifest("packages/core/package.json"),
  manifest("packages/cli/package.json"),
  manifest("packages/action/package.json"),
  manifest("packages/mcp/package.json"),
]);

for (const value of manifests) {
  if (value.version !== expectedVersion) {
    throw new Error(`${value.name} is ${value.version}; expected ${expectedVersion} from ${tag}`);
  }
}

const [, core, cli, action, mcp] = manifests;
if (core.private !== true) throw new Error("the core workspace must remain private");
if (action.private !== true) throw new Error("the Action workspace must remain private");
if (mcp.private !== true) throw new Error("the MCP workspace must remain private");
if (cli.private === true) throw new Error("the CLI workspace must remain publishable");

console.log(`Release ${tag} is consistent; only ${cli.name}@${cli.version} is publishable.`);
