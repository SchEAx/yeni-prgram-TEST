// Uygulama giriş/runtime dosyası. Asıl özellikler ./js klasöründe modüllere ayrıldı.
async function checkVersion() {
  try {
    const runtimeVersion = String(window.GARAGE_BUILD_VERSION || APP_VERSION).trim();
    const localVersion = localStorage.getItem('app_version');
    if (localVersion !== runtimeVersion) {
      localStorage.setItem('app_version', runtimeVersion);
      if ('caches' in window) {
        const names = await caches.keys();
        for (const name of names) {
          await caches.delete(name);
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}

window.addEventListener('offline', () => {
  isOffline = true;
});

window.addEventListener('online', () => {
  isOffline = false;
});

window.addEventListener('error', (e) => {
  console.error('GLOBAL ERROR', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('PROMISE ERROR', e.reason);
});

checkVersion();


// === v3.4 Akıllı Tema Sistemi ===
const STOCK_THEME_KEY = 'garage_stock_theme';
const STOCK_THEME_NAMES = {
  'garage-dark': 'Garage Dark',
  'garage-exclusive': 'Garage Exclusive',
  'midnight-blue': 'Midnight Blue',
  'emerald': 'Emerald',
  'carbon-orange': 'Carbon Orange',
  'light': 'Light'
};

function setStockTheme(themeName, showMessage = true) {
  const safeTheme = STOCK_THEME_NAMES[themeName] ? themeName : 'garage-dark';
  document.documentElement.setAttribute('data-theme', safeTheme);
  try { localStorage.setItem(STOCK_THEME_KEY, safeTheme); } catch (err) { console.warn(err); }

  const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#08101d';
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', themeColor);

  document.querySelectorAll('.theme-option').forEach(btn => {
    const active = btn.dataset.themeValue === safeTheme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const text = document.getElementById('themeCurrentText');
  if (text) text.textContent = `Seçili tema: ${STOCK_THEME_NAMES[safeTheme]}`;
  if (showMessage && typeof showToast === 'function') showToast(`${STOCK_THEME_NAMES[safeTheme]} teması uygulandı ✅`);
}

function initializeStockTheme() {
  let saved = 'garage-dark';
  try { saved = localStorage.getItem(STOCK_THEME_KEY) || 'garage-dark'; } catch (err) { console.warn(err); }
  setStockTheme(saved, false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeStockTheme, { once: true });
} else {
  initializeStockTheme();
}

[el.bulkPriceCategory, el.bulkPriceField, el.bulkPriceMode, el.bulkPriceAmount].filter(Boolean).forEach(node => {
  node.addEventListener("change", updateBulkPricePreview);
  node.addEventListener("input", updateBulkPricePreview);
});
// Migration test: eski veri katmanı auth listener kapalı.
