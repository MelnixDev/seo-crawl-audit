for (const button of document.querySelectorAll('[data-copy-prompt]')) {
  const prompt = document.getElementById(button.dataset.copyPrompt);
  const status = document.getElementById(button.dataset.copyPrompt.replace('-prompt', '-status'));
  if (!prompt || !status) continue;
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt.textContent.trim());
      status.textContent = 'Installation prompt copied. Paste it into your agent.';
    } catch {
      prompt.closest('details').open = true;
      prompt.focus();
      status.textContent = 'Automatic copy is unavailable. Select and copy the prompt below.';
    }
  });
}
