import { rename, writeFile } from "node:fs/promises";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export function renderHtmlReport({
  mode,
  startUrl,
  generatedAt,
  pages,
  issues,
  partial = false,
  targetPages = null,
}) {
  const counts = issues.reduce(
    (summary, issue) => {
      summary[issue.severity] = (summary[issue.severity] ?? 0) + 1;
      return summary;
    },
    { error: 0, warning: 0, info: 0 },
  );
  const affectedPages = new Set(issues.map((issue) => issue.url)).size;
  const reportTitle = partial
    ? "Partial SEO scan report"
    : mode === "check"
      ? "SEO regression report"
      : "SEO baseline audit";
  const data = safeJson({ mode, issues });
  const isCheck = mode === "check";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(reportTitle)} · SEO Regression Guard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --surface: #ffffff;
      --surface-muted: #f8fafc;
      --text: #172033;
      --muted: #64748b;
      --line: #dbe2ea;
      --accent: #3157d5;
      --error: #b42318;
      --error-bg: #fff0ee;
      --warning: #9a6700;
      --warning-bg: #fff7d6;
      --info: #175cd3;
      --info-bg: #eef4ff;
      --shadow: 0 12px 36px rgba(31, 42, 68, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1440px, calc(100% - 32px)); margin: 32px auto 64px; }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }
    h1 { margin: 0 0 8px; font-size: clamp(26px, 4vw, 40px); line-height: 1.1; letter-spacing: -0.03em; }
    .eyebrow { color: var(--accent); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .meta { color: var(--muted); overflow-wrap: anywhere; }
    .notice {
      margin: 0 0 20px;
      border: 1px solid #b2ccff;
      border-radius: 12px;
      background: var(--info-bg);
      color: #1849a9;
      padding: 12px 14px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(5, minmax(130px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
      box-shadow: var(--shadow);
    }
    .card strong { display: block; font-size: 28px; line-height: 1.1; }
    .card span { color: var(--muted); }
    .card.error strong { color: var(--error); }
    .card.warning strong { color: var(--warning); }
    .card.info strong { color: var(--info); }
    .panel {
      overflow: hidden;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: var(--shadow);
    }
    .filters {
      display: grid;
      grid-template-columns: minmax(220px, 2fr) minmax(140px, 1fr) minmax(180px, 1fr) minmax(120px, 0.7fr);
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--line);
      background: var(--surface-muted);
    }
    input, select {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--surface);
      color: var(--text);
      padding: 9px 11px;
      font: inherit;
    }
    input:focus, select:focus { outline: 3px solid rgba(49, 87, 213, 0.16); border-color: var(--accent); }
    .result-count { padding: 10px 16px; color: var(--muted); border-bottom: 1px solid var(--line); }
    .results-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
    }
    .pagination { display: flex; align-items: center; gap: 10px; }
    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      padding: 6px 10px;
      font: inherit;
      cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    button:disabled { cursor: not-allowed; opacity: 0.45; }
    .guide {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      padding: 10px 16px;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
      font-size: 13px;
    }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 1040px; }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 11px 12px;
      background: var(--surface-muted);
      color: var(--muted);
      font-size: 12px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    td { padding: 13px 12px; border-top: 1px solid var(--line); vertical-align: top; }
    tbody tr:hover { background: #fafbff; }
    .badge {
      display: inline-flex;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge.error { color: var(--error); background: var(--error-bg); }
    .badge.warning { color: var(--warning); background: var(--warning-bg); }
    .badge.info { color: var(--info); background: var(--info-bg); }
    a { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
    a:hover { text-decoration: underline; }
    code {
      display: block;
      max-width: 300px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      color: #344054;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .empty { display: none; padding: 48px 20px; color: var(--muted); text-align: center; }
    footer { margin-top: 18px; color: var(--muted); text-align: center; }
    @media (max-width: 900px) {
      main { width: min(100% - 20px, 1440px); margin-top: 20px; }
      header { display: block; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      .filters { grid-template-columns: 1fr; }
      .results-bar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow">SEO Regression Guard</div>
        <h1>${escapeHtml(reportTitle)}</h1>
        <div class="meta">${escapeHtml(startUrl)}</div>
      </div>
      <div class="meta">Generated ${escapeHtml(generatedAt)}</div>
    </header>

    ${partial ? `<div class="notice"><strong>Partial results.</strong> This report contains the pages saved so far. Run the same scan command again to resume without requesting them twice.</div>` : ""}

    <section class="cards" aria-label="Report summary">
      <div class="card"><strong>${pages.length.toLocaleString("en-US")}${targetPages ? ` / ${targetPages.toLocaleString("en-US")}` : ""}</strong><span>Pages checked</span></div>
      <div class="card error"><strong>${counts.error}</strong><span>Errors</span></div>
      <div class="card warning"><strong>${counts.warning}</strong><span>Warnings</span></div>
      <div class="card info"><strong>${counts.info}</strong><span>Info</span></div>
      <div class="card"><strong>${affectedPages.toLocaleString("en-US")}</strong><span>Affected pages</span></div>
    </section>

    <section class="panel">
      <div class="filters">
        <label>
          <span class="meta">Search</span>
          <input id="search" type="search" placeholder="URL, check, or message">
        </label>
        <label>
          <span class="meta">Severity</span>
          <select id="severity">
            <option value="">All severities</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label>
          <span class="meta">Check</span>
          <select id="rule"><option value="">All checks</option></select>
        </label>
        <label>
          <span class="meta">Rows</span>
          <select id="page-size">
            <option value="100">100 per page</option>
            <option value="250">250 per page</option>
            <option value="500">500 per page</option>
          </select>
        </label>
      </div>
      <div class="guide">
        <span><strong>Errors</strong> need attention first.</span>
        <span><strong>Warnings</strong> are important SEO improvements.</span>
        <span><strong>Info</strong> is useful context.</span>
      </div>
      <div class="results-bar">
        <span id="result-count"></span>
        <div class="pagination">
          <button id="previous" type="button">Previous</button>
          <span id="page-info"></span>
          <button id="next" type="button">Next</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Check</th>
              <th>Page</th>
              <th>${isCheck ? "Change" : "What was found"}</th>
              ${isCheck ? "<th>Before</th><th>After</th>" : "<th>Observed value</th>"}
            </tr>
          </thead>
          <tbody id="issues"></tbody>
        </table>
      </div>
      <div id="empty" class="empty">No issues match the selected filters.</div>
    </section>
    <footer>Generated locally. No report data was uploaded.</footer>
  </main>

  <script>
    const report = ${data};
    const search = document.querySelector("#search");
    const severity = document.querySelector("#severity");
    const rule = document.querySelector("#rule");
    const pageSize = document.querySelector("#page-size");
    const tbody = document.querySelector("#issues");
    const empty = document.querySelector("#empty");
    const resultCount = document.querySelector("#result-count");
    const previous = document.querySelector("#previous");
    const next = document.querySelector("#next");
    const pageInfo = document.querySelector("#page-info");
    let currentPage = 1;

    const rules = [...new Set(report.issues.map((issue) => issue.rule))].sort();
    for (const value of rules) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = ruleLabel(value);
      rule.append(option);
    }

    function valueText(value) {
      if (value === undefined) return "—";
      if (value === null || value === "") return "Not present";
      return typeof value === "string" ? value : JSON.stringify(value);
    }

    function ruleLabel(value) {
      const text = value.replaceAll("-", " ");
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function cell(row, value, className) {
      const element = document.createElement("td");
      if (className) element.className = className;
      element.textContent = value;
      row.append(element);
      return element;
    }

    function render() {
      const query = search.value.trim().toLowerCase();
      const selectedSeverity = severity.value;
      const selectedRule = rule.value;
      const filtered = report.issues.filter((issue) => {
        if (selectedSeverity && issue.severity !== selectedSeverity) return false;
        if (selectedRule && issue.rule !== selectedRule) return false;
        if (!query) return true;
        return [issue.url, issue.rule, issue.message, valueText(issue.before), valueText(issue.after)]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });

      const rowsPerPage = Number(pageSize.value);
      const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
      currentPage = Math.min(currentPage, pageCount);
      const firstIndex = (currentPage - 1) * rowsPerPage;
      const visible = filtered.slice(firstIndex, firstIndex + rowsPerPage);

      tbody.replaceChildren();
      for (const issue of visible) {
        const row = document.createElement("tr");

        const severityCell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "badge " + issue.severity;
        badge.textContent = issue.severity;
        severityCell.append(badge);
        row.append(severityCell);

        cell(row, ruleLabel(issue.rule));

        const pageCell = document.createElement("td");
        const link = document.createElement("a");
        link.href = issue.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = issue.url;
        pageCell.append(link);
        row.append(pageCell);

        cell(row, issue.message);

        if (report.mode === "check") {
          const beforeCell = document.createElement("td");
          const beforeCode = document.createElement("code");
          beforeCode.textContent = valueText(issue.before);
          beforeCell.append(beforeCode);
          row.append(beforeCell);
        }

        const afterCell = document.createElement("td");
        const afterCode = document.createElement("code");
        afterCode.textContent = valueText(issue.after);
        afterCell.append(afterCode);
        row.append(afterCell);

        tbody.append(row);
      }

      resultCount.textContent = filtered.length.toLocaleString() + " of " + report.issues.length.toLocaleString() + " issue(s)";
      pageInfo.textContent = "Page " + currentPage.toLocaleString() + " of " + pageCount.toLocaleString();
      previous.disabled = currentPage === 1;
      next.disabled = currentPage === pageCount;
      empty.style.display = filtered.length === 0 ? "block" : "none";
    }

    for (const element of [search, severity, rule, pageSize]) {
      const update = () => {
        currentPage = 1;
        render();
      };
      element.addEventListener("input", update);
      element.addEventListener("change", update);
    }
    previous.addEventListener("click", () => {
      currentPage -= 1;
      render();
    });
    next.addEventListener("click", () => {
      currentPage += 1;
      render();
    });
    render();
  </script>
</body>
</html>
`;
}

export async function writeHtmlReport(path, data) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, renderHtmlReport(data), "utf8");
  await rename(temporaryPath, path);
}
