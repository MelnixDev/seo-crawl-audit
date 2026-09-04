#!/usr/bin/env node

// Keep the repository development entrypoint identical to the packaged CLI.
await import("../packages/cli/bin/seo-audit.js");
