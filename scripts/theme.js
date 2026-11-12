const THEME_STORAGE_KEY = 'listenbook.theme';
const root = document.documentElement;
const themeToggle = document.getElementById('listenbook-theme-toggle');
const themeIcon = document.getElementById('listenbook-theme-icon');
const themeColor = document.getElementById('listenbook-theme-color');

function updateThemeControls() {
    const dark = root.classList.contains('dark-theme');
    root.dataset.listenbookTheme = dark ? 'dark' : 'light';
    if (themeIcon) themeIcon.textContent = dark ? 'light_mode' : 'dark_mode';
    if (themeToggle) {
        themeToggle.title = dark ? 'Activar modo claro' : 'Activar modo oscuro';
        themeToggle.setAttribute('aria-label', dark ? 'Activar modo claro' : 'Activar modo oscuro');
        themeToggle.setAttribute('aria-pressed', String(dark));
    }
    if (themeColor) themeColor.content = dark ? '#0E1A28' : '#FDFBF7';
    document.dispatchEvent(new CustomEvent('listenbook:themechange', { detail: { dark } }));
}

function setTheme(dark, persist = true) {
    root.classList.toggle('dark-theme', dark);
    if (persist) {
        try { localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light'); } catch (error) { /* storage unavailable */ }
    }
    updateThemeControls();
}

themeToggle?.addEventListener('click', () => {
    setTheme(!root.classList.contains('dark-theme'));
});

updateThemeControls();

