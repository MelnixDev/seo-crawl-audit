import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeAgents } from "../packages/cli/dist/agent-init.js";

test("agent-init prepares Codex, Claude, and OpenCode without replacing config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-agents-"));
  const first = await initializeAgents({ directory, platform: "all" });
  assert.equal(first.files.filter((file) => file.status === "created").length, 5);
  assert.match(await readFile(join(directory, ".agents/skills/seo-crawl-audit/SKILL.md"), "utf8"), /^name: seo-crawl-audit$/m);
  assert.match(await readFile(join(directory, ".claude/skills/seo-crawl-audit/SKILL.md"), "utf8"), /seo_audit_plan/);
  assert.match(await readFile(join(directory, ".codex/config.toml"), "utf8"), /seo-crawl-audit@0\.9/);
  assert.equal(JSON.parse(await readFile(join(directory, ".mcp.json"), "utf8")).mcpServers["seo-crawl-audit"].command, "npx");
  assert.equal(JSON.parse(await readFile(join(directory, "opencode.json"), "utf8")).mcp["seo-crawl-audit"].type, "local");

  await writeFile(join(directory, ".codex/config.toml"), "# keep me\n", "utf8");
  const second = await initializeAgents({ directory, platform: "codex" });
  assert.equal(await readFile(join(directory, ".codex/config.toml"), "utf8"), "# keep me\n");
  assert.equal(second.snippets.length, 1);
  assert.match(second.snippets[0], /mcp_servers\.seo-crawl-audit/);
});

test("agent-init validates platform names", async () => {
  await assert.rejects(initializeAgents({ platform: "unknown" }), /codex, claude, opencode, or all/);
});

test("agent-init refuses project paths redirected by symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-agents-root-"));
  const outside = await mkdtemp(join(tmpdir(), "seo-audit-agents-outside-"));
  await symlink(outside, join(directory, ".codex"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(initializeAgents({ directory, platform: "codex" }), /escapes the project/);
  await assert.rejects(access(join(directory, ".agents/skills/seo-crawl-audit/SKILL.md")));
});
