import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { LOCAL_UI_RUNTIME } from "../packages/cli/dist/local-ui-runtime.js";

test("local UI replaces prior results with pending counters and restores actions for the new run", async () => {
  class Element {
    value = "";
    hidden = false;
    disabled = false;
    style = {};
    attributes = new Map();
    listeners = new Map();
    text = "";
    get textContent() { return this.text; }
    set textContent(value) { this.text = String(value); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
  }
  const elements = new Map([
    "url", "status", "message", "current", "completed", "bar", "start", "cancel",
    "report", "reportPanel", "reportFrame", "errors", "warnings", "info", "profile",
    "pagesLabel", "pages", "concurrency", "delay", "render", "googleCheck", "googleEstimate",
    "metricsMessage", "updateMetrics",
  ].map(id => [id, new Element()]));
  const byId = id => {
    assert.ok(elements.has(id), `unexpected DOM field: ${id}`);
    return elements.get(id);
  };
  const previous = {
    status: "complete", url: "https://example.test/", completed: 4, total: 4,
    startedAt: "previous-run", currentUrl: null, message: "Previous scan complete.",
    reportReady: true, summary: { error: 7, warning: 11, info: 13 },
  };
  byId("metricsMessage").textContent = "Run an SEO scan first.";
  let events;
  const requests = [];
  const startup = vm.runInNewContext(LOCAL_UI_RUNTIME, {
    document: { querySelector: selector => byId(selector.slice(1)) },
    URL,
    window: { confirm: () => { throw new Error("unexpected confirmation"); } },
    EventSource: class {
      constructor(url) { assert.equal(url, "/api/events"); events = this; }
    },
    fetch: async url => {
      requests.push(url);
      assert.equal(url, "/api/state");
      return { json: async () => previous };
    },
  });
  await startup;
  const counts = () => ["errors", "warnings", "info"].map(id => byId(id).textContent);
  assert.deepEqual(requests, ["/api/state"]);
  assert.deepEqual(counts(), ["7", "11", "13"]);
  assert.equal(byId("reportPanel").hidden, false);
  assert.equal(byId("metricsMessage").textContent, "Ready to update metrics from the saved scan.");

  const emit = state => events.onmessage({ data: JSON.stringify(state) });
  const current = { ...previous, startedAt: "current-run", completed: 0, total: 3, reportReady: false, summary: null };
  emit({ ...current, status: "planning" });
  assert.deepEqual(counts(), ["—", "—", "—"], "planning must not retain the previous run's findings");
  assert.equal(byId("start").disabled, true);
  assert.equal(byId("start").getAttribute("aria-busy"), "true");
  assert.equal(byId("cancel").hidden, false);
  assert.equal(byId("cancel").disabled, false);
  assert.equal(byId("reportPanel").hidden, true);
  assert.equal(byId("status").getAttribute("data-state"), "planning");

  emit({ ...current, status: "scanning", completed: 1 });
  assert.deepEqual(counts(), ["—", "—", "—"]);
  assert.equal(byId("start").textContent, "Scanning…");
  assert.equal(byId("completed").textContent, "1 / 3");

  emit({ ...current, status: "complete", completed: 3, reportReady: true, summary: { error: 2, warning: 3, info: 4 } });
  assert.deepEqual(counts(), ["2", "3", "4"]);
  assert.equal(byId("start").textContent, "Start SEO scan");
  assert.equal(byId("start").disabled, false);
  assert.equal(byId("start").getAttribute("aria-busy"), "false");
  assert.equal(byId("cancel").hidden, true);
  assert.equal(byId("cancel").disabled, true);
  assert.equal(byId("reportPanel").hidden, false);
  assert.equal(byId("reportFrame").src, "/report?embed=1&v=current-run");
  assert.equal(byId("bar").style.width, "100%");

  emit({ ...current, status: "idle", completed: 0, total: 0 });
  assert.deepEqual(counts(), ["0", "0", "0"]);
  assert.equal(byId("cancel").hidden, true);
});
