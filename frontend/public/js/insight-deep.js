(function () {
  const iframe = document.getElementById('insightsFrame');
  const spinner = document.getElementById('spinner');

  // Hide spinner when the iframe finishes loading
  iframe.addEventListener('load', () => {
    spinner.classList.add('hidden');
  });

  // Optional: fail-safe timeout if load takes too long
  const TIMEOUT_MS = 20000; // 20s
  setTimeout(() => {
    if (!spinner.classList.contains('hidden')) {
      spinner.innerHTML = `
        <div class="text-center">
          <div class="mb-2">Taking longer than usual...</div>
          <button class="btn btn-sm btn-primary" id="reloadBtn">Reload</button>
        </div>`;
      document.getElementById('reloadBtn')?.addEventListener('click', () => location.reload());
    }
  }, TIMEOUT_MS);
})();
