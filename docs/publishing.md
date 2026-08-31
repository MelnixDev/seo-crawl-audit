# npm trusted publishing

The public `seo-crawl-audit` CLI is published from GitHub Actions through npm
trusted publishing. The workflow uses short-lived OIDC credentials, contains no
`NPM_TOKEN`, and automatically receives npm provenance for the public package.
The core and Action workspaces remain private.

## One-time npm configuration

Open the `seo-crawl-audit` package settings on npm, select GitHub Actions under
Trusted Publisher, and configure:

- organization or user: `MelnixDev`;
- repository: `seo-crawl-audit`;
- workflow filename: `publish.yml`;
- environment: leave empty;
- allowed action: `npm publish`.

The filename is case-sensitive and must be entered without the
`.github/workflows/` prefix. GitHub-hosted runners and the `id-token: write`
permission are required.

## Release sequence

1. Prepare and merge a release PR with synchronized workspace versions,
   bundles, demo, changelog, and release notes.
2. Create an immutable `vMAJOR.MINOR.PATCH` GitHub release tag.
3. The tag starts `publish.yml`, or an existing version tag can be selected
   through the workflow's manual dispatch input.
4. The workflow verifies the tag, installs dependencies without a release
   cache, runs all quality gates, audits production dependencies, confirms that
   generated bundles are committed, and publishes only the CLI workspace.
5. Verify the registry version and a clean `npx` execution.
6. Move the compatible GitHub Action tag `v0` only after verification.

The trigger pattern intentionally excludes the moving `v0` tag, so updating
the Action alias cannot attempt to republish an existing npm version.
