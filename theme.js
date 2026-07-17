(function () {
  const storageKey = 'lotoTheme';
  let saved = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {}
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  function applyTheme(theme) {
    const isLight = theme === 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('theme-light', isLight);
    document.documentElement.classList.toggle('theme-dark', !isLight);
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', isLight ? '#f2f5f8' : '#15171a');
  }

  applyTheme(saved || preferred);

  function updateButton(button) {
    const isLight = document.documentElement.dataset.theme === 'light';
    button.textContent = isLight ? '☀️' : '🌙';
    button.title = isLight ? 'Açık tema etkin, koyu temaya geç' : 'Koyu tema etkin, açık temaya geç';
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
      applyTheme(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {}
      updateButton(button);
    });
    navbar.appendChild(button);
  });
})();
