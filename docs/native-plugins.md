# Native plugins: Codex, Claude Code and Claude Desktop

One package supplies the existing eight-tool STDIO MCP server and the existing
SEO workflow skill. There is no second crawler, service account, hosted API,
runtime npm install, or upload of crawl artifacts. Crawling makes requests to the
selected site; snapshots and reports remain in the configured workspace. Tool
results are compact; issues are paginated (maximum 100 per call), and reports are
returned as artifact paths.

## Build and verify

Use Node >=20.19 and npm. From a clean source checkout:

```sh
npm ci
npm run plugins:test
```

This builds the existing engine first, copies its exact bundled MCP and shared
skill into `plugins/seo-crawl-audit`, validates portable schemas and the official
MCPB manifest, and writes these installable artifacts to `native-plugin-dist/`:

- `seo-crawl-audit-0.16.1-codex-claude-code.zip`
- `seo-crawl-audit-0.16.1-claude-desktop.mcpb`
- one `.sha256` checksum file per archive

Artifacts contain the bundled JavaScript dependencies. Node is supplied by the
local Codex/Claude Code environment, and Claude Desktop supplies Node for its
Node extensions. Optional browser rendering still requires Playwright and
Chromium installed in the **consumer workspace**. There is no automatic browser
download. The launcher changes CWD to the validated workspace before loading the
engine, so consumer Playwright resolution and config discovery use that project.

Do not install from a source checkout until `npm run plugins:build` has generated
its runtime and skill. Git-only distribution of these sources is not a prebuilt
plugin; distribute the ZIP/MCPB artifacts instead. Do not publish generated,
workspace-configured manifests containing a personal absolute directory.

## Codex desktop: configure, then install

Unpack the ZIP to a stable local marketplace directory:

```text
my-seo-marketplace/
  .agents/plugins/marketplace.json
  plugins/seo-crawl-audit/     # ZIP contents go here
```

Configure the unpacked plugin for one existing project directory:

```sh
node /absolute/my-seo-marketplace/plugins/seo-crawl-audit/configure.mjs /absolute/consumer-project
```

Use this marketplace file (paths are relative to `my-seo-marketplace`, **not** the
`.agents/plugins` directory):

```json
{
  "name": "seo-crawl-audit-local",
  "interface": { "displayName": "SEO Crawl Audit" },
  "plugins": [{
    "name": "seo-crawl-audit",
    "source": { "source": "local", "path": "./plugins/seo-crawl-audit" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Developer Tools"
  }]
}
```

Register with `codex plugin marketplace add /absolute/my-seo-marketplace`, restart
the desktop app, select this marketplace in the plugin directory and install SEO
Crawl Audit. For a repository marketplace use that repository as marketplace
root; the checked-in catalog in this source repo is an example. Merge entries
into an existing catalog rather than overwriting unrelated plugins.

Codex's portable plugin CWD defaults to the installation directory, and portable
placeholders only support `PLUGIN_ROOT` and `PLUGIN_DATA`. Therefore this plugin
requires explicit configuration; it deliberately fails before starting MCP if
the workspace is unset. The configure command sets an absolute non-secret root
in the package's `mcp.json`. It never guesses from the installation CWD. Use a
separate configured package and uniquely named repo marketplace per workspace and keep it local. A
configured plugin remains bound to that directory even if a chat opens another
project; verify the configured root before scanning. MCP initialization names the bound root, and Codex tools require a `workspace` argument matching it. A call naming another project (or omitting the workspace) fails schema validation before any crawl or write. The configuration command operates on the unpacked source package before import, never an installed immutable cache; it creates no mutable global last-workspace preference or shared `PLUGIN_DATA` setting.

## Claude Code

Unpack the same ZIP. For a temporary project session:

```sh
cd /absolute/consumer-project
claude --plugin-dir /absolute/unpacked-plugin
```

For a local marketplace, place it at `plugins/seo-crawl-audit` beneath a directory
containing `.claude-plugin/marketplace.json`:

```json
{
  "name": "seo-crawl-audit-local",
  "owner": { "name": "MelnixDev" },
  "plugins": [{ "name": "seo-crawl-audit", "source": "./plugins/seo-crawl-audit" }]
}
```

```sh
claude plugin validate /absolute/marketplace/plugins/seo-crawl-audit
claude plugin validate /absolute/marketplace
claude plugin marketplace add /absolute/marketplace
claude plugin install seo-crawl-audit@seo-crawl-audit-local --scope local
```

The overlay binds the root to Claude Code's documented `CLAUDE_PROJECT_DIR`.
The shared skill appears as `/seo-crawl-audit:seo-crawl-audit`; skills are the
current recommended command mechanism, so no duplicate legacy command is added.
Inspect the eight tools with `/mcp` before the first scan.

## Claude Desktop (chat)

Open the `.mcpb` file in Claude Desktop for macOS or Windows. Review the local
extension and select an **existing audit workspace directory** in its required
configuration picker. Desktop has no project CWD; this directory is the explicit
boundary for configuration, scan files, checkpoints, histories, and reports.
Missing, unresolved, relative, nonexistent, or extension-install-directory roots
fail closed. File paths supplied to tools must be relative to this workspace;
traversal, absolute output paths, and symlinks escaping it are rejected by MCP.

This is an unsigned local build, not an Anthropic directory listing. Desktop
policy may require signed or approved extensions. The bundled skill is available
for inspection but MCPB installs an MCP server, not Claude Code slash commands;
MCP initialization includes the shared plan-first workflow guidance.

## First audit and interpretation

Ask the agent to plan the target site first using `seo_audit_plan`, then scan
with `seo_audit_scan`. The default is 100 pages, respecting robots.txt. Increase
scope only for the user's requested audit; large scans retain the existing
parameter-bound confirmation. Use `seo_audit_issues` with filters/offset/limit,
then `seo_audit_report` for a human-readable file. Interpret `partial`, truncation
and comparison completeness explicitly; do not present incomplete evidence as a
resolved regression. Explain concrete rules and evidence, never an opaque score.

## Updates, pinning and removal

All three manifests and the bundled engine are pinned to the same release
version. Packaging fails if the manifest versions differ from `package.json`.
There is no `npx latest` dependency or silent engine download. For a new release,
bump all manifests (including the plugin's small package.json), rebuild and
validate before distributing the new artifacts and checksums.

- **Codex:** replace the local package with the reviewed release, rerun
  `configure.mjs` for the same workspace, refresh the marketplace and restart.
  Remove/disable through the Plugins UI, then remove its catalog entry if no
  longer needed. Remove only that entry when the catalog contains other plugins.
- **Claude Code:** update the local package, refresh its marketplace with
  `claude plugin marketplace update seo-crawl-audit-local`, then use
  `claude plugin update seo-crawl-audit@seo-crawl-audit-local --scope local`.
  Remove with `claude plugin uninstall seo-crawl-audit@seo-crawl-audit-local --scope local`.
  Local paths loaded in place are not pinned by Claude's version cache; the
  archive checksum and reviewed package determine the installed engine.
- **Claude Desktop:** open the newer reviewed MCPB and retain/reselect the
  workspace when prompted. Disable or uninstall it in Settings > Extensions.
  Local manual bundles do not establish an automatic update feed.

Uninstalling the plugin does not delete user scan/report artifacts. Remove those
from the consumer project separately only when desired. No global plugin,
marketplace, credentials, or client settings are changed by the build/tests.

## Verification limits

`plugins:test` exercises actual JSON-RPC STDIO initialize, eight-tool discovery,
plan, fixture HTTP scan, paginated issues, report generation, traversal/symlink
rejection and workspace configuration/update handling through each manifest's
launch adapter. It verifies artifacts contain the exact existing engine bundle.
These are manifest/package/runtime checks; they do **not** prove interactive
installation in Codex desktop, Claude Code, or Claude Desktop. A release still
needs a clean installation and first audit in each real client on supported
platforms, including optional Playwright on a consumer project if used.

## Primary format references (verified 2026-11-14)

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI local STDIO plugins](https://developers.openai.com/plugins/deploy/desktop-only)
- [Agent Plugins v1 specification](https://agent-plugins.org/specification)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code manifest reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code local marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [MCPB manifest specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)
- [MCPB official CLI](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md)

The vendored Agent Plugins v1 JSON schemas in `scripts/plugin-schemas/` are the
immutable canonical documents linked by their `$id`; validation is offline.
Public OpenAI STDIO directory submission is separately restricted to approved
partners; local marketplace installation does not submit anything publicly.
