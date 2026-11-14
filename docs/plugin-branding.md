# Native plugin artwork

The same reviewed square PNG is packaged with every client distribution and the
npm workflow skill. The source files are
`plugins/seo-crawl-audit/assets/logo.png` and
`packages/cli/agent-skill/seo-crawl-audit/assets/logo.png`; their bytes must match.
The native build copies the workflow skill and its interface metadata into the
plugin, and the archive contract verifies the actual installed artwork bytes.

## Client metadata

- **Codex plugin directory and composer:** root `plugin.json` declares
  `extensions.com.openai.interface.logo`, `composerIcon` and `brandColor`.
- **Codex workflow skill:** `agents/openai.yaml` declares `icon_small`,
  `icon_large` and `brand_color`, with paths relative to the skill directory.
- **Claude Desktop:** the MCPB `manifest.json` declares `icon` relative to its
  extension root.
- **Claude Code:** `.claude-plugin/plugin.json` declares `icon` for Anthropic's
  plugin directory. The official reference explicitly says Claude Code does not
  read this directory-listing field at runtime. Versions before 2.1.281 may warn
  that it is unknown. Its presence does not promise a logo in every local picker.

Existing installations may keep an immutable cached copy. Refresh the local
marketplace and reinstall the updated package before restarting the client.
Do not edit an installed cache to apply branding. Matching packaged paths and
native metadata discovery are verification of configuration, not proof of
actual GUI rendering, directory acceptance or marketplace approval.

## References

- [OpenAI plugin packaging and visual asset paths](https://developers.openai.com/plugins/build/plugins)
- [Claude Code directory-listing fields](https://code.claude.com/docs/en/plugins-reference#directory-listing-fields)
- [MCPB manifest specification](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md)

Production picker icons are the 512px PNG derived from the unchanged master in `docs/brand/logo.png`. The compact opaque 128px JPEG is used only for offline report/UI embedding. Source artwork is not duplicated at full resolution in each native package.
