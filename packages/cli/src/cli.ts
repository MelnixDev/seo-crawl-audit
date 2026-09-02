import { ENGINE_VERSION } from "@seo-crawl-audit/core";
import { loadConfig } from "@seo-crawl-audit/core/node";
import { parseCliArgs, withFileConfig } from "./args.js";
import { checkCommand, compareCommand, historyCommand, reportCommand, scanCommand } from "./commands.js";
import { initCommand } from "./init.js";
import { doctorCommand } from "./doctor.js";

export { parseScanMenuSelection } from "./ui.js";

const HELP = `seo-audit ${ENGINE_VERSION}

Local-first SEO crawler, audit, and regression checker.

Usage:
  seo-audit <url> [options]
  seo-audit scan <url> [options]
  seo-audit check [url] [options]
  seo-audit compare --production <url> --preview <url> [options]
  seo-audit history [url] [options]
  seo-audit report [baseline] [options]
  seo-audit init [url] [options]
  seo-audit doctor [url] [options]

Commands:
  <url>   Shortcut for scan.
  scan    Crawl a site and save its SEO baseline.
  check   Crawl again and compare with a saved baseline.
  compare Compare a production site with a preview deployment.
  history View local scan trends or compare two saved history snapshots.
  report  Generate HTML from an existing baseline without crawling.
  init    Create a safe local config and optional GitHub workflow.
  doctor  Diagnose runtime, config, storage, and site connectivity.

Options:
  --baseline <file>       Baseline file for check (default: .seo-audit.json)
  --config <file>         Configuration file (default: seo-audit.config.json)
  --output <file>         Output file for scan (default: .seo-audit.json)
  --report <file>         HTML report path (default: seo-audit-report.html)
  --no-report             Do not generate the automatic HTML report
  --no-cache              Disable scan checkpoint caching and resume
  --pages <number>        Scan an exact number of pages
  --all                   Scan every URL found in the sitemap
  --max-pages <number>    Deprecated alias for --pages
  --concurrency <number>  Concurrent requests (default: 5)
  --delay <ms>            Delay between request starts (default: 100)
  --timeout <ms>          Request timeout in milliseconds (default: 10000)
  --sitemap <url>         Seed the crawl from a sitemap or sitemap index
  --no-sitemap            Skip sitemap discovery and crawl internal links
  --include-query         Treat query-string URLs as separate pages
  --ignore-robots         Crawl URLs disallowed by robots.txt
  --strict                Fail check on warnings as well as errors
  --headers-env <name>    Read target request headers from a JSON environment variable
  --production <url>      Production URL for compare
  --preview <url>         Preview deployment URL for compare
  --production-headers-env <name>
                           Read production request headers from a JSON environment variable
  --preview-headers-env <name>
                           Read preview request headers from a JSON environment variable
  --history-dir <path>     Local snapshot history directory
  --no-history            Do not save this scan to local history
  --from <snapshot>        Older history snapshot for an explicit comparison
  --to <snapshot>          Newer history snapshot for an explicit comparison
  --directory <path>       Project directory for init or doctor
  --workflow <mode>        Init workflow: none, manual, scheduled, or pull-request
  --yes                    Accept safe init defaults without prompting
  --force                  Allow init to replace existing generated files
  --offline                Skip doctor network checks
  --json                  Print machine-readable command output
  --help                  Show this help
  --version               Show the version

Exit codes:
  0    No blocking regressions
  1    SEO regressions detected
  2    Invalid input or crawler failure
  130  Scan interrupted after saving partial results
`;

export interface MainOptions {
  signal?: AbortSignal;
}

export async function main(
  args = process.argv.slice(2),
  options: MainOptions = {},
): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }

  let { values } = parsed;
  const { positionals } = parsed;
  if (positionals[0] === "init") {
    if (values.help) {
      console.log(HELP);
      return 0;
    }
    if (values.version) {
      console.log(ENGINE_VERSION);
      return 0;
    }
    if (positionals.length > 2) {
      console.error(`Unexpected argument: ${positionals[2]}`);
      return 2;
    }
    try {
      return await initCommand(positionals[1], values);
    } catch (error) {
      console.error(`seo-audit: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }
  if (positionals[0] === "doctor") {
    if (positionals.length > 2) {
      console.error(`Unexpected argument: ${positionals[2]}`);
      return 2;
    }
    if (values.help) {
      console.log(HELP);
      return 0;
    }
    if (values.version) {
      console.log(ENGINE_VERSION);
      return 0;
    }
    try {
      return await doctorCommand(positionals[1], values, options.signal);
    } catch (error) {
      console.error(`seo-audit: ${error instanceof Error ? error.message : String(error)}`);
      return options.signal?.aborted ? 130 : 2;
    }
  }
  try {
    values = withFileConfig(values, await loadConfig(values.config));
  } catch (error) {
    console.error(`seo-audit: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (values.version) {
    console.log(ENGINE_VERSION);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return 0;
  }

  let [command, url, ...extra] = positionals;
  if (command && /^https?:\/\//i.test(command)) {
    extra = positionals.slice(1);
    url = command;
    command = "scan";
  }
  if ((command === "scan" || command === "check") && !url && values.__config?.url) {
    url = values.__config.url;
  }
  if (extra.length > 0) {
    console.error(`Unexpected argument: ${extra[0]}`);
    return 2;
  }

  try {
    if (command === "scan") return await scanCommand(url, values, options.signal);
    if (command === "check") return await checkCommand(url, values, options.signal);
    if (command === "compare") return await compareCommand(values, options.signal);
    if (command === "history") return await historyCommand(url, values);
    if (command === "report") return await reportCommand(url, values);
    console.error(`Unknown command: ${String(command)}\n\n${HELP}`);
    return 2;
  } catch (error) {
    console.error(`seo-audit: ${error instanceof Error ? error.message : String(error)}`);
    return options.signal?.aborted ? 130 : 2;
  }
}
