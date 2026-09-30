export const LOCAL_TREND_RUNTIME = String.raw`
(() => {
  const byId = (id) => document.getElementById(id);
  const panel = document.createElement("section");
  panel.className = "trend-panel";
  const heading = document.createElement("h3");
  const description = document.createElement("p");
  description.className = "muted";
  const controls = document.createElement("div");
  controls.className = "trend-controls";
  function select(id, choices) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    const input = document.createElement("select");
    input.id = id;
    for (const [value, text] of choices) { const option = document.createElement("option"); option.value = value; option.textContent = text; input.append(option); }
    label.append(caption, input);
    controls.append(label);
    return { caption, input };
  }
  const range = select("trendRange", [["20", "20"], ["50", "50"], ["100", "100"]]);
  const metric = select("trendMetric", [["error", "Errors"], ["warning", "Warnings"], ["info", "Info"], ["rule", "Rule"], ["template", "Page template"]]);
  const rule = select("trendRule", [["", "Choose rule"]]);
  const template = select("trendTemplate", [["", "Choose template"]]);
  const actions = document.createElement("div"); actions.className = "actions";
  const run = document.createElement("button");
  const cancel = document.createElement("button"); cancel.className = "secondary"; cancel.hidden = true;
  actions.append(run, cancel);
  const status = document.createElement("p"); status.className = "muted"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chart.setAttribute("viewBox", "0 0 680 220"); chart.setAttribute("role", "img"); chart.setAttribute("aria-label", "Local issue trend"); chart.classList.add("trend-chart");
  const legend = document.createElement("p"); legend.className = "muted";
  panel.append(heading, description, controls, actions, status, chart, legend);
  byId("historyPanel").insertBefore(panel, byId("historyPanel").querySelector(".history-controls"));
  const language = () => byId("historyLanguage").value;
  const copy = {
    en: { title: "Local issue trends", description: "Crawler observations from saved runs. Gaps and incomplete coverage are marked; this is not a Google index count or SEO score.", range: "Runs", metric: "Metric", rule: "Rule", template: "Page template", calculate: "Calculate trends", cancel: "Cancel", loading: "Evaluating saved runs", ready: "Select a point to compare it with the preceding run.", empty: "No saved runs for this site.", error: "Trend calculation failed", incomplete: "Dashed segments mean coverage or policy changed; a lower count is not proof of improvement.", chooseRule: "Choose rule", chooseTemplate: "Choose template", errors: "Errors", warnings: "Warnings", info: "Info", ruleMetric: "Rule", templateMetric: "Page template" },
    uk: { title: "Локальні тренди проблем", description: "Спостереження краулера зі збережених запусків. Розриви й неповне охоплення позначено; це не кількість сторінок в індексі Google і не SEO-оцінка.", range: "Запусків", metric: "Показник", rule: "Правило", template: "Шаблон сторінки", calculate: "Побудувати тренди", cancel: "Скасувати", loading: "Аналіз збережених запусків", ready: "Оберіть точку, щоб порівняти її з попереднім запуском.", empty: "Для цього сайту ще немає збережених запусків.", error: "Помилка аналізу тренду", incomplete: "Пунктир означає зміну охоплення або політики; менша кількість не доводить покращення.", chooseRule: "Оберіть правило", chooseTemplate: "Оберіть шаблон", errors: "Помилки", warnings: "Попередження", info: "Інформація", ruleMetric: "Правило", templateMetric: "Шаблон сторінки" },
  };
  const t = () => copy[language()];
  let latest = null;
  let timer = null;
  function translate() {
    const c = t();
    heading.textContent = c.title; description.textContent = c.description;
    range.caption.textContent = c.range; metric.caption.textContent = c.metric; rule.caption.textContent = c.rule; template.caption.textContent = c.template;
    run.textContent = c.calculate; cancel.textContent = c.cancel;
    for (const [index, label] of [c.errors, c.warnings, c.info, c.ruleMetric, c.templateMetric].entries()) metric.input.options[index].textContent = label;
    rule.input.options[0].textContent = c.chooseRule; template.input.options[0].textContent = c.chooseTemplate;
    if (latest) render(latest);
  }
  function updateControls() { rule.input.parentElement.hidden = metric.input.value !== "rule"; template.input.parentElement.hidden = metric.input.value !== "template"; }
  function svg(name, attributes) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  function value(point) {
    if (metric.input.value === "rule") return point.selectedRuleCount ?? 0;
    if (metric.input.value === "template") return point.selectedTemplateCount ?? 0;
    return point.severity[metric.input.value] ?? 0;
  }
  function render(summary) {
    chart.replaceChildren();
    const points = summary.points;
    if (!points.length) { status.textContent = t().empty; return; }
    const maximum = Math.max(1, ...points.map(value));
    const coords = points.map((point, index) => ({ x: 32 + index * 610 / Math.max(1, points.length - 1), y: 186 - value(point) * 150 / maximum }));
    chart.append(svg("line", { x1: 32, y1: 186, x2: 650, y2: 186, stroke: "#cbd5e1" }));
    for (let index = 1; index < points.length; index++) {
      const previous = coords[index - 1], current = coords[index], point = points[index];
      const comparable = point.previousRunId === points[index - 1].runId && point.warnings.length === 0;
      chart.append(svg("line", { x1: previous.x, y1: previous.y, x2: current.x, y2: current.y,
        stroke: comparable ? "#3157d5" : "#f59e0b", "stroke-width": 3, ...(comparable ? {} : { "stroke-dasharray": "7 5" }) }));
    }
    points.forEach((point, index) => {
      const circle = svg("circle", { cx: coords[index].x, cy: coords[index].y, r: 7, fill: point.warnings.length ? "#f59e0b" : "#3157d5", tabindex: 0, role: "button" });
      const title = svg("title", {});
      title.textContent = new Date(point.generatedAt).toLocaleDateString(language() === "uk" ? "uk-UA" : "en-US") + ": " + value(point) + " · " + point.pages + " pages" + (point.warnings.length ? " · " + point.warnings.join(", ") : "");
      circle.append(title);
      const compare = () => { if (!point.previousRunId) return; byId("historyBefore").value = point.previousRunId; byId("historyAfter").value = point.runId; byId("historyCompare").click(); };
      circle.addEventListener("click", compare); circle.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); compare(); } });
      chart.append(circle);
    });
    legend.textContent = t().incomplete;
    status.textContent = t().ready;
    const options = (select, values, first) => { const selected = select.value; select.replaceChildren();
      for (const [value, label] of [["", first], ...values.map((item) => [item, item])]) { const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option); }
      if (values.includes(selected)) select.value = selected;
    };
    options(rule.input, summary.rules, t().chooseRule);
    options(template.input, summary.templates, t().chooseTemplate);
  }
  async function poll() {
    try {
      const state = await fetch("/api/history/trend").then((response) => response.json());
      if (state.status === "running") { status.textContent = t().loading + " · " + state.completed + "/" + state.total; cancel.hidden = false; timer = setTimeout(poll, 350); return; }
      cancel.hidden = true;
      if (state.status === "ready" && state.resultReady) {
        const response = await fetch("/api/history/trend/result");
        if (!response.ok) throw new Error("Could not load trend summary");
        latest = await response.json(); render(latest);
      } else if (state.status === "error") status.textContent = t().error + ": " + (state.message || "unknown error");
      else if (state.status === "cancelled") status.textContent = language() === "uk" ? "Аналіз скасовано." : "Trend calculation cancelled.";
    } catch (error) { status.textContent = t().error + ": " + error.message; }
  }
  async function start() {
    const siteUrl = byId("url").value || undefined;
    try {
      const response = await fetch("/api/history/trend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteUrl, limit: Number(range.input.value),
        ...(metric.input.value === "rule" && rule.input.value ? { ruleId: rule.input.value } : {}),
        ...(metric.input.value === "template" && template.input.value ? { template: template.input.value } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start trend calculation");
      await poll();
    } catch (error) { status.textContent = t().error + ": " + error.message; }
  }
  run.addEventListener("click", start);
  cancel.addEventListener("click", async () => { if (timer) clearTimeout(timer); await fetch("/api/history/trend/cancel", { method: "POST" }); await poll(); });
  metric.input.addEventListener("change", () => { updateControls(); if (latest && metric.input.value !== "rule" && metric.input.value !== "template") render(latest); else if (metric.input.value === "rule" || metric.input.value === "template") start(); });
  rule.input.addEventListener("change", start); template.input.addEventListener("change", start);
  range.input.addEventListener("change", start);
  byId("historyLanguage").addEventListener("change", translate);
  byId("url").addEventListener("change", start);
  translate(); updateControls(); void start();
})();`;
