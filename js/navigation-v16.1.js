// Navigasyon, şifre değişimi, güncelleme ve realtime olayları
function switchTab(tab) {
  const staff = currentStaff();
  if (!canAccessTab(tab, staff.role)) {
    showToast(`${roleLabel(staff.role)} yetkisi bu sayfayı açamaz`, true);
    tab = ROLE_DEFAULT_TAB[staff.role] || "operation";
  }
  state.activeTab = tab;
  ["search", "add", "requests", "operation", "movements", "sale", "reports", "critical", "categoryValues", "orderSuggestion", "purchaseOrders", "surveys", "management", "notifications", "history", "users", "settings", "logs"].forEach((key) => {
    const page = document.getElementById("page-" + key);
    const nav = document.getElementById("nav-" + key);
    if (page) page.classList.add("hidden");
    if (nav) nav.classList.remove("active");
  });
  const activePage = document.getElementById("page-" + tab);
  const activeNav = document.getElementById("nav-" + tab);
  if (activePage) activePage.classList.remove("hidden");
  if (activeNav) activeNav.classList.add("active");

  const activeSectionLabel = document.getElementById("activeSectionLabel");
  if (activeSectionLabel) {
    const rawLabel = String(activeNav?.textContent || tab || "İşlem")
      .replace(/\d+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    activeSectionLabel.textContent = rawLabel || "İşlem";
  }

  if (activePage) {
    activePage.classList.remove("flow-page-enter");
    void activePage.offsetWidth;
    activePage.classList.add("flow-page-enter");
  }

  // Geniş içerikten kalan yatay body scroll sabit GarageFlow menüsünü bozmasın.
  document.documentElement.scrollLeft = 0;
  document.body.scrollLeft = 0;
  updateStaffMeta(staff.name, { lastSeenAt: new Date().toISOString(), role: staff.role });
  renderUsersList();
if (tab === "operation") {
  loadOperationFilterOptions().catch(err => console.warn("İşlem filtreleri alınamadı:", err?.message || err));
  refreshOperationFilters();
  if (el.operationResultBox && !(el.operationBrandFilter?.value || el.operationCategoryFilter?.value || String(el.operationSearchInput?.value || "").trim())) {
    state.operationResults = [];
    el.operationResultBox.innerHTML = `<div class="empty-state">Filtre seç veya en az 2 karakter ürün ara</div>`;
  } else {
    renderOperationResults();
  }
}
if (["add", "management"].includes(tab) && !state.products.length) { loadProducts().catch(err => showToast(err.message || "Ürünler yüklenemedi", true)); }
if (tab === "add" && typeof loadMigrationExcelFilterOptions === "function") {
  loadMigrationExcelFilterOptions().catch(err =>
    showToast(err?.message || "Excel filtreleri alınamadı", true)
  );
}
if (tab === "management") {
  const ready = state.products.length ? Promise.resolve() : loadProducts();
  ready.then(() => { renderCategoryBrandManagement(); loadDeleteMarkedCount(); }).catch(err => showToast(err.message || "Yönetim verileri yüklenemedi", true));
}
if (tab === "sale") {
  renderSaleFavorites();
  renderSaleProducts();
  renderSaleCart();
  renderSaleDashboard();
}
if (tab === "requests") { clearNewRequestAlert(); loadStockRequests(); }
if (tab === "reports") renderReports();
if (tab === "critical") loadCriticalStock().catch(err => showToast(err.message || "Kritik stok alınamadı", true));
if (tab === "categoryValues") loadCategoryValues().catch(err => showToast(err.message || "Kategori değerleri alınamadı", true));
if (tab === "orderSuggestion") loadOrderSuggestions().catch(err => showToast(err.message || "Sipariş önerisi alınamadı", true));
if (tab === "purchaseOrders") { loadSharedPurchaseOrderDraft(); loadPurchaseOrders(); subscribeSharedPurchaseOrderDraft(); }
if (tab === "surveys") loadCustomerSurveyStats();
if (tab === "management") loadDeleteMarkedCount();
if (tab === "notifications") { loadNotifications(); }
if (tab === "history") renderPlateHistory();
if (tab === "users") { if (!state.products.length) loadProducts().then(renderUserCategoryPermissions).catch(() => renderUserCategoryPermissions()); renderUsersList(); renderRolePermissionEditor(); renderUserCategoryPermissions(); }
if (tab === "settings") initializeStockTheme();
if (tab === "logs") { loadActivityLogs(); }
}
window.switchTab = switchTab;
async function changeOwnPassword() {
  const currentInput = document.getElementById("currentPasswordInput");
  const newInput = document.getElementById("newPasswordInput");
  const repeatInput = document.getElementById("repeatPasswordInput");
  const button = document.getElementById("changePasswordBtn");

  const currentPassword = String(currentInput?.value || "");
  const newPassword = String(newInput?.value || "");
  const repeatPassword = String(repeatInput?.value || "");

  if (!currentPassword || !newPassword || !repeatPassword) {
    return showToast("Şifre alanlarının tamamını doldur", true);
  }
  if (newPassword.length < 4) {
    return showToast("Yeni şifre en az 4 karakter olmalı", true);
  }
  if (newPassword.length > 128) {
    return showToast("Yeni şifre çok uzun", true);
  }
  if (newPassword !== repeatPassword) {
    return showToast("Yeni şifreler aynı değil", true);
  }
  if (currentPassword === newPassword) {
    return showToast("Yeni şifre mevcut şifreden farklı olmalı", true);
  }

  try {
    if (button) button.disabled = true;
    setLoading(true);

    await apiFetch("/api/auth/change-password", {
      method: "POST",
      body: {
        current_password: currentPassword,
        new_password: newPassword
      }
    });

    if (currentInput) currentInput.value = "";
    if (newInput) newInput.value = "";
    if (repeatInput) repeatInput.value = "";

    await logActivity(
      "password_change",
      "Kullanıcı kendi GarageFlow şifresini değiştirdi",
      "app_users",
      null
    ).catch(() => {});

    showToast("Şifre güncellendi ✅ Yeni şifrenle tekrar giriş yap");

    setTimeout(() => {
      logoutCurrentUser().catch(() => {
        setMigrationToken("");
        state.currentUser = null;
        showLogin();
      });
    }, 900);
  } catch (err) {
    console.error(err);
    showToast(err?.message || "Şifre değiştirilemedi", true);
  } finally {
    setLoading(false);
    if (button) button.disabled = false;
  }
}
window.changeOwnPassword = changeOwnPassword;

const PWA_BUILD_VERSION = String(
  window.GARAGE_BUILD_VERSION
  || document.querySelector('meta[name="garage-build-version"]')?.getAttribute('content')
  || APP_VERSION
).trim();
let deferredPwaInstallPrompt = null;
let pwaUpdateCheckRunning = false;

function isStandalonePwa() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator.standalone === true
  );
}

function setPwaInstallButtonVisible(visible) {
  const button = document.getElementById("pwaInstallBtn");
  if (!button) return;
  button.classList.toggle("hidden", !visible || isStandalonePwa());
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPwaInstallPrompt = event;
  setPwaInstallButtonVisible(true);
});

window.addEventListener("appinstalled", () => {
  deferredPwaInstallPrompt = null;
  setPwaInstallButtonVisible(false);
  showToast("Garage Stok cihaza yüklendi ✅");
});

async function installPwaApp() {
  if (isStandalonePwa()) {
    showToast("Uygulama zaten yüklü ✅");
    return;
  }

  if (!deferredPwaInstallPrompt) {
    showToast("Yükleme seçeneği şu an tarayıcı tarafından sunulmuyor.", true);
    return;
  }

  const prompt = deferredPwaInstallPrompt;
  deferredPwaInstallPrompt = null;
  setPwaInstallButtonVisible(false);

  await prompt.prompt();
  const choice = await prompt.userChoice;

  if (choice?.outcome === "accepted") {
    showToast("Uygulama yükleniyor ✅");
  } else {
    showToast("Yükleme iptal edildi");
  }
}
window.installPwaApp = installPwaApp;

async function clearGarageStockCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(key => key.startsWith("garage-stock-"))
      .map(key => caches.delete(key))
  );
}

async function unregisterGarageStockWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations.map(async reg => {
      const scriptUrl =
        reg.active?.scriptURL
        || reg.waiting?.scriptURL
        || reg.installing?.scriptURL
        || "";

      // GarageFlow'un eski worker'ları ve eski Firebase messaging worker'ı
      // güncelleme sırasında aynı origin üzerinde eski asset servis etmesin.
      if (
        scriptUrl.includes("/sw.js")
        || scriptUrl.endsWith("sw.js")
        || scriptUrl.includes("firebase-messaging-sw.js")
      ) {
        try { await reg.unregister(); } catch {}
      }
    })
  );
}

function normalizeBuildVersion(value) {
  const raw = String(value || "").replace(/\s+/g, "").trim();
  // Eski build adlandırması gelirse yalnızca gerçek migration sürümünü karşılaştır.
  // Örn: v3.13.1-MIGRATION-TEST-JWT-16.0 -> 16.0
  const legacy = raw.match(/MIGRATION-TEST-JWT-([0-9]+(?:\.[0-9]+)*)$/i);
  return legacy ? legacy[1] : raw.replace(/^v(?=\d)/i, "");
}

async function hardLoadFreshBuild(targetVersion) {
  const cleanTarget = normalizeBuildVersion(targetVersion || PWA_BUILD_VERSION);
  const freshUrl = new URL("./index.html", window.location.href);
  freshUrl.searchParams.set("__garage_build", cleanTarget);
  freshUrl.searchParams.set("__garage_ts", String(Date.now()));

  // Önce gerçek HTML'yi no-store ile kendimiz çekiyoruz. Böylece tarayıcının
  // navigation/HTTP cache'i veya eski worker yeni index.html'i engelleyemiyor.
  const response = await fetch(freshUrl.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`Yeni uygulama dosyası alınamadı (${response.status})`);
  }

  const html = await response.text();

  // Yanlış/stale deploy geldiyse onu çalıştırmak yerine normal hard navigation'a düş.
  if (cleanTarget && !html.includes(cleanTarget)) {
    console.warn("Fresh HTML beklenen build'i içermiyor:", {
      target: cleanTarget
    });
    window.location.replace(freshUrl.toString());
    return;
  }

  try {
    history.replaceState(null, "", freshUrl.pathname + freshUrl.search);
  } catch {}

  // Fresh HTML'yi doğrudan mevcut document'e yazmak browser navigation cache'ini
  // tamamen bypass eder. İçindeki ?v=16.1 asset URL'leri de yeni olduğu için
  // eski JS/CSS tekrar kullanılamaz.
  document.open();
  document.write(html);
  document.close();
}

async function registerPwaServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  const workerUrl = `./sw.js?v=${encodeURIComponent(PWA_BUILD_VERSION)}`;

  const registration = await navigator.serviceWorker.register(
    workerUrl,
    { updateViaCache: "none" }
  );

  try {
    await registration.update();
  } catch (err) {
    console.warn("Service worker update kontrolü yapılamadı:", err);
  }

  return registration;
}
window.registerPwaServiceWorker = registerPwaServiceWorker;

function showUpdateNotice(newVersion) {
  let notice = document.getElementById("updateNotice");

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "updateNotice";
    notice.className = "update-notice";
    document.body.appendChild(notice);
  }

  const remote = normalizeBuildVersion(newVersion);
  const runtime = normalizeBuildVersion(PWA_BUILD_VERSION);

  notice.classList.remove("is-updating");
  notice.innerHTML = `
    <div class="update-notice-text">
      <strong>⚡ Yeni sürüm hazır</strong>
      <span>Çalışan: ${escapeHtml(runtime || "-")} · Sunucu: ${escapeHtml(remote || "-")}</span>
    </div>
    <button type="button" id="updateNowBtn" class="update-now-btn">Güncelle</button>
  `;

  let updateStarted = false;

  const runUpdate = async (event) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (updateStarted) return;
    updateStarted = true;

    notice.classList.add("is-updating");
    notice.innerHTML = `
      <div class="update-notice-text">
        <strong>⚡ Güncelleniyor...</strong>
        <span>Eski worker/cache tamamen bırakılıyor ve yeni build doğrudan alınıyor.</span>
      </div>
    `;

    const targetVersion = remote || runtime;

    try {
      localStorage.setItem("stok_app_update_target", targetVersion);
      await clearGarageStockCaches();
      await unregisterGarageStockWorker();
      localStorage.setItem("stok_app_version", targetVersion);
      await hardLoadFreshBuild(targetVersion);
      return;
    } catch (err) {
      console.warn("Hard update başarısız, URL yenilemeye geçiliyor:", err);
    }

    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("__garage_build", targetVersion);
    url.searchParams.set("__garage_ts", String(Date.now()));
    url.hash = "";
    window.location.replace(url.toString());
  };

  notice.querySelector("#updateNowBtn")
    ?.addEventListener("click", runUpdate, { once: true });

  showToast("Yeni sürüm mevcut ⚡ Güncelle butonuna basabilirsin.");
}

async function fetchRemoteAppVersion() {
  const response = await fetch(
    "./version.json?_=" + Date.now(),
    {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" }
    }
  );

  if (!response.ok) {
    throw new Error(`Sürüm dosyası alınamadı (${response.status})`);
  }

  const data = await response.json();
  return String(data.version || "").trim();
}

async function checkAppVersion({ silent = true } = {}) {
  if (pwaUpdateCheckRunning) return false;
  pwaUpdateCheckRunning = true;

  try {
    const remoteVersion = normalizeBuildVersion(await fetchRemoteAppVersion());
    const runtimeVersion = normalizeBuildVersion(PWA_BUILD_VERSION);
    console.info("[GarageFlow updater]", { runtimeVersion, remoteVersion, source: "navigation-v16.1.js" });
    if (!remoteVersion) return false;

    localStorage.setItem("stok_app_remote_version", remoteVersion);

    if (remoteVersion !== runtimeVersion) {
      console.info("GarageFlow sürüm farkı:", {
        runtime: runtimeVersion,
        remote: remoteVersion
      });
      showUpdateNotice(remoteVersion);
      return true;
    }

    document.getElementById("updateNotice")?.remove();
    localStorage.setItem("stok_app_version", runtimeVersion);
    localStorage.removeItem("stok_app_update_target");

    if (!silent) {
      showToast(`Uygulama güncel ✅ ${runtimeVersion}`);
    }

    return false;

  } catch (err) {
    console.warn("Sürüm kontrolü yapılamadı:", err);

    if (!silent) {
      showToast("Güncelleme kontrolü yapılamadı", true);
    }

    return false;

  } finally {
    pwaUpdateCheckRunning = false;
  }
}

async function forceCheckAppUpdate() {
  const button = document.getElementById("checkUpdateBtn");
  const oldText = button?.textContent;

  if (button) {
    button.disabled = true;
    button.textContent = "Kontrol...";
  }

  try {
    const registration = await registerPwaServiceWorker().catch(() => null);

    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    await checkAppVersion({ silent: false });

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "⚡ Güncelle";
    }
  }
}
window.forceCheckAppUpdate = forceCheckAppUpdate;

function initUpdateChecker() {
  checkAppVersion({ silent: true });

  window.setInterval(
    () => checkAppVersion({ silent: true }),
    60 * 1000
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkAppVersion({ silent: true });
    }
  });

  window.addEventListener("online", () => {
    checkAppVersion({ silent: true });
  });
}

function playNotifySound() { try { const AudioContext = window.AudioContext || window.webkitAudioContext; const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = "sine"; osc.frequency.value = 880; gain.gain.setValueAtTime(0.001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.03); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.5); } catch (e) { console.warn("Ses çalınamadı", e); } }
async function requestNotificationPermission() { if (!("Notification" in window)) { showToast("Bu tarayıcı bildirim desteklemiyor", true); return; } const result = await Notification.requestPermission(); showToast(result === "granted" ? "Bildirim izni açıldı ✅" : "Bildirim izni verilmedi", result !== "granted"); }
async function notifyNewRequest(req) {
  state.newRequestCount += 1;
  state.highlightRequestIds.add(req.id);

  updateNewRequestAlert();
  playNotificationSound();

  const title = "Yeni depo talebi";
  const message = `Plaka: ${req.plate || "-"} · İstenen: ${req.requested_text || "-"}`;

  if (typeof showToast === "function") {
    showToast("Yeni depo talebi geldi ✅");
  }

  await createNotification({
    title,
    message,
    type: "stock_request",
    target_role: "depo",
    source_table: "stock_requests",
    source_id: req.id,
    silent: true
  });

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, {
      body: message,
      tag: "stock-request-" + req.id,
      renotify: true
    });
  }

  setTimeout(() => {
    state.highlightRequestIds.delete(req.id);
    renderStockRequests();
  }, 15000);
}function initRealtimeNotifications() {
  if (state.realtimeReady) return;
  state.realtimeReady = true;

  legacyDisabledClient
    .channel("stock_requests_watch")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "stock_requests" },
      async (payload) => {
        const req = payload.new;
        if (!req || state.seenRequestIds.has(req.id)) return;

        state.seenRequestIds.add(req.id);
        await notifyNewRequest(req);
        await loadStockRequests();
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      async (payload) => {
        const item = payload.new;
        if (!item) return;
        if (!state.notifications.some(n => String(n.id) === String(item.id))) {
          state.notifications.unshift(item);
          state.notifications = state.notifications.slice(0, 120);
          state.unreadNotificationCount = state.notifications.filter(n => !n.is_read).length;
          updateNotificationBadge();
          renderNotifications();
          playNotificationSound();
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "stock_requests" },
      async (payload) => {
        const updatedReq = payload.new;
        if (!updatedReq) return;

        const index = state.stockRequests.findIndex(
          r => String(r.id) === String(updatedReq.id)
        );

        if (index >= 0) {
          state.stockRequests[index] = updatedReq;
        } else {
          state.stockRequests.unshift(updatedReq);
        }

        renderStockRequests();

        if (String(state.selectedStockRequestId) === String(updatedReq.id)) {
          renderSelectedRequestDetail(updatedReq);
          el.productSearchInput.value = updatedReq.requested_text || "";
          searchProductsForRequest(updatedReq.requested_text || "", true);
        }

        showToast("Depo talebi güncellendi ✅");
      }
    )
    .subscribe();
}




// ============================================================
// v15.8 - Kalabalık açıklamaları ! bilgi balonuna çevir
// ============================================================
(function initGarageInfoPopovers() {
  const nodes = [...document.querySelectorAll('.collapsible-info')];
  nodes.forEach((node, index) => {
    if (node.dataset.infoReady === '1') return;
    node.dataset.infoReady = '1';

    const text = String(node.innerText || node.textContent || '').trim();
    if (!text) return;

    node.classList.add('garage-info-source');
    node.setAttribute('aria-hidden', 'true');

    const wrap = document.createElement('span');
    wrap.className = 'garage-info-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'garage-info-btn';
    btn.setAttribute('aria-label', node.dataset.infoTitle || 'Bilgi');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '!';

    const bubble = document.createElement('div');
    bubble.className = 'garage-info-bubble hidden';
    bubble.setAttribute('role', 'status');
    bubble.innerHTML = `<strong>${escapeHtml(node.dataset.infoTitle || 'Bilgi')}</strong><div>${escapeHtml(text).replace(/\n+/g, '<br>')}</div>`;

    let timer = null;
    const close = () => {
      bubble.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const open = () => {
      document.querySelectorAll('.garage-info-bubble:not(.hidden)').forEach(x => x.classList.add('hidden'));
      bubble.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      if (timer) clearTimeout(timer);
      timer = setTimeout(close, 4000);
    };

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (bubble.classList.contains('hidden')) open(); else close();
    });
    wrap.addEventListener('mouseleave', () => { if (!bubble.classList.contains('hidden')) close(); });
    wrap.append(btn, bubble);
    node.parentNode.insertBefore(wrap, node);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.garage-info-wrap')) return;
    document.querySelectorAll('.garage-info-bubble:not(.hidden)').forEach(x => x.classList.add('hidden'));
  });
})();
