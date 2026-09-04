import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliValues } from "./args.js";

export type AgentPlatform = "codex" | "claude" | "opencode" | "all";
type AgentFileStatus = "created" | "updated" | "unchanged" | "skipped";
export interface AgentInitResult { directory: string; platform: AgentPlatform; files: Array<{ path: string; status: AgentFileStatus }>; snippets: string[]; }

const SKILL_SOURCE = resolve(fileURLToPath(new URL("../agent-skill/seo-crawl-audit", import.meta.url)));

async function assertProjectPath(directory: string, target: string): Promise<void> {
  const realDirectory = await realpath(directory);
  let current = target;
  while (true) {
    try {
      const realTarget = await realpath(current);
      const rel = relative(realDirectory, realTarget);
      if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        throw new Error(`generated agent path escapes the project through a symlink: ${target}`);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error(`generated agent path escapes the project through an unresolved symlink: ${target}`);
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function platforms(value: string | undefined): AgentPlatform[] {
  const normalized = (value ?? "all").toLowerCase();
  if (normalized === "all") return ["codex", "claude", "opencode"];
  if (["codex", "claude", "opencode"].includes(normalized)) return [normalized as AgentPlatform];
  throw new Error("--platform must be codex, claude, opencode, or all");
}

async function copyIfMissing(source: string, target: string, force: boolean): Promise<{ path: string; status: AgentFileStatus }> {
  let existing: string | null = null;
  try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const content = await readFile(source, "utf8");
  if (existing === content) return { path: target, status: "unchanged" };
  if (existing !== null && !force) return { path: target, status: "skipped" };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path: target, status: existing === null ? "created" : "updated" };
}

async function writeConfigIfMissing(target: string, content: string, force: boolean): Promise<{ path: string; status: AgentFileStatus }> {
  let existing: string | null = null;
  try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing === content) return { path: target, status: "unchanged" };
  if (existing !== null && !force) return { path: target, status: "skipped" };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path: target, status: existing === null ? "created" : "updated" };
}

function codexConfig(): string {
  return `[mcp_servers.seo-crawl-audit]\ncommand = "npx"\nargs = ["-y", "seo-crawl-audit@0.9", "mcp"]\ntool_timeout_sec = 600\n`;
}
function claudeConfig(): string {
  return `${JSON.stringify({ mcpServers: { "seo-crawl-audit": { command: "npx", args: ["-y", "seo-crawl-audit@0.9", "mcp"] } } }, null, 2)}\n`;
}
function opencodeConfig(): string {
  return `${JSON.stringify({ "$schema": "https://opencode.ai/config.json", mcp: { "seo-crawl-audit": { type: "local", command: ["npx", "-y", "seo-crawl-audit@0.9", "mcp"], enabled: true, timeout: 600000 } } }, null, 2)}\n`;
}

export async function initializeAgents(options: { directory?: string | undefined; platform?: string | undefined; force?: boolean | undefined } = {}): Promise<AgentInitResult> {
  const directory = resolve(options.directory ?? process.cwd());
  const selected = platforms(options.platform);
  const files: AgentInitResult["files"] = [];
  const snippets: string[] = [];
  const installedSkills = new Set<string>();

  const targets = new Set<string>();
  for (const platform of selected) {
    targets.add(platform === "claude" ? join(directory, ".claude/skills/seo-crawl-audit/SKILL.md") : join(directory, ".agents/skills/seo-crawl-audit/SKILL.md"));
    targets.add(platform === "codex" ? join(directory, ".codex/config.toml") : platform === "claude" ? join(directory, ".mcp.json") : join(directory, "opencode.json"));
  }
  await Promise.all([...targets].map((target) => assertProjectPath(directory, target)));

  for (const platform of selected) {
    const skillTarget = platform === "claude" ? join(directory, ".claude/skills/seo-crawl-audit/SKILL.md") : join(directory, ".agents/skills/seo-crawl-audit/SKILL.md");
    if (!installedSkills.has(skillTarget)) {
      files.push(await copyIfMissing(join(SKILL_SOURCE, "SKILL.md"), skillTarget, options.force ?? false));
      installedSkills.add(skillTarget);
    }
    const configTarget = platform === "codex" ? join(directory, ".codex/config.toml") : platform === "claude" ? join(directory, ".mcp.json") : join(directory, "opencode.json");
    const content = platform === "codex" ? codexConfig() : platform === "claude" ? claudeConfig() : opencodeConfig();
    const configResult = await writeConfigIfMissing(configTarget, content, options.force ?? false);
    files.push(configResult);
    if (configResult.status === "skipped") snippets.push(`${platform} config snippet:\n${content}`);
  }
  return { directory, platform: options.platform === "all" || !options.platform ? "all" : selected[0]!, files, snippets };
}

export async function agentInitCommand(values: CliValues): Promise<number> {
  const result = await initializeAgents({ directory: values.directory, platform: values.platform, force: values.force });
  if (values.json) { console.log(JSON.stringify({ command: "agent-init", ...result }, null, 2)); return 0; }
  console.log(`Prepared SEO Crawl Audit agent integration in ${result.directory}`);
  for (const file of result.files) console.log(`  ${file.status.padEnd(7)} ${file.path}`);
  for (const snippet of result.snippets) console.log(`\n${snippet}`);
  console.log("Restart the agent client after enabling its project MCP configuration.");
  return 0;
}
