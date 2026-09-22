import type { ComparisonGroup, ComparisonSummaryV1 } from "./local-comparison.js";

const escape = (value: unknown): string => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (en: string, uk: string): string => `<span class="locale-en">${escape(en)}</span><span class="locale-uk">${escape(uk)}</span>`;

function groupRows(groups: readonly ComparisonGroup[], kind: "rule" | "template"): string {
  const sorted = [...groups].sort((left, right) => (right.counts.new + right.counts.resolved + right.counts.ongoing) - (left.counts.new + left.counts.resolved + left.counts.ongoing) || left.id.localeCompare(right.id));
  return sorted.slice(0, 20).map((group) => `<tr><td>${kind === "rule" ? `<button type="button" data-comparison-rule="${escape(group.id)}">${escape(group.id)}</button>` : escape(group.id)}</td><td>${group.counts.new}</td><td>${group.counts.ongoing}</td><td>${group.counts.resolved}</td><td>${group.affectedPages}</td></tr>`).join("")
    + (sorted.length > 20 ? `<tr><td colspan="5">${label(`${sorted.length - 20} more groups in the JSON summary`, `Ще ${sorted.length - 20} груп у JSON-зведенні`)}</td></tr>` : "");
}

export function localComparisonSection(summary: ComparisonSummaryV1): string {
  const coverage = summary.coverage;
  const warnings = summary.warnings.length > 0 ? `<p class="comparison-warning">${label("Comparison warnings", "Застереження порівняння")}: ${escape(summary.warnings.join(", "))}</p>` : "";
  const unverified = summary.unverified.length > 0 ? `<p class="comparison-warning">${summary.unverified.length} ${label("apparent resolutions lack sufficient evidence and are not counted as resolved", "потенційних вирішень не мають достатніх доказів і не враховані як вирішені")}</p>` : "";
  const tableHead = `<thead><tr><th>${label("Group", "Група")}</th><th>${label("New", "Нові")}</th><th>${label("Ongoing", "Тривають")}</th><th>${label("Resolved", "Вирішені")}</th><th>${label("Pages", "Сторінки")}</th></tr></thead>`;
  return `<section id="local-comparison" class="analytics" aria-labelledby="local-comparison-title"><h2 id="local-comparison-title">${label("Local run comparison", "Порівняння локальних запусків")}</h2>
    <div class="comparison-runs"><div><strong>${label("Before", "До")}</strong><time>${escape(summary.from.generatedAt)}</time><span>${summary.from.pages} ${label("checked pages", "перевірених сторінок")}</span></div><div><strong>${label("After", "Після")}</strong><time>${escape(summary.to.generatedAt)}</time><span>${summary.to.pages} ${label("checked pages", "перевірених сторінок")}</span></div></div>
    <p>${label("Coverage", "Охоплення")}: ${coverage.common} ${label("common", "спільних")}, ${coverage.onlyBefore} ${label("only before", "лише до")}, ${coverage.onlyAfter} ${label("only after", "лише після")} · ${coverage.complete ? label("complete", "повне") : label("incomplete", "неповне")}</p>
    <div class="comparison-counts"><div><strong>${summary.lifecycle.new}</strong>${label("New", "Нові")}</div><div><strong>${summary.lifecycle.ongoing}</strong>${label("Ongoing", "Тривають")}</div><div><strong>${summary.lifecycle.resolved}</strong>${label("Resolved on checked pages", "Вирішені на перевірених сторінках")}</div><div><strong>${summary.unverified.length}</strong>${label("Unverified", "Не підтверджено")}</div></div>
    ${warnings}${unverified}
    <div class="comparison-groups"><div><h3>${label("By rule", "За правилом")}</h3><div class="table-wrap"><table>${tableHead}<tbody>${groupRows(summary.byRule, "rule")}</tbody></table></div></div><div><h3>${label("By page template", "За шаблоном сторінки")}</h3><div class="table-wrap"><table>${tableHead}<tbody>${groupRows(summary.byTemplate, "template")}</tbody></table></div></div></div>
    <p class="meta">${label("Findings are re-evaluated with the selected current policy. A lower count is not proof of improvement when coverage differs.", "Проблеми повторно оцінено за політикою вибраного поточного запуску. Менша кількість не доводить покращення, якщо охоплення різниться.")}</p>
  </section>`;
}
