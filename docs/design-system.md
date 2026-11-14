# One product, one visual language

The crab product website is the visual reference for the local browser app and
standalone reports. This is a shared design system, not three independently
chosen themes. The website's selected colors and layout remain unchanged.

## Single source

`design/theme.json` defines the fixed product token contract. Run:

```sh
node scripts/generate-design-system.mjs
node scripts/generate-design-system.mjs --check
```

The generator writes private `design-system.ts` modules in core and CLI and the
marked token prefix of `docs/site/site.css`. Runtime modules export
`PRODUCT_THEME_CSS` and `PRODUCT_THEME`; consumers import their own package's
private module. Do not add a core public API export or a cross-package private
import. Website tokens are part of its existing stylesheet, so no extra network
request is introduced. Reports and app pages embed the CSS for offline use.

The check accepts Windows CRLF line endings while comparing all token content
exactly. It rejects altered generated modules, website drift, unsupported keys
and invalid values. Generated outputs stay checked in so builds are reviewable.

## Visual contract

- **Foundation:** navy ink, muted slate, white paper and cool gray wash. Coral
  is the primary product/action accent; orange is its hover/secondary accent.
- **Typography:** Trebuchet MS with Arial/sans-serif fallbacks for body text;
  Arial Rounded MT Bold with Trebuchet/Arial fallbacks for headings. No remote
  font is required. Interface headings scale for useful density instead of
  copying the marketing hero's large size.
- **Surfaces:** neutral borders, white/wash backgrounds and restrained 8/12/14px
  radii. Avoid the former blue floating-card shadow treatment.
- **Controls:** use the darker `controlLine` for interactive field boundaries;
  the lighter `line` is a structural divider. Visible focus uses `focus`.
  Primary coral controls use ink text, never white text.
- **Spacing:** a 4px base, with 8/12/16/24/48px steps. The shared content width is
  1280px, with 48px desktop and 22px small-screen gutters where layout permits.
- **Semantics:** error, warning, info and success retain distinct text/wash
  pairs. Brand coral is not the error color. Charts use the same semantic
  palette and must retain labels so meaning does not rely on color alone.

Stable CSS names use kebab case, such as `--font-body`, `--radius-control` and
`--control-line`; `PRODUCT_THEME` uses camelCase such as `fontBody`,
`radiusControl` and `controlLine`. Legacy report/app variable names may alias
these tokens to preserve existing behavior, but must not redefine the palette.
A user-specified report primary color remains a scoped supported override;
shared readable text and semantic colors still apply.

## Acceptance

The local app, report overview, metrics, pages, issues, history and comparisons
must use the same visual language. Preserve data, filters, keyboard behavior,
accessible names, responsive layouts, reduced-motion behavior and offline
operation. Review actual desktop/mobile renders and update real screenshots;
metadata checks alone do not establish visual acceptance.

Source-level checks enforce normal-text contrast of at least 4.5:1 for core
text/action/semantic pairs and 3:1 for focus/control boundaries. The existing
CLI and MCP bundle budgets remain unchanged; token sharing is not permission
to increase them. Full functional and package checks remain release gates.

## Release acceptance

The approved website is the visual reference. Validate the local app and every offline report view on desktop and mobile, including keyboard focus, semantic states, tables, charts, filters, history/comparisons and empty/error views. Preserve offline behavior and existing public customization. After visual acceptance, replace every README/site screenshot and the video preview with fresh captures of the final interface; do not reuse old-version footage. Verify public media bytes after deployment. Published 0.17.1 remains immutable; changes ship in a subsequent version.
