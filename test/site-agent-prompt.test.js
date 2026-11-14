import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parse } from "parse5";

const source = await readFile(new URL("../docs/site/agent-prompt.js", import.meta.url), "utf8");
const html = parse(await readFile(new URL("../docs/site/index.html", import.meta.url), "utf8"));
function byId(node, id) {
  if (node.attrs?.some(attribute => attribute.name === "id" && attribute.value === id)) return node;
  for (const child of node.childNodes ?? []) {
    const match = byId(child, id);
    if (match) return match;
  }
}
const textContent = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(textContent).join("");
const promptElement = byId(html, "agent-prompt-text");
assert.ok(promptElement, "the actual page must include the manually accessible prompt");
const renderedPrompt = textContent(promptElement);


function page(clipboard) {
  const listeners = new Map();
  const button = { hidden: true, addEventListener: (name, listener) => listeners.set(name, listener) };
  const prompt = { textContent: renderedPrompt, focused: false, focus() { this.focused = true; } };
  const preview = { open: false };
  const status = { textContent: "" };
  const elements = new Map([["copy-agent-prompt", button], ["agent-prompt-text", prompt], ["agent-prompt-preview", preview], ["copy-agent-status", status]]);
  vm.runInNewContext(source, { document: { getElementById: id => elements.get(id) }, navigator: clipboard ? { clipboard } : {} });
  assert.equal(button.hidden, false, "button is progressively enabled by the actual script");
  return { prompt, preview, status, click: () => listeners.get("click")() };
}

test("site copy action writes the exact trimmed prompt and announces success", async () => {
  const writes = [];
  const ui = page({ writeText: async value => { writes.push(value); } });
  await ui.click();
  assert.deepEqual(writes, [renderedPrompt.trim()], "copy the whole HTML-decoded displayed prompt");
  assert.ok(writes[0].includes("\n\n"), "preserve paragraph breaks");
  assert.match(writes[0], /<WEBSITE_URL>/, "copy the rendered placeholder, not HTML entities");
  for (const client of ["Codex", "Claude Code", "Claude Desktop"]) assert.ok(writes[0].includes(client));
  assert.match(ui.status.textContent, /Prompt copied/);
  assert.equal(ui.preview.open, false);
  assert.equal(ui.prompt.focused, false);
});

for (const [label, clipboard] of [["clipboard rejection", { writeText: async () => { throw new Error("Permission denied"); } }], ["missing Clipboard API", undefined]]) {
  test(`site copy action preserves manual access after ${label}`, async () => {
    const ui = page(clipboard);
    const original = ui.prompt.textContent;
    await ui.click();
    assert.equal(ui.preview.open, true);
    assert.equal(ui.prompt.focused, true);
    assert.equal(ui.prompt.textContent, original);
    assert.match(ui.status.textContent, /Select and copy the prompt below/);
    assert.doesNotMatch(ui.status.textContent, /Prompt copied/);
  });
}
