#!/usr/bin/env node

import { main } from "../bundle/cli.js";

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(`seo-audit: ${error.message}`);
    process.exitCode = 2;
  });
