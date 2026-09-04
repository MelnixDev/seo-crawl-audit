import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliValues } from "./args.js";

export type AgentPlatform = "codex" | "claude" | "opencode" | "all";
export interface AgentInitResult { directory: string; platform: AgentPlatform; files: Array<{ path: string; status: "created" | "skipped" | "updated" }>; snippets: string[]; }

const SKILL_SOURCE = resolve(fileURLToPath(new URL("../agent-skill/seo-crawl-audit", import.meta.url)));

function platforms(value: string | undefined): AgentPlatform[] {
  const normalized = (value ?? "all").toLowerCase();
  if (normalized === "all") return ["codex", "claude", "opencode"];
  if (["codex", "claude", "opencode"].includes(normalized)) return [normalized as AgentPlatform];
  throw new Error("--platform must be codex, claude, opencode, or all");
}

async function copyIfMissing(source: string, target: string, force: boolean): Promise<{ path: string; status: "created" | "skipped" | "updated" }> {
  let existing: string | null = null;
  try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const content = await readFile(source, "utf8");
  if (existing === content) return { path: target, status: "skipped" };
  if (existing !== null && !force) return { path: target, status: "skipped" };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path: target, status: existing === null ? "created" : "updated" };
}

async function writeConfigIfMissing(target: string, content: string, force: boolean): Promise<{ path: string; status: "created" | "skipped" | "updated" }> {
  let existing: string | null = null;
  try { existing = await readFile(target, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing === content) return { path: target, status: "skipped" };
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
  for (const platform of selected) {
    const skillTarget = platform === "claude" ? join(directory, ".claude/skills/seo-crawl-audit/SKILL.md") : join(directory, ".agents/skills/seo-crawl-audit/SKILL.md");
    files.push(await copyIfMissing(join(SKILL_SOURCE, "SKILL.md"), skillTarget, options.force ?? false));
    const configTarget = platform === "codex" ? join(directory, ".codex/config.toml") : platform === "claude" ? join(directory, ".mcp.json") : join(directory, "opencode.json");
    const content = platform === "codex" ? codexConfig() : platform === "claude" ? claudeConfig() : opencodeConfig();
    let exists = true;
    try { await access(configTarget); } catch { exists = false; }
    if (!exists || options.force) files.push(await writeConfigIfMissing(configTarget, content, options.force ?? false));
    else { files.push({ path: configTarget, status: "skipped" }); snippets.push(`${platform} config snippet:\n${content}`); }
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
