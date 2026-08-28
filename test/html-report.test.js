import test from "node:test";
import assert from "node:assert/strict";
import { getRuleDefinitions, renderReport as renderHtmlReport } from "../packages/core/dist/index.js";

test("renders a self-contained filterable report and escapes embedded data", () => {
  const html = renderHtmlReport({
    mode: "scan",
    startUrl: "https://example.com/",
    generatedAt: "2026-07-30T00:00:00.000Z",
    pages: [{ url: "https://example.com/" }],
    issues: [
      {
        severity: "warning",
        rule: "missing-description",
        url: "https://example.com/?value=</script><script>alert(1)</script>",
        message: "Missing description",
        before: undefined,
        after: null,
      },
    ],
  });

  assert.match(html, /id="search"/);
  assert.match(html, /id="severity"/);
  assert.match(html, /id="rule"/);
  assert.match(html, /id="page-size"/);
  assert.match(html, /id="previous"/);
  assert.match(html, /id="next"/);
  assert.match(html, /<time id="generated-at" datetime="2026-07-30T00:00:00\.000Z">/);
  assert.match(html, /Intl\.DateTimeFormat/);
  assert.match(html, /id="clear-filters"/);
  assert.match(html, /id="language"/);
  assert.match(html, /id="analytics"/);
  assert.match(html, /id="severity-chart"/);
  assert.match(html, /id="rules-chart"/);
  assert.match(html, /id="distribution-chart"/);
  assert.match(html, /id="templates-chart"/);
  assert.match(html, /id="template"/);
  assert.match(html, /function applyChartFilter/);
  assert.match(html, /data-chart-filter/);
  assert.match(html, /conic-gradient/);
  assert.match(html, /<option value="uk">Українська<\/option>/);
  assert.match(html, /No SEO issues found/);
  assert.match(html, /No matching issues/);
  assert.match(html, /SEO-проблем не знайдено/);
  assert.match(html, /Статистика проблем/);
  assert.match(html, /language\.addEventListener\("change"/);
  assert.match(html, /seo-crawl-audit-"\+locale\+"\.csv/);
  assert.match(html, /SEO baseline audit/);
  assert.doesNotMatch(
    html,
    /<\/script><script>alert\(1\)<\/script>/,
  );
  assert.match(html, /\\u003c\/script\\u003e/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("embeds deterministic interactive chart statistics", () => {
  const issue = (rule, severity, owner, lifecycle, index) => ({
    fingerprint: `chart-${index}`,
    ruleId: rule,
    rule,
    severity,
    scope: "page",
    owner,
    url: `https://example.com/${index}`,
    message: rule,
    evidence: {},
    remediation: "Fix it",
    documentationUrl: "https://example.com/docs",
    lifecycle,
  });
  const html = renderHtmlReport({
    mode: "check",
    pages: [{ url: "https://example.com/" }, { url: "https://example.com/a" }],
    targetPages: 10,
    newIssues: [
      issue("missing-h1", "error", "content", "new", 1),
      issue("missing-h1", "warning", "content", "new", 2),
    ],
    ongoingIssues: [issue("missing-title", "error", "seo", "ongoing", 3)],
    resolvedIssues: [issue("missing-description", "info", "developer", "resolved", 4)],
  });

  const encoded = html.match(/const report=([\s\S]*?);\n  const byId=/)?.[1];
  assert.ok(encoded);
  const report = JSON.parse(encoded);
  assert.deepEqual(report.statistics, {
    total: 4,
    pagesChecked: 2,
    targetPages: 10,
    affectedPages: 4,
    severity: { error: 2, warning: 1, info: 1 },
    rules: [
      { id: "missing-h1", count: 2 },
      { id: "missing-description", count: 1 },
      { id: "missing-title", count: 1 },
    ],
    owners: { content: 2, seo: 1, developer: 1 },
    lifecycle: { new: 2, ongoing: 1, resolved: 1 },
    templates: [{ template: "/:id", issueCount: 4, affectedPages: 4 }],
  });
  assert.match(html, /Select a chart item to filter the issue table/);
  assert.match(html, /Оберіть елемент графіка, щоб відфільтрувати таблицю проблем/);
  assert.match(html, /report\.mode==="check"\?text\.analytics\.lifecycle:text\.analytics\.owners/);
  assert.match(html, /kind==="template"/);
  assert.match(html, /button\.setAttribute\("aria-pressed"/);
});

test("embeds Ukrainian text for every built-in rule without changing issue identity", () => {
  const definitions = getRuleDefinitions();
  const html = renderHtmlReport({
    mode: "scan",
    startUrl: "https://example.com/",
    pages: [{ url: "https://example.com/" }],
    issues: definitions.map((definition, index) => ({
      fingerprint: `stable-${index}`,
      ruleId: definition.id,
      rule: definition.id,
      severity: definition.severity,
      scope: definition.scope,
      owner: definition.owner,
      url: `https://example.com/${index}`,
      message: "English example",
      evidence: { actual: index },
      remediation: definition.remediation,
      documentationUrl: `https://example.com/docs/${definition.id}`,
    })),
  });

  const encoded = html.match(/const report=([\s\S]*?);\n  const byId=/)?.[1];
  assert.ok(encoded);
  const report = JSON.parse(encoded);
  assert.equal(report.issues.length, definitions.length);
  assert.deepEqual(
    report.issues.map((issue) => issue.fingerprint),
    definitions.map((_, index) => `stable-${index}`),
  );
  for (const issue of report.issues) {
    assert.ok(issue.localized.en.rule);
    assert.ok(issue.localized.uk.rule);
    assert.notEqual(issue.localized.uk.message, "English example");
    assert.notEqual(
      issue.localized.uk.remediation,
      "Перевірте проблему та підтвердьте очікувану поведінку.",
    );
  }
  assert.match(html, /Сторінка не містить заголовка H1/);
  assert.match(html, /Додайте один зрозумілий основний заголовок/);
});

test("marks an in-progress scan as partial and shows its target", () => {
  const html = renderHtmlReport({
    mode: "scan",
    startUrl: "https://example.com/",
    generatedAt: "2026-07-30T00:00:00.000Z",
    pages: [{ url: "https://example.com/" }],
    issues: [],
    partial: true,
    targetPages: 100,
  });

  assert.match(html, /Partial SEO scan report/);
  assert.match(html, /Partial results/);
  assert.match(html, /1 \/ 100/);
  assert.match(html, /Run the same scan command again to resume/);
  assert.match(html, /What was found/);
  assert.doesNotMatch(html, /<th>Before<\/th>/);
});

test("labels a coverage-aware partial diff as an incomplete comparison", () => {
  const html = renderHtmlReport({
    mode: "check",
    startUrl: "https://example.com/",
    pages: [{ url: "https://example.com/" }],
    issues: [],
    complete: false,
  });

  assert.match(html, /Incomplete comparison/);
  assert.match(html, /unchecked pages are not marked missing or resolved/);
});
