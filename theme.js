(function () {
  const storageKey = 'lotoTheme';
  const saved = localStorage.getItem(storageKey);
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = saved || preferred;

  function updateButton(button) {
    const isLight = document.documentElement.dataset.theme === 'light';
    button.textContent = isLight ? 'Koyu' : 'Açık';
    button.title = isLight ? 'Koyu temaya geç' : 'Açık temaya geç';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(isLight));
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    const button = document.createElement('button');
    button.className = 'theme-toggle';
    button.type = 'button';
    updateButton(button);
    button.addEventListener('click', function () {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(storageKey, next);
      updateButton(button);
    });
    navbar.querySelector('.nav-logo')?.insertAdjacentElement('afterend', button);
  });
})();
