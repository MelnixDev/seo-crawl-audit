#!/usr/bin/env node

if (process.argv[2] === "mcp") {
  try {
    const { serve } = await import("../bundle/mcp.js");
    await serve();
  } catch (error) {
    console.error(`seo-audit mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
} else {
  const { main } = await import("../bundle/cli.js");
  const controller = new AbortController();
  let signalCount = 0;

  function handleSignal(signal) {
    signalCount += 1;
    if (signalCount === 1) {
      controller.abort(new Error(`received ${signal}`));
      return;
    }
    process.exit(130);
  }

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  main(process.argv.slice(2), { signal: controller.signal })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`seo-audit: ${error.message}`);
      process.exitCode = controller.signal.aborted ? 130 : 2;
    });
}
