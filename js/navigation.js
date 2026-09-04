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

  if (!currentPassword || !newPassword || !repeatPassword) return showToast("Şifre alanlarının tamamını doldur", true);
  if (newPassword.length < 6) return showToast("Yeni şifre en az 6 karakter olmalı", true);
  if (newPassword !== repeatPassword) return showToast("Yeni şifreler aynı değil", true);
  if (currentPassword === newPassword) return showToast("Yeni şifre mevcut şifreden farklı olmalı", true);

  try {
    if (button) button.disabled = true;
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    const email = userData?.user?.email;
    if (!email) throw new Error("Oturum bilgisi alınamadı");

    const { error: verifyError } = await supabaseClient.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) throw new Error("Mevcut şifre yanlış");

    const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (updateError) throw updateError;

    if (currentInput) currentInput.value = "";
    if (newInput) newInput.value = "";
    if (repeatInput) repeatInput.value = "";
    await logActivity("password_change", "Kullanıcı kendi şifresini değiştirdi", "auth.users", state.currentUser?.authUserId || null);
    showToast("Şifre güncellendi. Yeni şifrenle tekrar giriş yap");
    setTimeout(() => logoutCurrentStaff(), 900);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Şifre değiştirilemedi", true);
  } finally {
    if (button) button.disabled = false;
  }
}
window.changeOwnPassword = changeOwnPassword;

const PWA_BUILD_VERSION = "v3.13.1-MIGRATION-TEST-JWT-13.0";
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

      if (
        scriptUrl.includes("/sw.js")
        || scriptUrl.endsWith("sw.js")
      ) {
        await reg.unregister();
      }
    })
  );
}

async function registerPwaServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  const registration = await navigator.serviceWorker.register(
    "./sw.js?v=13.0",
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

  notice.classList.remove("is-updating");
  notice.innerHTML = `
    <div class="update-notice-text">
      <strong>⚡ Yeni sürüm hazır</strong>
      <span>${escapeHtml(newVersion || "")}</span>
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
        <span>Önbellek temizleniyor ve yeni sürüm hazırlanıyor.</span>
      </div>
    `;

    try {
      await clearGarageStockCaches();
      await unregisterGarageStockWorker();
      localStorage.setItem("stok_app_version", String(newVersion || PWA_BUILD_VERSION));
    } catch (err) {
      console.warn("Güncelleme temizliği yapılamadı:", err);
    }

    const url = new URL(window.location.href);
    url.searchParams.set("v", String(newVersion || Date.now()));
    url.searchParams.set("_update", String(Date.now()));
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
    const remoteVersion = await fetchRemoteAppVersion();
    if (!remoteVersion) return false;

    localStorage.setItem("stok_app_remote_version", remoteVersion);

    if (remoteVersion !== PWA_BUILD_VERSION) {
      showUpdateNotice(remoteVersion);
      return true;
    }

    document.getElementById("updateNotice")?.remove();
    localStorage.setItem("stok_app_version", PWA_BUILD_VERSION);

    if (!silent) {
      showToast(`Uygulama güncel ✅ ${PWA_BUILD_VERSION}`);
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

  supabaseClient
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


