export const LOCAL_HISTORY_RUNTIME = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const copy = {
    en: { title: "History", description: "Compare two saved local runs without crawling pages again.", language: "Language", before: "Before", after: "After", compare: "Compare runs", swap: "Swap runs", cancel: "Cancel comparison", open: "Open full comparison", loading: "Loading local runs…", empty: "No saved runs yet. Complete a scan to build local history.", one: "One saved run found. Complete another scan to compare.", ready: "Select two runs and compare them.", running: "Comparing locally: ", error: "Comparison failed: ", done: "Comparison ready.", incomplete: "Comparison ready, but coverage is incomplete.", invalid: "Choose two different runs.", reversed: "Before must not be newer than After. Swap the runs.", pages: "pages", partial: "partial", new: "New", ongoing: "Ongoing", resolved: "Resolved", unverified: "Unverified" },
    uk: { title: "Історія", description: "Порівняйте два збережені локальні запуски без повторного сканування.", language: "Мова", before: "До", after: "Після", compare: "Порівняти", swap: "Поміняти місцями", cancel: "Скасувати порівняння", open: "Відкрити повне порівняння", loading: "Завантаження локальних запусків…", empty: "Збережених запусків ще немає. Завершіть сканування, щоб створити історію.", one: "Є один збережений запуск. Для порівняння потрібен ще один.", ready: "Виберіть два запуски та порівняйте їх.", running: "Локальне порівняння: ", error: "Помилка порівняння: ", done: "Порівняння готове.", incomplete: "Порівняння готове, але охоплення неповне.", invalid: "Виберіть два різні запуски.", reversed: "Запуск «До» не може бути новішим за «Після». Поміняйте їх місцями.", pages: "сторінок", partial: "частковий", new: "Нові", ongoing: "Тривають", resolved: "Вирішені", unverified: "Не підтверджено" },
  };
  let runs = [];
  let timer = null;
  let lastStatus = "";
  const markdownLink = document.createElement("a");
  markdownLink.href = "/comparison.md";
  markdownLink.hidden = true;
  const csvLink = document.createElement("a");
  csvLink.href = "/comparison.csv";
  csvLink.hidden = true;
  el("historyOpen").parentElement.append(markdownLink, csvLink);
  const lang = () => el("historyLanguage").value;
  const t = () => copy[lang()];
  const status = (message) => { el("historyStatus").textContent = message; };
  function translate() {
    const value = t();
    for (const [id, text] of Object.entries({ historyTitle: value.title, historyDescription: value.description, historyLanguageLabel: value.language, historyBeforeLabel: value.before, historyAfterLabel: value.after, historyCompare: value.compare, historySwap: value.swap, historyCancel: value.cancel, historyOpen: value.open })) el(id).textContent = text;
    markdownLink.textContent = lang() === "uk" ? "Завантажити Markdown" : "Download Markdown";
    csvLink.textContent = lang() === "uk" ? "Завантажити CSV" : "Download CSV";
    if (lastStatus === "ready") status(value.ready);
    if (lastStatus === "empty") status(value.empty);
    if (lastStatus === "one") status(value.one);
  }
  function option(run) {
    const item = document.createElement("option");
    item.value = run.runId;
    const date = new Date(run.generatedAt).toLocaleString(lang() === "uk" ? "uk-UA" : "en-US");
    item.textContent = date + " · " + run.pages + " " + t().pages + (run.partial || run.truncated ? " · " + t().partial : "");
    return item;
  }
  async function loadRuns() {
    status(t().loading);
    try {
      const requestedSite = el("url").value;
      const response = await fetch("/api/history?limit=100" + (requestedSite ? "&siteUrl=" + encodeURIComponent(requestedSite) : ""));
      if (!response.ok) throw new Error("Could not load local runs");
      const data = await response.json();
      const selectedSite = el("url").value || data.runs[0]?.siteUrl;
      runs = data.runs.filter((run) => run.siteUrl === selectedSite);
      const previous = el("historyBefore").value;
      const current = el("historyAfter").value;
      for (const id of ["historyBefore", "historyAfter"]) el(id).replaceChildren(...runs.map(option));
      if (runs.some((run) => run.runId === previous)) el("historyBefore").value = previous;
      else if (runs.length > 1) el("historyBefore").value = runs[1].runId;
      if (runs.some((run) => run.runId === current)) el("historyAfter").value = current;
      el("historyCompare").disabled = runs.length < 2;
      lastStatus = runs.length === 0 ? "empty" : runs.length === 1 ? "one" : "ready";
      translate();
    } catch (error) { status(t().error + error.message); }
  }
  async function refresh() {
    try {
      const response = await fetch("/api/history/comparison");
      const value = await response.json();
      if (value.status === "running") {
        status(t().running + (value.phase || "read"));
        el("historyCancel").hidden = false;
        el("historyCompare").disabled = true;
        timer = setTimeout(refresh, 350);
      } else {
        el("historyCancel").hidden = true;
        el("historyCompare").disabled = runs.length < 2;
        el("historyOpen").hidden = !value.reportReady;
        markdownLink.hidden = !value.reportReady;
        csvLink.hidden = !value.reportReady;
        if (value.reportReady) {
          const result = await fetch("/api/history/comparison/result").then((item) => item.json());
          const summary = result.summary;
          const box = el("historySummary");
          box.replaceChildren();
          const items = [[t().new, summary.lifecycle.new], [t().ongoing, summary.lifecycle.ongoing], [t().resolved, summary.lifecycle.resolved], [t().unverified, summary.unverified.length]];
          for (const [label, count] of items) {
            const cell = document.createElement("div");
            const strong = document.createElement("strong");
            strong.textContent = count;
            cell.append(strong, document.createTextNode(label));
            box.append(cell);
          }
          box.hidden = false;
          el("historyFrame").hidden = false;
          el("historyFrame").src = "/comparison?v=" + encodeURIComponent(value.jobId);
          status(summary.coverage.complete ? t().done : t().incomplete);
        } else if (value.status === "error") status(t().error + (value.message || "unknown error"));
      }
    } catch (error) { status(t().error + error.message); }
  }
  el("historyLanguage").addEventListener("change", () => { translate(); loadRuns(); });
  el("historySwap").addEventListener("click", () => { const before = el("historyBefore"); const after = el("historyAfter"); [before.value, after.value] = [after.value, before.value]; });
  el("historyCompare").addEventListener("click", async () => {
    const fromId = el("historyBefore").value;
    const toId = el("historyAfter").value;
    if (fromId === toId) { status(t().invalid); return; }
    const from = runs.find((run) => run.runId === fromId);
    const to = runs.find((run) => run.runId === toId);
    if (from.generatedAt > to.generatedAt) { status(t().reversed); return; }
    try {
      const response = await fetch("/api/history/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromId, toId }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not start comparison");
      await refresh();
    } catch (error) { status(t().error + error.message); }
  });
  el("historyCancel").addEventListener("click", async () => { if (timer) clearTimeout(timer); await fetch("/api/history/comparison/cancel", { method: "POST" }); await refresh(); });
  el("url").addEventListener("change", loadRuns);
  events.addEventListener("message", (event) => { try { if (JSON.parse(event.data).status === "complete") void loadRuns(); } catch {} });
  translate();
  void loadRuns().then(refresh);
})();`;
