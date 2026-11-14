const button = document.getElementById("copy-agent-prompt");
const prompt = document.getElementById("agent-prompt-text");
const preview = document.getElementById("agent-prompt-preview");
const status = document.getElementById("copy-agent-status");

if (button && prompt && preview && status) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(prompt.textContent.trim());
      status.textContent = "Prompt copied. Paste it into your coding agent to start.";
    } catch {
      preview.open = true;
      prompt.focus();
      status.textContent = "Automatic copy is unavailable. Select and copy the prompt below.";
    }
  });
}
