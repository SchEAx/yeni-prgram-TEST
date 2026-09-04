// Garage İstanbul - Migration Test API overrides
const MIGRATION_TEST_MODE = true;
const MIGRATION_API_BASE = "https://api.scheax.com.tr/migration-test";
const MIGRATION_TOKEN_KEY = "garage_migration_test_jwt_v1";
const MIGRATION_ALLOWED_TABS = new Set(["operation", "movements", "critical", "orderSuggestion", "add", "requests"]);

function migrationToken() {
  try { return localStorage.getItem(MIGRATION_TOKEN_KEY) || ""; } catch { return ""; }
}
function setMigrationToken(token) {
  try {
    if (token) localStorage.setItem(MIGRATION_TOKEN_KEY, token);
    else localStorage.removeItem(MIGRATION_TOKEN_KEY);
  } catch {}
}
async function apiFetch(path, options = {}) {
  const token = migrationToken();
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const bodyIsRaw =
    typeof Blob !== "undefined" && options.body instanceof Blob
    || typeof FormData !== "undefined" && options.body instanceof FormData
    || options.body instanceof ArrayBuffer
    || ArrayBuffer.isView(options.body);

  if (options.body !== undefined && !headers["Content-Type"] && !bodyIsRaw) {
    headers["Content-Type"] = "application/json";
  }

  const requestBody = options.body === undefined
    ? undefined
    : bodyIsRaw || typeof options.body === "string"
      ? options.body
      : JSON.stringify(options.body);

  const response = await fetch(MIGRATION_API_BASE + path, {
    method,
    headers,
    body: requestBody,
    cache: "no-store"
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try { payload = JSON.parse(raw); }
    catch { payload = { message: raw }; }
  }

  if (response.status === 401) {
    setMigrationToken("");
    state.currentUser = null;
    showLogin();
  }
  if (!response.ok || payload?.status === "error") {
    throw new Error(payload?.message || `API hatası (${response.status})`);
  }
  return payload;
}

// ---- Yetki / oturum ----
writeRolePermissions = function(permissions) {
  const normalized = normalizeRolePermissions(permissions);
  localStorage.setItem(ROLE_PERMISSION_STORE_KEY, JSON.stringify(normalized));
  return normalized;
};
loadRolePermissionsFromSupabase = async function() {
  const payload = await apiFetch("/api/settings/role-permissions");
  localStorage.setItem(ROLE_PERMISSION_STORE_KEY, JSON.stringify(normalizeRolePermissions(payload.role_permissions || {})));
};
saveRolePermissionsToSupabase = async function() {
  throw new Error("Migration test: Rol izinleri yazma henüz taşınmadı.");
};
canAccessTab = function(tab, role = currentStaff().role) {
  if (!MIGRATION_ALLOWED_TABS.has(tab)) return false;
  return permissionsForRole(role).includes(tab);
};
applyRoleVisibility = function() {
  const staff = currentStaff();
  ALL_TAB_KEYS.forEach(tab => {
    const nav = document.getElementById("nav-" + tab);
    if (nav) nav.classList.toggle("hidden", !canAccessTab(tab, staff.role));
  });
  document.body.dataset.role = staff.role || "kasa";
  document.body.classList.add("migration-test-mode");
};
userActionAllowed = function(action) {
  const staff = currentStaff();
  if (["stockIn", "stockOut"].includes(action) && !["admin", "depo"].includes(staff.role)) return false;
  if (staff.role === "admin") return true;
  return staff.permissions?.[action] === true;
};

loadAuthenticatedProfile = async function() {
  const payload = await apiFetch("/api/auth/me");
  const u = payload.user;
  if (!u) throw new Error("Oturum bulunamadı");
  const profile = normalizeStaffItem({
    authUserId: u.auth_user_id,
    username: u.username,
    name: u.name,
    role: u.role,
    isActive: true,
    allowedCategories: u.allowed_categories || [],
    permissions: u.permissions || {},
    lastSeenAt: u.last_seen_at,
    lastLoginAt: u.last_login_at
  });
  localStorage.setItem(STAFF_STORE_KEY, JSON.stringify([profile]));
  localStorage.setItem(CURRENT_STAFF_STORE_KEY, profile.name);
  state.currentUser = profile;
  return profile;
};

loginWithSelectedStaff = async function() {
  const username = String(el.loginStaffSelect?.value || "").trim();
  const password = String(el.loginPasswordInput?.value || "");
  if (!username || !password) return showToast("Kullanıcı adı ve şifre gerekli", true);
  try {
    setLoading(true);
    // login endpointi token istemez; geçici eski tokenı çağrıdan önce temizle.
    setMigrationToken("");
    const payload = await apiFetch("/api/auth/login", { method: "POST", body: { username, password } });
    if (!payload.token) throw new Error("API token döndürmedi");
    setMigrationToken(payload.token);
    const staff = await loadAuthenticatedProfile();
    await Promise.all([loadRolePermissionsFromSupabase(), loadStaffListFromSupabase()]);
    if (el.loginPasswordInput) el.loginPasswordInput.value = "";
    hideLogin(); updateUserPill(); applyRoleVisibility(); renderStaffSelector();
    switchTab("operation");
    await logActivity("login", `${staff.name} migration-test giriş yaptı`, "staff", staff.name);
    showToast(`Hoş geldin ${staff.name} ✅`);
    await Promise.all([loadDashboardStats(), loadMovements(), loadOperationFilterOptions()]);
  } catch (err) {
    setMigrationToken("");
    showToast(err?.message || "Giriş yapılamadı", true);
  } finally { setLoading(false); }
};

initAuthGate = async function() {
  if (!migrationToken()) { showLogin(); return false; }
  try {
    await loadAuthenticatedProfile();
    await Promise.all([loadRolePermissionsFromSupabase(), loadStaffListFromSupabase()]);
    hideLogin(); updateUserPill(); applyRoleVisibility();
    return true;
  } catch (err) {
    console.warn("Migration-test oturumu açılamadı:", err?.message || err);
    setMigrationToken("");
    state.currentUser = null;
    showLogin();
    return false;
  }
};

window.logoutCurrentUser = async function() {
  const staff = currentStaff();
  await logActivity("logout", `${staff.name} migration-test çıkış yaptı`, "staff", staff.name).catch(() => {});
  setMigrationToken("");
  localStorage.removeItem(SESSION_STORE_KEY);
  localStorage.removeItem(CURRENT_STAFF_STORE_KEY);
  localStorage.removeItem(STAFF_STORE_KEY);
  state.currentUser = null;
  showLogin(); showToast("Çıkış yapıldı");
};
logoutCurrentUser = window.logoutCurrentUser;

// ---- Yerel log: test paketi Supabase'e log yazmaz ----
logActivity = async function(action, description, entity_table = null, entity_id = null) {
  const staff = currentStaff();
  const item = {
    id: "local_" + Date.now() + "_" + Math.random().toString(16).slice(2),
    actor_name: staff.name, actor_role: staff.role, action, description, entity_table,
    entity_id: entity_id ? String(entity_id) : null, created_at: new Date().toISOString()
  };
  localActivityPush(item);
  state.activityLogs = [item, ...(state.activityLogs || [])].slice(0, 120);
  renderActivityLogs();
};
loadActivityLogs = async function() {
  state.activityLogs = readLocalActivityLogs();
  renderActivityLogs();
};
window.loadActivityLogs = loadActivityLogs;

// ---- Personel / rol okumaları ----
loadStaffListFromSupabase = async function() {
  const payload = await apiFetch("/api/users");
  const cleaned = cleanStaffList((payload.users || []).map(row => normalizeStaffItem({
    authUserId: row.auth_user_id,
    username: row.username,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    lastSeenAt: row.last_seen_at,
    lastLoginAt: row.last_login_at,
    allowedCategories: row.allowed_categories || [],
    permissions: row.permissions || {}
  })));
  localStorage.setItem(STAFF_STORE_KEY, JSON.stringify(cleaned));
  if (state.currentUser?.authUserId) {
    const fresh = cleaned.find(x => x.authUserId === state.currentUser.authUserId);
    if (fresh) state.currentUser = { ...state.currentUser, ...fresh };
  }
  return cleaned;
};
saveStaffListToSupabase = async function() {
  showToast("Migration test: Personel yazma işlemi kapalı", true);
  return false;
};


// ---- Ürün CRUD + görsel (PostgreSQL API) ----
function migrationAssetUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^blob:|^data:/i.test(url)) return url;
  if (/supabase\.co/i.test(url)) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) return MIGRATION_API_BASE + url;
  return url;
}

// Add ekranı state.products boş diye eski Supabase loadProducts çağrısına düşmesin.
loadProducts = async function() {
  await loadOperationFilterOptions().catch(() => {});
  return state.products || [];
};
window.loadProducts = loadProducts;

// Relative /uploads yolunu Vercel tarafında doğru API domainine çevir.
updateProductImagePreview = function(url = "") {
  const raw = String(url || "").trim();
  const displayUrl = migrationAssetUrl(raw);
  if (el.productImagePreview) {
    el.productImagePreview.innerHTML = displayUrl
      ? `<img src="${escapeHtml(displayUrl)}" alt="Ürün resmi" />`
      : `<div class="product-image-empty">📷<span>Resim yok</span></div>`;
  }
  if (el.productImageStatus) {
    el.productImageStatus.textContent = raw && !displayUrl
      ? "Eski Supabase görseli migration testte gösterilmiyor"
      : displayUrl ? "Resim hazır" : "Resim seçilmedi";
  }
  if (el.productImageViewBtn) el.productImageViewBtn.disabled = !displayUrl;
  if (el.productImageRemoveBtn) el.productImageRemoveBtn.disabled = !raw && !selectedProductImageBlob;
};

window.openProductImage = function(url) {
  const raw = String(url || el.productImage?.value || "").trim();
  const imageUrl = migrationAssetUrl(raw);
  if (!imageUrl) return showToast("Bu ürünün migration testte görüntülenebilir resmi yok", true);
  const modal = ensureProductImageModal();
  const img = document.getElementById("productImageModalImg");
  if (img) img.src = imageUrl;
  modal.classList.remove("hidden");
  document.body.classList.add("image-modal-open");
  if (!history.state || !history.state.productImageModal) {
    history.pushState({ ...(history.state || {}), productImageModal: true }, "");
  }
};
openProductImage = window.openProductImage;

productImageHtml = function(p, sizeClass = "product-card-img") {
  const raw = p?.imageThumbUrl || p?.imageUrl || "";
  const safe = migrationAssetUrl(raw);
  return safe
    ? `<img class="${sizeClass}" src="${escapeHtml(safe)}" alt="Ürün resmi" loading="lazy" onclick="openProductImage('${escapeHtml(p.imageUrl || raw)}')" />`
    : `<div class="${sizeClass} empty" title="Resim yok / eski storage resmi">📷</div>`;
};

uploadProductImageIfNeeded = async function(productId) {
  if (productImageRemoveRequested) return { imageUrl: "", imageThumbUrl: "" };
  if (!selectedProductImageBlob) {
    const current = String(el.productImage?.value || "").trim();
    return { imageUrl: current, imageThumbUrl: current };
  }

  if (!productId) throw new Error("Resim yüklemek için ürün ID gerekli");
  if (el.productImageStatus) el.productImageStatus.textContent = "Resim sunucuya yükleniyor...";

  const blob = selectedProductImageBlob;
  const payload = await apiFetch(`/api/products/${encodeURIComponent(productId)}/image`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "image/webp"
    },
    body: blob
  });

  const imageUrl = String(payload.image_url || "").trim();
  if (!imageUrl) throw new Error("API resim yolu döndürmedi");
  return {
    imageUrl,
    imageThumbUrl: String(payload.image_thumb_url || imageUrl)
  };
};

function migrationProductBody(payload) {
  const row = toProductRow(payload);
  delete row.product_name;
  return row;
}

async function migrationSaveProduct(payload) {
  const isEdit = Boolean(payload.id);

  if (isEdit) {
    const uploaded = await uploadProductImageIfNeeded(payload.id);
    payload.imageUrl = uploaded.imageUrl;
    payload.imageThumbUrl = uploaded.imageThumbUrl;

    const result = await apiFetch(`/api/products/${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      body: migrationProductBody(payload)
    });

    await refreshMigrationProductState(payload.id, { product: result.product }).catch(() => {});
    return { product: result.product, created: false };
  }

  // Yeni üründe görsel endpointi ürün ID istediği için önce kartı oluştur.
  const createPayload = { ...payload, imageUrl: "", imageThumbUrl: "" };
  const created = await apiFetch("/api/products", {
    method: "POST",
    body: migrationProductBody(createPayload)
  });

  const id = String(created.product?.id || "");
  if (!id) throw new Error("Yeni ürün ID alınamadı");
  payload.id = id;

  let finalProduct = created.product;

  if (selectedProductImageBlob) {
    const uploaded = await uploadProductImageIfNeeded(id);
    payload.imageUrl = uploaded.imageUrl;
    payload.imageThumbUrl = uploaded.imageThumbUrl;

    const patched = await apiFetch(`/api/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        image_url: uploaded.imageUrl,
        image_thumb_url: uploaded.imageThumbUrl
      }
    });
    finalProduct = patched.product || finalProduct;
  }

  state.operationCacheKey = "";
  return { product: finalProduct, created: true };
}
window.migrationSaveProduct = migrationSaveProduct;

window.deleteProduct = async function(id) {
  if (!requireRoleAction(["admin"], "Ürün silme yetkisi sadece Admin")) return;
  const product = [...(state.operationResults || []), ...(state.movementResults || []), ...(state.products || [])]
    .find((p) => String(p.id) === String(id));
  if (!(await appConfirm("Bu ürünü silmek istediğine emin misin? Geçmiş kaydı/stoğu olan ürün güvenlik nedeniyle silinmez.", { danger: true, okText: "Sil" }))) return;

  try {
    setLoading(true);
    await apiFetch(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.products = (state.products || []).filter(p => String(p.id) !== String(id));
    state.filteredProducts = (state.filteredProducts || []).filter(p => String(p.id) !== String(id));
    state.operationResults = (state.operationResults || []).filter(p => String(p.id) !== String(id));
    state.movementResults = (state.movementResults || []).filter(p => String(p.id) !== String(id));
    state.operationCacheKey = "";
    if (el.operationResultBox) renderOperationCards(state.operationResults || []);
    await Promise.allSettled([loadDashboardStats(), loadMovements()]);
    showToast("Ürün silindi ✅");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Ürün silinemedi", true);
  } finally {
    setLoading(false);
  }
};
deleteProduct = window.deleteProduct;

// ---- Dashboard / filtre / ürün / hareket ----
loadDashboardStats = async function() {
  const payload = await apiFetch("/api/stock/dashboard");
  const s = payload.stats || {};
  if (el.totalProductCount) el.totalProductCount.textContent = Number(s.total_products || 0);
  if (el.totalStockCount) el.totalStockCount.textContent = Number(s.total_stock || 0);
  if (el.reservedStockCount) el.reservedStockCount.textContent = Number(s.reserved_stock || 0);
  if (el.criticalStockCount) el.criticalStockCount.textContent = Number(s.critical_stock || 0);
};
window.loadDashboardStats = loadDashboardStats;

loadOperationFilterOptions = async function() {
  if (state.operationFilterOptionsLoaded) { refreshOperationFilters(); return; }
  const payload = await apiFetch("/api/product-filter-options");
  state.operationCategories = uniqueCleanValues(payload.categories || []);
  state.operationBrands = uniqueCleanValues(payload.vehicle_brands || []);
  state.operationFilterOptionsLoaded = true;
  refreshOperationFilters();
};
window.loadOperationFilterOptions = loadOperationFilterOptions;

// ---- Kritik stok (PostgreSQL API) ----
state.migrationCriticalProducts = state.migrationCriticalProducts || [];

function migrationCriticalFilterValues(items, field, fallback) {
  return [...new Set((items || [])
    .map(p => String(p?.[field] || fallback).trim() || fallback))]
    .sort((a, b) => a.localeCompare(b, "tr"));
}

function refreshMigrationCriticalFilters() {
  const items = state.migrationCriticalProducts || [];
  const categories = migrationCriticalFilterValues(items, "category", "Kategorisiz");
  const productBrands = migrationCriticalFilterValues(items, "productBrand", "Markasız");
  const carBrands = migrationCriticalFilterValues(items, "carBrand", "Araç Markası Yok");
  fillStockFilterSelect("criticalCategoryFilter", categories, state.criticalCategoryFilter || "all", "Tüm Kategoriler");
  fillStockFilterSelect("criticalProductBrandFilter", productBrands, state.criticalProductBrandFilter || "all", "Tüm Ürün Markaları");
  fillStockFilterSelect("criticalCarBrandFilter", carBrands, state.criticalCarBrandFilter || "all", "Tüm Araç Markaları");
}

function renderMigrationCriticalRows() {
  const box = document.getElementById("criticalStockList");
  if (!box) return;

  refreshMigrationCriticalFilters();

  const q = String(document.getElementById("criticalSearchInput")?.value || "");
  const selectedCategory = state.criticalCategoryFilter || "all";
  const selectedProductBrand = state.criticalProductBrandFilter || "all";
  const selectedCarBrand = state.criticalCarBrandFilter || "all";

  let items = [...(state.migrationCriticalProducts || [])];
  if (selectedCategory !== "all") items = items.filter(p => String(p.category || "Kategorisiz") === selectedCategory);
  if (selectedProductBrand !== "all") items = items.filter(p => String(p.productBrand || "Markasız") === selectedProductBrand);
  if (selectedCarBrand !== "all") items = items.filter(p => String(p.carBrand || "Araç Markası Yok") === selectedCarBrand);
  if (String(q).trim()) items = items.filter(p => productSmartSearch(p, q) || barcodeSmartSearch(p, q));

  items.sort((a, b) => (saleAvailable(a) - Number(a.minStock || 0)) - (saleAvailable(b) - Number(b.minStock || 0)));

  box.innerHTML = items.length ? items.map(p => {
    const available = saleAvailable(p);
    return `<div class="sale-product-item critical-card"><div><div class="sale-product-title">${escapeHtml(p.category || p.name || "-")}</div><div class="sale-product-meta">${escapeHtml(p.productBrand || "-")} / ${escapeHtml(p.carBrand || "-")} ${escapeHtml(p.carModel || "")} ${escapeHtml(p.carType || "")} ${escapeHtml(p.vehicleYear || "")}<br>Mevcut: ${p.stock} · Rezerve: ${p.reserved} · Kullanılabilir: <strong class="stock-warning">${available}</strong> · Min: ${p.minStock} · Raf: ${escapeHtml(p.location || "-")}</div></div></div>`;
  }).join("") : `<div class="empty-state">Kritik stokta ürün yok 🎉</div>`;
}

loadCriticalStock = async function() {
  const box = document.getElementById("criticalStockList");
  if (box) box.innerHTML = `<div class="empty-state">Kritik stok yükleniyor...</div>`;
  const payload = await apiFetch("/api/stock/critical?limit=1000");
  state.migrationCriticalProducts = (payload.products || []).map(mapProduct);
  renderMigrationCriticalRows();
  return state.migrationCriticalProducts;
};
window.loadCriticalStock = loadCriticalStock;

renderCriticalStock = function() {
  renderMigrationCriticalRows();
};
window.renderCriticalStock = renderCriticalStock;

window.setCriticalCategoryFilter = function(value) {
  state.criticalCategoryFilter = value || "all";
  renderMigrationCriticalRows();
};
window.setCriticalProductBrandFilter = function(value) {
  state.criticalProductBrandFilter = value || "all";
  renderMigrationCriticalRows();
};
window.setCriticalCarBrandFilter = function(value) {
  state.criticalCarBrandFilter = value || "all";
  renderMigrationCriticalRows();
};

loadMovements = async function() {
  const payload = await apiFetch("/api/stock/movements?limit=100");
  state.movements = payload.movements || [];
  renderMovements();
  if (typeof renderSaleDashboard === "function") renderSaleDashboard();
};

loadStockRequests = async function() {
  if (!el.stockRequestsBox) return;
  const payload = await apiFetch("/api/stock/requests?limit=100");
  state.stockRequests = payload.requests || [];
  updateRequestBadge(); renderStockRequests();
};
window.loadStockRequests = loadStockRequests;

searchStockProducts = async function({ brand = "", category = "", search = "", limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (brand) params.set("vehicle_brand", brand);
  if (category) params.set("category", category);
  if (String(search || "").trim()) params.set("q", String(search || "").trim());
  params.set("limit", String(Math.min(100, Math.max(1, Number(limit || 100)))));
  const payload = await apiFetch("/api/products?" + params.toString());
  return payload.products || [];
};

async function migrationStockMovement(id, direction, quantity, description) {
  return apiFetch("/api/stock/movement", {
    method: "POST",
    body: { product_id: id, direction, quantity: Number(quantity), description }
  });
}

async function refreshMigrationProductState(id, movementPayload = null) {
  const productId = String(id || "");
  let fresh = null;

  try {
    const detail = await apiFetch("/api/products/" + encodeURIComponent(productId));
    if (detail?.product) fresh = mapProduct(detail.product);
  } catch (err) {
    console.warn("Ürün detayı anlık yenilenemedi, işlem cevabına düşülüyor:", err?.message || err);
  }

  // Detay isteği geçici olarak başarısız olursa API hareket cevabındaki
  // yeni miktarı kullan. Asıl stok hareketi başarılı olduğu için kullanıcıya
  // yanlışlıkla "işlem başarısız" göstermeyelim.
  if (!fresh) {
    const rawQty = movementPayload?.new_quantity
      ?? movementPayload?.product?.quantity
      ?? movementPayload?.quantity;
    const qty = Number(rawQty);

    const source = [
      ...(state.operationResults || []),
      ...(state.movementResults || []),
      ...(state.products || [])
    ].find(p => String(p?.id) === productId);

    if (source) {
      fresh = { ...source };
      if (Number.isFinite(qty)) fresh.stock = qty;
    }
  }

  if (!fresh) return null;

  const replaceIn = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      if (String(list[i]?.id) === productId) list[i] = { ...list[i], ...fresh };
    }
  };

  replaceIn(state.operationResults);
  replaceIn(state.movementResults);
  replaceIn(state.products);
  replaceIn(state.filteredProducts);

  // Aynı filtre/arama daha sonra tekrar çalıştırıldığında cache yüzünden
  // eski sonuç kullanılmasın.
  state.operationCacheKey = "";

  if (el.operationResultBox) renderOperationCards(state.operationResults || []);
  if (typeof renderMovementCards === "function" && el.movementResultBox) {
    renderMovementCards(state.movementResults || []);
  }

  return fresh;
}

window.operationStockAction = async function(id, type) {
  const direction = String(type || "").trim().toLowerCase();
  if (!["giris", "cikis"].includes(direction)) return showToast("Hareket tipi belirlenemedi", true);
  const product = [...(state.operationResults || []), ...(state.products || [])].find(p => String(p.id) === String(id));
  if (!product) return showToast("Ürün bulunamadı", true);
  if (!canAccessCategory(product.category)) return showToast("Bu ürün kategorisine yetkin yok", true);
  if (direction === "giris" && !requireUserAction("stockIn", "Stok giriş yetkin yok")) return;
  if (direction === "cikis" && !requireUserAction("stockOut", "Stok çıkış yetkin yok")) return;
  const quantity = getOperationQty(id);
  const available = Number(product.stock || 0) - Number(product.reserved || 0);
  if (direction === "cikis" && available < quantity) return showToast(`Yeterli kullanılabilir stok yok. Kullanılabilir: ${available}`, true);
  const label = direction === "giris" ? "giriş" : "çıkış";
  if (!(await appConfirm(`${product.category || product.name} için ${quantity} adet ${label} yapılsın mı?`, { okText: "İşlemi Yap" }))) return;
  try {
    setLoading(true);
    const payload = await migrationStockMovement(id, direction, quantity, `Hızlı işlem ekranı manuel ${label}${actorSuffix()}`);
    await refreshMigrationProductState(id, payload);
    await logActivity("stock_" + direction, `${product.name || product.category} için ${quantity} adet ${label}`, "stock_products", id);
    await Promise.allSettled([loadMovements(), loadDashboardStats()]);
    showToast(`${quantity} adet ${label} kaydedildi ✅`);
  } catch (err) {
    console.error(err); showToast(err.message || "İşlem kaydedilemedi", true);
  } finally { setLoading(false); }
};

window.quickStockAction = async function(id, type, fixedQty = null) {
  const direction = String(type || "").trim().toLowerCase();
  if (!["giris", "cikis"].includes(direction)) return showToast("Hareket tipi belirlenemedi", true);
  if (!["admin", "depo"].includes(currentStaff().role)) return showToast("Stok giriş/çıkış sadece Admin/Depo", true);
  const product = [...(state.movementResults || []), ...(state.operationResults || [])].find(p => String(p.id) === String(id));
  if (!product) return showToast("Ürün bulunamadı", true);
  const quantity = Number(fixedQty || getQuickQty(id) || 1);
  const available = Number(product.stock || 0) - Number(product.reserved || 0);
  if (direction === "cikis" && available < quantity) return showToast(`Yeterli kullanılabilir stok yok. Kullanılabilir: ${available}`, true);
  const label = direction === "giris" ? "giriş" : "çıkış";
  if (!(await appConfirm(`${product.category || product.name} için ${quantity} adet ${label} yapılsın mı?`, { okText: "İşlemi Yap" }))) return;
  try {
    setLoading(true);
    const payload = await migrationStockMovement(id, direction, quantity, `Hareketler ekranı manuel ${label}${actorSuffix()}`);
    await refreshMigrationProductState(id, payload);
    await logActivity("stock_" + direction, `${product.name || product.category} için ${quantity} adet ${label}`, "stock_products", id);
    await Promise.allSettled([loadMovements(), loadDashboardStats()]);
    showToast(`${quantity} adet ${label} kaydedildi ✅`);
  } catch (err) {
    console.error(err); showToast(err.message || "Hareket kaydedilemedi", true);
  } finally { setLoading(false); }
};

changeOwnPassword = async function() {
  showToast("Migration test: Şifre değiştirme henüz taşınmadı", true);
};
window.changeOwnPassword = changeOwnPassword;


// ---- Sipariş Önerisi (PostgreSQL API) ----
function migrationOrderSuggestionFilterValues(items, field, fallback) {
  return [...new Set((items || [])
    .map(row => String(row?.[field] || fallback).trim() || fallback))]
    .sort((a, b) => a.localeCompare(b, "tr"));
}

function refreshMigrationOrderSuggestionFilters() {
  const rows = state.orderSuggestionRows || [];
  fillStockFilterSelect(
    "orderSuggestionCategoryFilter",
    migrationOrderSuggestionFilterValues(rows, "category", "Kategorisiz"),
    state.orderSuggestionCategoryFilter || "all",
    "Tüm Kategoriler"
  );
  fillStockFilterSelect(
    "orderSuggestionProductBrandFilter",
    migrationOrderSuggestionFilterValues(rows, "productBrand", "Markasız"),
    state.orderSuggestionProductBrandFilter || "all",
    "Tüm Ürün Markaları"
  );
  fillStockFilterSelect(
    "orderSuggestionCarBrandFilter",
    migrationOrderSuggestionFilterValues(rows, "carBrand", "Araç Markası Yok"),
    state.orderSuggestionCarBrandFilter || "all",
    "Tüm Araç Markaları"
  );
}

renderOrderSuggestionRows = function() {
  const box = document.getElementById("orderSuggestionList");
  const summary = document.getElementById("orderSuggestionSummary");
  if (!box) return;

  refreshMigrationOrderSuggestionFilters();

  const selectedCategory = state.orderSuggestionCategoryFilter || "all";
  const selectedProductBrand = state.orderSuggestionProductBrandFilter || "all";
  const selectedCarBrand = state.orderSuggestionCarBrandFilter || "all";
  const allRows = state.orderSuggestionRows || [];
  const rows = allRows.filter(r =>
    (selectedCategory === "all" || String(r.category || "Kategorisiz") === selectedCategory) &&
    (selectedProductBrand === "all" || String(r.productBrand || "Markasız") === selectedProductBrand) &&
    (selectedCarBrand === "all" || String(r.carBrand || "Araç Markası Yok") === selectedCarBrand)
  );

  const needRows = rows.filter(r => Number(r.suggestedQty || 0) > 0);
  const totalOut = rows.reduce((sum, r) => sum + Number(r.outQty || 0), 0);
  const totalSuggested = needRows.reduce((sum, r) => sum + Number(r.suggestedQty || 0), 0);

  if (summary) {
    summary.innerHTML = `
      <div class="value-stat"><span>Son 7 Gün Çıkış</span><strong>${totalOut}</strong></div>
      <div class="value-stat"><span>Sipariş Önerilen Ürün</span><strong>${needRows.length}</strong></div>
      <div class="value-stat"><span>Önerilen Toplam Adet</span><strong>${totalSuggested}</strong></div>
      <div class="value-stat"><span>Kategori</span><strong>${escapeHtml(selectedCategory === "all" ? "Tümü" : selectedCategory)}</strong></div>
      <div class="value-stat"><span>Ürün Markası</span><strong>${escapeHtml(selectedProductBrand === "all" ? "Tümü" : selectedProductBrand)}</strong></div>
      <div class="value-stat"><span>Araç Markası</span><strong>${escapeHtml(selectedCarBrand === "all" ? "Tümü" : selectedCarBrand)}</strong></div>
      <div class="value-stat"><span>Hesap</span><strong>Çıkış - Stok</strong></div>
    `;
  }

  if (!rows.length) {
    box.innerHTML = `<div class="empty-state">Son 7 günde çıkış hareketi bulunamadı.</div>`;
    return;
  }

  const categoryMap = new Map();
  rows.forEach(r => {
    const key = String(r.category || "Kategorisiz");
    const old = categoryMap.get(key) || {
      category: key,
      outQty: 0,
      currentStock: 0,
      suggestedQty: 0,
      productCount: 0
    };
    old.outQty += Number(r.outQty || 0);
    old.currentStock += Number(r.currentStock || 0);
    old.suggestedQty += Number(r.suggestedQty || 0);
    old.productCount += 1;
    categoryMap.set(key, old);
  });

  const categoryRows = [...categoryMap.values()]
    .sort((a,b) => (b.suggestedQty-a.suggestedQty) || (b.outQty-a.outQty));

  const categoryHtml = categoryRows.length ? `
    <div class="category-order-grid">${categoryRows.map(c => `
      <button type="button" class="category-order-card ${c.suggestedQty > 0 ? "need" : "ok"}"
        data-order-category="${escapeHtml(c.category)}"
        onclick="openOrderSuggestionCategory(this.dataset.orderCategory)">
        <strong>${escapeHtml(c.category)}</strong>
        <span>${c.productCount} ürün · ${c.outQty} çıkış</span>
        <b>${c.suggestedQty} adet öneri</b>
      </button>`).join("")}</div>` : "";

  box.innerHTML = categoryHtml + `
    <div class="table-wrap"><table class="order-suggestion-table">
      <thead><tr><th>Ürün</th><th>Kategori</th><th>Araç</th><th>Son 7 Gün Çıkış</th><th>Mevcut Stok</th><th>Önerilen Sipariş</th><th>Raf</th><th>Son Çıkış</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.suggestedQty > 0 ? "need-order" : "no-order"}">
        <td><strong>${escapeHtml(r.productName)}</strong><div class="muted">${escapeHtml(r.productBrand || "-")}</div></td>
        <td>${escapeHtml(r.category || "-")}</td>
        <td>${escapeHtml([r.carBrand, r.carModel, r.carType, r.vehicleYear].filter(Boolean).join(" ") || "-")}</td>
        <td><strong>${Number(r.outQty || 0)}</strong></td>
        <td>${Number(r.currentStock || 0)}</td>
        <td><strong class="${r.suggestedQty > 0 ? "stock-warning" : ""}">${Number(r.suggestedQty || 0)}</strong></td>
        <td>${escapeHtml(r.location || "-")}</td>
        <td>${r.lastDate ? formatDate(r.lastDate) : "-"}</td>
      </tr>`).join("")}</tbody>
    </table></div>
  `;
};
window.renderOrderSuggestionRows = renderOrderSuggestionRows;

loadOrderSuggestions = async function() {
  const box = document.getElementById("orderSuggestionList");
  if (box) box.innerHTML = `<div class="empty-state">Son 7 günlük çıkışlar PostgreSQL'den hesaplanıyor...</div>`;

  const payload = await apiFetch("/api/stock/order-suggestions?days=7");
  state.orderSuggestionRows = (payload.rows || []).map(row => ({
    productId: row.product_id,
    productName: row.product_name || "-",
    productBrand: row.product_brand || "",
    category: row.category || "",
    carBrand: row.vehicle_brand || "",
    carModel: row.vehicle_model || "",
    carType: row.vehicle_type || "",
    vehicleYear: row.vehicle_year || "",
    location: row.location || "",
    outQty: Number(row.out_qty || 0),
    currentStock: Number(row.current_stock || 0),
    suggestedQty: Number(row.suggested_qty || 0),
    lastDate: row.last_date || "",
    movementCount: Number(row.movement_count || 0)
  }));

  renderOrderSuggestionRows();
  return state.orderSuggestionRows;
};
window.loadOrderSuggestions = loadOrderSuggestions;

window.openOrderSuggestionCategory = function(value) {
  const category = String(value || "").trim() || "all";
  state.orderSuggestionCategoryFilter = category;

  const select = document.getElementById("orderSuggestionCategoryFilter");
  if (select) select.value = category;

  renderOrderSuggestionRows();

  requestAnimationFrame(() => {
    const table = document.querySelector("#orderSuggestionList .order-suggestion-table");
    if (table) {
      table.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
};

window.setOrderSuggestionCategoryFilter = function(value) {
  state.orderSuggestionCategoryFilter = value || "all";
  renderOrderSuggestionRows();
};
window.setOrderSuggestionProductBrandFilter = function(value) {
  state.orderSuggestionProductBrandFilter = value || "all";
  renderOrderSuggestionRows();
};
window.setOrderSuggestionCarBrandFilter = function(value) {
  state.orderSuggestionCarBrandFilter = value || "all";
  renderOrderSuggestionRows();
};


// ============================================================
// MIGRATION TEST v6 - TALEPLER / REZERVASYON
// ============================================================

state.requestFilter = "active";

function migrationRequestIsActive(status) {
  return ["bekliyor", "rezerve_edildi", "teslim_edildi"].includes(String(status || ""));
}

function migrationUpdateRequestBadge() {
  const count = (state.stockRequests || []).filter(r => migrationRequestIsActive(r.status)).length;
  const badge = document.getElementById("requestNavBadge");
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count <= 0);
  }
  if (typeof updateRequestBadge === "function") {
    try { updateRequestBadge(); } catch {}
  }
}

loadStockRequests = async function() {
  if (!el.stockRequestsBox) return [];
  el.stockRequestsBox.innerHTML = `<div class="empty-state">Talepler yükleniyor...</div>`;
  const all = [];
  const limit = 100;
  for (let offset = 0; offset < 1000; offset += limit) {
    const payload = await apiFetch(`/api/stock/requests?limit=${limit}&offset=${offset}`);
    const rows = payload.requests || [];
    all.push(...rows);
    const total = Number(payload.total ?? payload.total_count ?? 0);
    if (rows.length < limit || (total > 0 && all.length >= total)) break;
  }
  const byId = new Map();
  all.forEach(r => { if (r?.id) byId.set(String(r.id), r); });
  state.stockRequests = [...byId.values()];
  migrationUpdateRequestBadge();
  renderStockRequests();
  return state.stockRequests;
};
window.loadStockRequests = loadStockRequests;

renderStockRequests = function() {
  if (!el.stockRequestsBox) return;
  let list = [...(state.stockRequests || [])];
  const filter = state.requestFilter || "active";
  if (filter === "active") list = list.filter(r => migrationRequestIsActive(r.status));
  else if (filter !== "all") list = list.filter(r => String(r.status || "") === filter);
  list.sort((a, b) => {
    const aa = migrationRequestIsActive(a.status) ? 0 : 1;
    const bb = migrationRequestIsActive(b.status) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
  if (!list.length) {
    el.stockRequestsBox.innerHTML = `<div class="empty-state">Bu filtrede talep yok</div>`;
    return;
  }
  el.stockRequestsBox.innerHTML = list.map(req => {
    const status = String(req.status || "");
    const canMatch = !["montaj_bitti", "iptal"].includes(status);
    return `<div class="movement-item">
      <div class="movement-top"><div><strong>${escapeHtml(req.plate || "Plaka yok")}</strong><div class="muted">${escapeHtml(req.customer_name || "-")}</div></div><span class="badge status-${escapeHtml(status || "bos")}">${formatRequestStatus(status)}</span></div>
      <div>Usta: <strong>${escapeHtml(req.technician_name || "-")}</strong></div>
      <div>İstenen: <strong>${escapeHtml(req.requested_text || "-")}</strong></div>
      <div>Araç: <strong>${escapeHtml([req.vehicle_brand, req.vehicle_model, req.vehicle_type, req.vehicle_year].filter(Boolean).join(" ") || "-")}</strong></div>
      <div>Tarih: <strong>${formatDate(req.created_at)}</strong></div>
      <div class="row-gap" style="margin-top:10px;">${canMatch ? `<button class="btn primary" onclick="openReservationPanel('${req.id}')">Ürün Eşleştir</button>` : ""}${status === "rezerve_edildi" ? `<button class="btn danger" onclick="cancelReservation('${req.id}')">Rezervi İptal Et</button>` : ""}</div>
    </div>`;
  }).join("");
};
window.renderStockRequests = renderStockRequests;

window.setRequestFilter = function(status) {
  state.requestFilter = status || "active";
  renderStockRequests();
};

window.closeReservationPanel = function() {
  state.selectedStockRequestId = null;
  if (el.reservationPanel) el.reservationPanel.classList.add("hidden");
  if (el.productMatchBox) el.productMatchBox.innerHTML = `<div class="empty-state">Talep seçildiğinde uygun ürünler burada görünür</div>`;
};

async function migrationLoadRequestReservations(requestId) {
  const box = document.getElementById("requestReservationList");
  if (!box) return [];
  box.innerHTML = `<div class="empty-state">Rezervasyonlar yükleniyor...</div>`;
  try {
    const payload = await apiFetch(`/api/stock/requests/${encodeURIComponent(requestId)}/reservations`);
    const rows = payload.reservations || [];
    box.innerHTML = rows.length ? rows.map(r => `<div class="movement-item"><div class="movement-top"><strong>${escapeHtml(r.product_name || "-")}</strong><span class="badge status-rezerve_edildi">${Number(r.quantity || 0)} adet</span></div><div class="muted">${escapeHtml(r.category || "-")} · ${escapeHtml(r.location || "Raf yok")}</div><div class="muted">Stok: ${Number(r.current_stock || 0)} · Toplam rezerve: ${Number(r.reserved_quantity || 0)}</div></div>`).join("") : `<div class="empty-state">Bu talepte aktif rezervasyon yok</div>`;
    return rows;
  } catch (err) {
    box.innerHTML = `<div class="empty-state">Rezervasyon alınamadı: ${escapeHtml(err.message || err)}</div>`;
    return [];
  }
}

searchProductsForRequest = async function(query = "", autoSuggest = false) {
  if (!el.productMatchBox) return;
  const selectedReq = (state.stockRequests || []).find(r => String(r.id) === String(state.selectedStockRequestId));
  if (!selectedReq) {
    el.productMatchBox.innerHTML = `<div class="empty-state">Önce talep seç</div>`;
    return;
  }
  const rawQuery = String(query || "").trim();
  if (!autoSuggest && rawQuery.length < 2) {
    el.productMatchBox.innerHTML = `<div class="empty-state">En az 2 karakter ürün ara</div>`;
    return;
  }
  el.productMatchBox.innerHTML = `<div class="empty-state">Stokta eşleşen ürünler aranıyor...</div>`;
  try {
    const searches = [];
    if (autoSuggest) {
      const reqText = String(selectedReq.requested_text || "").trim();
      const model = String(selectedReq.vehicle_model || "").trim();
      if (reqText && model) searches.push(`${reqText} ${model}`);
      if (reqText) searches.push(reqText);
      if (model) searches.push(model);
    } else searches.push(rawQuery);
    const uniqueQueries = [...new Set(searches.map(x => x.trim()).filter(Boolean))].slice(0, 3);
    const batches = await Promise.all(uniqueQueries.map(q => searchStockProducts({ search: q, limit: 50 }).catch(() => [])));
    const byId = new Map();
    batches.flat().forEach(row => { const p = mapProduct(row); if (p?.id) byId.set(String(p.id), p); });
    const reqBrand = softText(selectedReq.vehicle_brand);
    const reqModel = softText(selectedReq.vehicle_model);
    const reqType = softText(selectedReq.vehicle_type);
    const reqYear = softText(selectedReq.vehicle_year);
    const requested = softText(selectedReq.requested_text);
    const manual = softText(rawQuery);
    const results = [...byId.values()].map(p => {
      const text = softText([p.name, p.productBrand, p.category, p.carBrand, p.carModel, p.carType, p.vehicleYear, p.location, p.barcode].join(" "));
      let score = 0;
      if (requested && text.includes(requested)) score += 30;
      if (manual && text.includes(manual)) score += 35;
      if (reqBrand && softText(p.carBrand).includes(reqBrand)) score += 12;
      if (reqModel && softText(p.carModel).includes(reqModel)) score += 18;
      if (reqType && softText(p.carType).includes(reqType)) score += 8;
      if (reqYear && softText(p.vehicleYear).includes(reqYear)) score += 4;
      return { p, score };
    }).sort((a,b) => b.score - a.score).slice(0, 50).map(x => x.p);
    if (!results.length) {
      el.productMatchBox.innerHTML = `<div class="empty-state">Eşleşen ürün bulunamadı</div>`;
      return;
    }
    el.productMatchBox.innerHTML = results.map(p => {
      const available = Number(p.stock || 0) - Number(p.reserved || 0);
      return `<div class="movement-search-item"><div class="movement-search-info"><strong>${escapeHtml(p.category || p.name || "-")}</strong><div class="muted">${escapeHtml(p.productBrand || "-")} / ${escapeHtml(p.carBrand || "-")} ${escapeHtml(p.carModel || "")} ${escapeHtml(p.carType || "")} ${escapeHtml(p.vehicleYear || "")}</div><div class="muted">Stok: ${Number(p.stock || 0)} · Rezerve: ${Number(p.reserved || 0)} · Kullanılabilir: <strong class="${available <= 0 ? "stock-warning" : ""}">${available}</strong> · Raf: ${escapeHtml(p.location || "-")}</div></div><div class="movement-search-actions"><input id="qty_${p.id}" type="number" value="1" min="1" max="${Math.max(1, available)}" style="max-width:90px"/><button class="btn primary" onclick="reserveProductForRequest('${p.id}')" ${available <= 0 ? "disabled" : ""}>${available <= 0 ? "Stok Yok" : "Rezerve Et"}</button></div></div>`;
    }).join("");
  } catch (err) {
    el.productMatchBox.innerHTML = `<div class="empty-state">Ürün araması başarısız: ${escapeHtml(err.message || err)}</div>`;
  }
};
window.searchProductsForRequest = searchProductsForRequest;

window.openReservationPanel = async function(requestId) {
  const req = (state.stockRequests || []).find(r => String(r.id) === String(requestId));
  if (!req) return showToast("Talep bulunamadı", true);
  state.selectedStockRequestId = requestId;
  if (el.reservationPanel) el.reservationPanel.classList.remove("hidden");
  renderSelectedRequestDetail(req);
  if (el.productSearchInput) el.productSearchInput.value = req.requested_text || "";
  await migrationLoadRequestReservations(requestId);
  await searchProductsForRequest(req.requested_text || "", true);
  el.reservationPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.reserveProductForRequest = async function(productId) {
  if (!requireRoleAction(["admin", "depo"], "Rezervasyon yetkisi sadece Admin/Depo")) return;
  const requestId = state.selectedStockRequestId;
  if (!requestId) return showToast("Talep seçilmedi", true);
  const quantity = Number(document.getElementById("qty_" + productId)?.value || 1);
  if (!Number.isFinite(quantity) || quantity <= 0) return showToast("Geçerli adet gir", true);
  try {
    setLoading(true);
    await apiFetch(`/api/stock/requests/${encodeURIComponent(requestId)}/reservations`, { method: "POST", body: { product_id: productId, quantity, delivered_to: currentStaff().name || "" } });
    showToast("Stok rezerve edildi ✅ Yeni ürün ekleyebilirsin.");
    await Promise.all([loadStockRequests(), loadDashboardStats(), loadMovements()]);
    state.selectedStockRequestId = requestId;
    const req = (state.stockRequests || []).find(r => String(r.id) === String(requestId));
    if (req) renderSelectedRequestDetail(req);
    await migrationLoadRequestReservations(requestId);
    await searchProductsForRequest(el.productSearchInput?.value || "", false);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Rezerve edilemedi", true);
  } finally { setLoading(false); }
};

window.cancelReservation = async function(requestId) {
  if (!requireRoleAction(["admin", "depo"], "Rezerv iptali yetkisi sadece Admin/Depo")) return;
  if (!(await appConfirm("Bu talepteki rezervleri iptal etmek istediğine emin misin?", { danger: true, okText: "Rezervi İptal Et" }))) return;
  try {
    setLoading(true);
    await apiFetch(`/api/stock/requests/${encodeURIComponent(requestId)}/reservations`, { method: "DELETE" });
    showToast("Rezerv iptal edildi ✅");
    await Promise.all([loadStockRequests(), loadDashboardStats(), loadMovements()]);
    if (String(state.selectedStockRequestId) === String(requestId)) {
      const req = (state.stockRequests || []).find(r => String(r.id) === String(requestId));
      if (req) renderSelectedRequestDetail(req);
      await migrationLoadRequestReservations(requestId);
      await searchProductsForRequest(el.productSearchInput?.value || req?.requested_text || "", false);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || "Rezerv iptal edilemedi", true);
  } finally { setLoading(false); }
};
