# Agent integration

SEO Crawl Audit includes a local Model Context Protocol (MCP) server for coding
agents. It uses STDIO only: crawl requests and generated artifacts stay on the
machine running the agent, and no account, telemetry, or hosted API is needed.

## One-command setup

Run this from the project you want the agent to inspect:

```bash
npx seo-crawl-audit agent-init --platform all
```

Use `--platform codex`, `--platform claude`, or `--platform opencode` to set up
one client. The command installs a project skill and writes a client config only
when it does not already exist. Existing files are skipped; use `--force` only
when you intentionally want generated files replaced. Use `--json` in scripts.

The generated project files are:

- Codex/OpenCode: `.agents/skills/seo-crawl-audit/SKILL.md`;
- Claude Code: `.claude/skills/seo-crawl-audit/SKILL.md`;
- Codex config: `.codex/config.toml`;
- Claude config: `.mcp.json`;
- OpenCode config: `opencode.json`.

Restart the client after setup. The MCP command is `npx -y seo-crawl-audit@0.9
mcp`; the published package also exposes the `seo-audit-mcp` executable.

## MCP tools

The server exposes `seo_audit_plan`, `seo_audit_scan`, `seo_audit_check`,
`seo_audit_issues`, `seo_audit_report`, and `seo_audit_rules`. Plan first, keep
the default 100-page limit unless a larger scan is requested, and use the issue
tool's pagination and filters for detailed findings. Scan and check return paths
to local SnapshotV2, HTML report, and (when interrupted) checkpoint artifacts.

All artifact paths are workspace-bound. Robots are respected by default, partial
comparisons are marked incomplete, and request headers are never returned in
tool output. For authenticated sites, pass the name of a JSON environment
variable through the CLI fallback rather than putting secrets in prompts or
configuration files.
