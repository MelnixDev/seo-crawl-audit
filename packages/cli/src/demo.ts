import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CliValues } from "./args.js";
import { compareCommand } from "./commands.js";

const production = "https://store.example/";
const preview = "https://preview.store.example/";

function demoFetch(broken: boolean): typeof globalThis.fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname !== "/" && url.pathname !== "/pricing") {
      return new Response("Missing", { status: 404 });
    }
    const title = url.pathname === "/pricing" ? "Plans and Pricing" : "Welcome to the Demo Store";
    const noindex = broken && url.origin === new URL(preview).origin && url.pathname === "/pricing"
      ? '<meta name="robots" content="noindex">'
      : "";
    return new Response(`<!doctype html>
<html lang="en"><head><title>${title}</title>
<meta name="description" content="Review the website plans and prices in this fictional storefront.">
<link rel="canonical" href="${new URL(url.pathname, production).href}">
${noindex}</head><body><h1>${title}</h1>
<p>Choose a plan for your next project and find the support that fits your team.</p>
<a href="/">Home</a><a href="/pricing">Pricing</a></body></html>`, {
      headers: { "content-type": "text/html" },
    });
  };
}

export async function demoCommand(values: CliValues, signal?: AbortSignal): Promise<number> {
  const directory = values.directory
    ? resolve(values.directory)
    : await mkdtemp(join(tmpdir(), "seo-crawl-audit-demo-"));
  if (values.directory) await mkdir(directory);
  const failingReport = join(directory, "failed.html");
  const passingReport = join(directory, "passed.html");
  const comparison = { production, preview, pages: "2", "no-sitemap": true };
  console.log("SEO Crawl Audit demo • fictional store, two pages, no network requests.");
  console.log("\n1. Preview accidentally adds noindex to /pricing.");
  const failed = await compareCommand({ ...comparison, report: failingReport }, signal, demoFetch(true));
  if (failed === 130) return failed;
  if (failed !== 1) throw new Error("The demo did not detect its expected SEO regression.");

  console.log("\n2. Remove noindex and run the same check again.");
  const passed = await compareCommand({ ...comparison, report: passingReport }, signal, demoFetch(false));
  if (passed === 130) return passed;
  if (passed !== 0) throw new Error("The fixed demo still reports a blocking regression.");

  console.log("\nDemo complete: the first check failed; the fixed preview passed.");
  console.log(`Open the before-and-after reports:\n  ${failingReport}\n  ${passingReport}`);
  if (!values["no-open"] && process.stdout.isTTY) {
    try {
      const { launchDefaultBrowser } = await import("./server.js");
      await launchDefaultBrowser(pathToFileURL(failingReport).href);
    } catch {
      console.error("Open the report manually using the path above.");
    }
  }
  return 0;
}
