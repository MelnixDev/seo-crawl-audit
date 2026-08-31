import { readFile } from "node:fs/promises";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`release tag must use vMAJOR.MINOR.PATCH, received: ${tag ?? "nothing"}`);
}

async function manifest(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

const expectedVersion = tag.slice(1);
const manifests = await Promise.all([
  manifest("package.json"),
  manifest("packages/core/package.json"),
  manifest("packages/cli/package.json"),
  manifest("packages/action/package.json"),
]);

for (const value of manifests) {
  if (value.version !== expectedVersion) {
    throw new Error(`${value.name} is ${value.version}; expected ${expectedVersion} from ${tag}`);
  }
}

const [, core, cli, action] = manifests;
if (core.private !== true) throw new Error("the core workspace must remain private");
if (action.private !== true) throw new Error("the Action workspace must remain private");
if (cli.private === true) throw new Error("the CLI workspace must remain publishable");

console.log(`Release ${tag} is consistent; only ${cli.name}@${cli.version} is publishable.`);
