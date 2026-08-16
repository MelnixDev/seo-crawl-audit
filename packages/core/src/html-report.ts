import { rename, writeFile } from "node:fs/promises";
import type { Issue, ReportBranding } from "./types.js";
import { ENGINE_VERSION, RULE_SET_VERSION } from "./version.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

interface ReportInput {
  mode?: "scan" | "check";
  startUrl?: string;
  generatedAt?: string;
  pages?: Array<{ url: string }>;
  issues?: Partial<Issue>[];
  newIssues?: Partial<Issue>[];
  ongoingIssues?: Partial<Issue>[];
  resolvedIssues?: Partial<Issue>[];
  unchangedIssues?: Partial<Issue>[];
  partial?: boolean;
  targetPages?: number | null;
  engineVersion?: string;
  ruleSetVersion?: string;
  branding?: ReportBranding;
}

function normalizeIssue(candidate: Partial<Issue>, fallbackLifecycle = "current") {
  return {
    fingerprint: candidate.fingerprint ?? "legacy",
    ruleId: candidate.ruleId ?? candidate.rule ?? "unknown",
    rule: candidate.rule ?? candidate.ruleId ?? "unknown",
    severity: candidate.severity ?? "info",
    scope: candidate.scope ?? "page",
    url: candidate.url ?? "",
    message: candidate.message ?? "",
    evidence: candidate.evidence ?? { actual: candidate.after },
    owner: candidate.owner ?? "seo",
    remediation: candidate.remediation ?? "Review the finding and confirm the intended behavior.",
    documentationUrl: candidate.documentationUrl ?? "https://github.com/MelnixDev/seo-crawl-audit/tree/main/docs/rules",
    before: candidate.before,
    after: candidate.after,
    lifecycle: candidate.lifecycle ?? fallbackLifecycle,
  };
}

export function renderHtmlReport(input: ReportInput, options: { branding?: ReportBranding } = {}): string {
  const mode = input.mode ?? "scan";
  const pages = input.pages ?? [];
  const current = (input.issues ?? []).map((item) => normalizeIssue(item));
  const lifecycle = [
    ...(input.newIssues ?? []).map((item) => normalizeIssue(item, "new")),
    ...(input.ongoingIssues ?? []).map((item) => normalizeIssue(item, "ongoing")),
    ...(input.resolvedIssues ?? []).map((item) => normalizeIssue(item, "resolved")),
    ...(input.unchangedIssues ?? []).map((item) => normalizeIssue(item, "unchanged")),
  ];
  const issues = lifecycle.length > 0 ? lifecycle : current;
  const counts = issues.reduce((summary, item) => { summary[item.severity] += 1; return summary; }, { error: 0, warning: 0, info: 0 });
  const affectedPages = new Set(issues.map((item) => item.url)).size;
  const partial = input.partial ?? false;
  const reportTitle = partial ? "Partial SEO scan report" : mode === "check" ? "SEO regression report" : "SEO baseline audit";
  const branding = { ...(input.branding ?? {}), ...(options.branding ?? {}) };
  const primaryColor = /^#[0-9a-f]{6}$/i.test(branding.primaryColor ?? "") ? branding.primaryColor : "#3157d5";
  const logo = branding.logo && (/^data:image\//.test(branding.logo) || /^https:\/\//.test(branding.logo)) ? `<img class="logo" src="${escapeHtml(branding.logo)}" alt="${escapeHtml(branding.agencyName ?? "Report logo")}">` : "";
  const data = safeJson({ mode, issues });
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const startUrl = input.startUrl ?? "";
  const targetPages = input.targetPages ?? null;
  const isCheck = mode === "check";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(reportTitle)} · SEO Crawl Audit</title>
  <style>
    :root { color-scheme: light; --bg:#f5f7fb; --surface:#fff; --muted:#64748b; --text:#172033; --line:#dbe2ea; --accent:${primaryColor}; --error:#b42318; --warning:#9a6700; --info:#175cd3; }
    *{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(1500px,calc(100% - 32px));margin:32px auto 64px}header{display:flex;justify-content:space-between;gap:24px;margin-bottom:22px}.brand{display:flex;align-items:flex-start;gap:14px}.logo{max-width:72px;max-height:52px;object-fit:contain}.eyebrow{color:var(--accent);font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:4px 0 8px;font-size:clamp(27px,4vw,40px);line-height:1.1}.meta{color:var(--muted);overflow-wrap:anywhere}.notice{margin-bottom:18px;padding:12px 14px;border:1px solid #b2ccff;border-radius:12px;background:#eef4ff;color:#1849a9}.cards{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:12px;margin-bottom:18px}.card,.panel{background:var(--surface);border:1px solid var(--line);box-shadow:0 12px 36px rgba(31,42,68,.07)}.card{padding:15px;border-radius:14px}.card strong{display:block;font-size:27px}.card span{color:var(--muted)}.error strong,.badge.error{color:var(--error)}.warning strong,.badge.warning{color:var(--warning)}.info strong,.badge.info{color:var(--info)}.panel{overflow:hidden;border-radius:16px}.tabs{display:flex;gap:6px;padding:12px 16px;border-bottom:1px solid var(--line);overflow:auto}.tabs button[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:#fff}.filters{display:grid;grid-template-columns:minmax(220px,2fr) repeat(4,minmax(125px,1fr));gap:10px;padding:15px;background:#f8fafc;border-bottom:1px solid var(--line)}label span{display:block;margin-bottom:4px}input,select,button{font:inherit}input,select{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text)}button{padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);cursor:pointer}button:disabled{opacity:.45}.guide,.results-bar{display:flex;justify-content:space-between;gap:14px;padding:10px 16px;color:var(--muted);border-bottom:1px solid var(--line)}.actions,.pagination{display:flex;align-items:center;gap:8px}.table-wrap{overflow:auto}table{width:100%;min-width:1260px;border-collapse:collapse}th{position:sticky;top:0;background:#f8fafc;color:var(--muted);font-size:11px;letter-spacing:.05em;text-align:left;text-transform:uppercase}th,td{padding:11px 12px;border-top:1px solid var(--line);vertical-align:top}.badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:#f1f5f9;font-size:11px;font-weight:800;text-transform:uppercase}.badge.resolved{color:#067647;background:#ecfdf3}a{color:var(--accent);text-decoration:none;overflow-wrap:anywhere}code{display:block;max-width:320px;white-space:pre-wrap;overflow-wrap:anywhere;color:#344054;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.remediation{max-width:260px}.fingerprint{font-size:10px;color:var(--muted)}.empty{padding:50px 20px;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--text);font-size:17px}.empty button{margin-top:14px}footer{margin-top:16px;color:var(--muted);text-align:center}
    @media(max-width:950px){main{width:calc(100% - 20px);margin-top:20px}header{display:block}.cards{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:1fr}.results-bar,.guide{align-items:flex-start;flex-direction:column}}
    @media print{body{background:#fff}main{width:100%;margin:0}.filters,.tabs,.actions,.pagination,#clear-filters{display:none!important}.panel,.card{box-shadow:none}.table-wrap{overflow:visible}table{min-width:0;font-size:9px}th{position:static}.remediation,code{max-width:none}a{color:#000}}
  </style>
</head>
<body><main>
  <header><div class="brand">${logo}<div><div class="eyebrow">${escapeHtml(branding.agencyName ?? "SEO Crawl Audit")}</div><h1>${escapeHtml(reportTitle)}</h1><div class="meta">${escapeHtml(startUrl)}</div></div></div><div class="meta">Generated <time id="generated-at" datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time><br>Engine ${escapeHtml(input.engineVersion ?? ENGINE_VERSION)} · Rules ${escapeHtml(input.ruleSetVersion ?? RULE_SET_VERSION)}</div></header>
${partial ? `  <div class="notice"><strong>Partial results.</strong> This report contains the pages saved so far. Run the same scan command again to resume without requesting them twice.</div>` : ""}
  <section class="cards"><div class="card"><strong>${pages.length.toLocaleString("en-US")}${targetPages ? ` / ${targetPages.toLocaleString("en-US")}` : ""}</strong><span>Pages checked</span></div><div class="card error"><strong>${counts.error}</strong><span>Errors</span></div><div class="card warning"><strong>${counts.warning}</strong><span>Warnings</span></div><div class="card info"><strong>${counts.info}</strong><span>Info</span></div><div class="card"><strong>${affectedPages.toLocaleString("en-US")}</strong><span>Affected pages</span></div></section>
  <section class="panel">
    <nav class="tabs" aria-label="Issue lifecycle"><button data-tab="" aria-selected="true">Current / all</button><button data-tab="new">New</button><button data-tab="ongoing">Ongoing</button><button data-tab="resolved">Resolved</button><button data-tab="unchanged">Unchanged</button></nav>
    <div class="filters"><label><span class="meta">URL or text</span><input id="search" type="search" placeholder="URL, check, or message"></label><label><span class="meta">Severity</span><select id="severity"><option value="">All severities</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select></label><label><span class="meta">Check</span><select id="rule"><option value="">All checks</option></select></label><label><span class="meta">Owner</span><select id="owner"><option value="">All owners</option><option value="seo">SEO</option><option value="content">Content</option><option value="developer">Developer</option></select></label><label><span class="meta">Rows</span><select id="page-size"><option value="100">100 per page</option><option value="250">250 per page</option><option value="500">500 per page</option></select></label></div>
    <div class="guide"><span><strong>Errors</strong> need attention first. <strong>Warnings</strong> are important improvements. <strong>Info</strong> is useful context.</span><span>No opaque SEO score is used.</span></div>
    <div class="results-bar"><span id="result-count" aria-live="polite"></span><div class="actions"><button id="export-csv" type="button">Export CSV</button><div id="pagination" class="pagination"><button id="previous" type="button">Previous</button><span id="page-info"></span><button id="next" type="button">Next</button></div></div></div>
    <div id="table-wrap" class="table-wrap"><table><thead><tr><th>Severity</th><th>Lifecycle</th><th>Check / owner</th><th>Page</th><th>${isCheck ? "Change" : "What was found"}</th>${isCheck ? "<th>Before</th>" : ""}<th>Evidence / after</th><th>Remediation</th><th>Fingerprint</th></tr></thead><tbody id="issues"></tbody></table></div>
    <div id="empty" class="empty" hidden><strong id="empty-title">No SEO issues found</strong><span id="empty-message">The scanned pages passed all current checks.</span><button id="clear-filters" type="button">Clear filters</button></div>
  </section><footer>Generated locally. No report data was uploaded.</footer>
</main>
<script>
  const report=${data}; const generatedAt=document.querySelector("#generated-at"); const search=document.querySelector("#search"); const severity=document.querySelector("#severity"); const rule=document.querySelector("#rule"); const owner=document.querySelector("#owner"); const pageSize=document.querySelector("#page-size"); const tbody=document.querySelector("#issues"); const empty=document.querySelector("#empty"); const emptyTitle=document.querySelector("#empty-title"); const emptyMessage=document.querySelector("#empty-message"); const clearFilters=document.querySelector("#clear-filters"); const tableWrap=document.querySelector("#table-wrap"); const resultCount=document.querySelector("#result-count"); const pagination=document.querySelector("#pagination"); const previous=document.querySelector("#previous"); const next=document.querySelector("#next"); const pageInfo=document.querySelector("#page-info"); let currentPage=1; let activeTab=""; let lastFiltered=[];
  const generatedDate=new Date(generatedAt.dateTime); if(!Number.isNaN(generatedDate.getTime())) generatedAt.textContent=new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(generatedDate);
  function valueText(value){if(value===undefined)return "—";if(value===null||value==="")return "Not present";return typeof value==="string"?value:JSON.stringify(value)} function ruleLabel(value){const text=value.replaceAll("-"," ");return text.charAt(0).toUpperCase()+text.slice(1)} function cell(row,value,className){const element=document.createElement("td");if(className)element.className=className;element.textContent=value;row.append(element);return element}
  for(const value of [...new Set(report.issues.map((issue)=>issue.rule))].sort()){const option=document.createElement("option");option.value=value;option.textContent=ruleLabel(value);rule.append(option)}
  function render(){const query=search.value.trim().toLowerCase();lastFiltered=report.issues.filter((issue)=>{if(activeTab&&issue.lifecycle!==activeTab)return false;if(severity.value&&issue.severity!==severity.value)return false;if(rule.value&&issue.rule!==rule.value)return false;if(owner.value&&issue.owner!==owner.value)return false;if(!query)return true;return [issue.url,issue.rule,issue.message,issue.owner,valueText(issue.evidence),valueText(issue.before),valueText(issue.after)].join(" ").toLowerCase().includes(query)});const rowsPerPage=Number(pageSize.value);const pageCount=Math.max(1,Math.ceil(lastFiltered.length/rowsPerPage));currentPage=Math.min(currentPage,pageCount);const visible=lastFiltered.slice((currentPage-1)*rowsPerPage,currentPage*rowsPerPage);tbody.replaceChildren();for(const issue of visible){const row=document.createElement("tr");const severityCell=document.createElement("td");const severityBadge=document.createElement("span");severityBadge.className="badge "+issue.severity;severityBadge.textContent=issue.severity;severityCell.append(severityBadge);row.append(severityCell);const lifeCell=document.createElement("td");const lifeBadge=document.createElement("span");lifeBadge.className="badge "+issue.lifecycle;lifeBadge.textContent=issue.lifecycle;lifeCell.append(lifeBadge);row.append(lifeCell);cell(row,ruleLabel(issue.rule)+" · "+issue.owner);const pageCell=document.createElement("td");const link=document.createElement("a");link.href=issue.url;link.target="_blank";link.rel="noreferrer";link.textContent=issue.url;pageCell.append(link);row.append(pageCell);cell(row,issue.message);if(report.mode==="check"){const beforeCell=document.createElement("td");const code=document.createElement("code");code.textContent=valueText(issue.before);beforeCell.append(code);row.append(beforeCell)}const evidenceCell=document.createElement("td");const evidence=document.createElement("code");evidence.textContent=valueText(issue.after!==undefined?issue.after:issue.evidence);evidenceCell.append(evidence);row.append(evidenceCell);cell(row,issue.remediation,"remediation");const fingerprint=cell(row,issue.fingerprint,"fingerprint");const docs=document.createElement("a");docs.href=issue.documentationUrl;docs.target="_blank";docs.rel="noreferrer";docs.textContent=" docs";fingerprint.append(docs);tbody.append(row)}const issueLabel=report.issues.length === 1 ? "issue" : "issues";resultCount.textContent=lastFiltered.length.toLocaleString()+" of "+report.issues.length.toLocaleString()+" "+issueLabel;pageInfo.textContent="Page "+currentPage+" of "+pageCount;previous.disabled=currentPage===1;next.disabled=currentPage===pageCount;pagination.hidden=lastFiltered.length===0||pageCount===1;tableWrap.hidden=lastFiltered.length===0;empty.hidden=lastFiltered.length!==0;if(lastFiltered.length===0){const reportIsClean=report.issues.length===0;emptyTitle.textContent=reportIsClean?"No SEO issues found":"No matching issues";emptyMessage.textContent=reportIsClean?"The scanned pages passed all current checks.":"Try a different lifecycle tab or clear the selected filters.";clearFilters.hidden=reportIsClean}}
  for(const element of [search,severity,rule,owner,pageSize]){const update=()=>{currentPage=1;render()};element.addEventListener("input",update);element.addEventListener("change",update)}for(const tab of document.querySelectorAll("[data-tab]")){tab.addEventListener("click",()=>{activeTab=tab.dataset.tab;for(const other of document.querySelectorAll("[data-tab]"))other.setAttribute("aria-selected",String(other===tab));currentPage=1;render()})}previous.addEventListener("click",()=>{currentPage-=1;render()});next.addEventListener("click",()=>{currentPage+=1;render()});clearFilters.addEventListener("click",()=>{search.value="";severity.value="";rule.value="";owner.value="";activeTab="";currentPage=1;render()});document.querySelector("#export-csv").addEventListener("click",()=>{const quote=(value)=>'"'+String(value??"").replaceAll('"','""')+'"';const columns=["severity","lifecycle","rule","owner","url","message","before","after","remediation","fingerprint"];const csv=[columns.join(","),...lastFiltered.map((item)=>columns.map((key)=>quote(typeof item[key]==="object"?JSON.stringify(item[key]):item[key])).join(","))].join("\\n");const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));link.download="seo-crawl-audit.csv";link.click();URL.revokeObjectURL(link.href)});render();
</script></body></html>`;
}

export const renderReport = renderHtmlReport;

export async function writeHtmlReport(path: string, data: ReportInput, options: { branding?: ReportBranding } = {}): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, renderHtmlReport(data, options), "utf8");
  await rename(temporaryPath, path);
}
