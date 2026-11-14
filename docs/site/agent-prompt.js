const button = document.getElementById("copy-agent-prompt");
const prompt = document.getElementById("agent-prompt-text");
const preview = document.getElementById("agent-prompt-preview");
const status = document.getElementById("copy-agent-status");

if (button && prompt && preview && status) {
  const originalLabel = button.textContent;
  let resetTimer;
  let attempt = 0;
  const resetButton = () => {
    clearTimeout(resetTimer);
    button.textContent = originalLabel;
    button.classList.remove("copy-success");
  };
  button.hidden = false;
  button.addEventListener("click", async () => {
    const currentAttempt = ++attempt;
    resetButton();
    try {
      await navigator.clipboard.writeText(prompt.textContent.trim());
      if (currentAttempt !== attempt) return;
      button.textContent = "Copied!";
      button.classList.add("copy-success");
      resetTimer = setTimeout(resetButton, 2500);
      status.textContent = "";
    } catch {
      if (currentAttempt !== attempt) return;
      resetButton();
      preview.open = true;
      prompt.focus();
      status.textContent = "Automatic copy is unavailable. Select and copy the prompt below.";
    }
  });
}
