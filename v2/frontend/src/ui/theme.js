const _savedTheme = localStorage.getItem('theme');
export let currentTheme =
  _savedTheme ||
  (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/**
 * 套用主題（light / dark）並儲存到 localStorage。
 * @param {'light'|'dark'} theme
 */
export const applyTheme = (theme) => {
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  const themeIconLight = document.getElementById('theme-icon-light');
  const themeIconDark = document.getElementById('theme-icon-dark');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    document.body.classList.replace('theme-light', 'theme-dark');
    themeIconLight?.classList.add('hidden');
    themeIconDark?.classList.remove('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.replace('theme-dark', 'theme-light');
    themeIconLight?.classList.remove('hidden');
    themeIconDark?.classList.add('hidden');
  }
};
