import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "examples/quotes-toscrape-report.html");
const outputDirectory = resolve(process.argv[3] ?? "/private/tmp/seo-crawl-audit-screenshots");
const report = await readFile(source, "utf8");

function preparedPage(script) {
  const preparation = `<script>
window.addEventListener("load", () => {
  ${script}
  document.documentElement.dataset.screenshotReady = "true";
});
</script>`;
  return report.replace("</body>", `${preparation}</body>`);
}

const pages = {
  "overview.html": `
    document.querySelector('[data-view="overview"]')?.click();
    window.scrollTo({ top: 0, behavior: "instant" });
  `,
  "metrics.html": `
    document.querySelector('[data-view="metrics"]')?.click();
    window.scrollTo({ top: 0, behavior: "instant" });
  `,
  "analytics.html": `
    document.querySelector('[data-view="overview"]')?.click();
    document.querySelector("#analytics")?.scrollIntoView({ block: "start", behavior: "instant" });
  `,
  "issues.html": `
    document.querySelector('[data-view="issues"]')?.click();
    const severity = document.querySelector("#severity");
    if (severity) {
      severity.value = "error";
      severity.dispatchEvent(new Event("change", { bubbles: true }));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  `,
};

await mkdir(outputDirectory, { recursive: true });
for (const [filename, script] of Object.entries(pages)) {
  await writeFile(resolve(outputDirectory, filename), preparedPage(script), "utf8");
}

console.log(outputDirectory);
