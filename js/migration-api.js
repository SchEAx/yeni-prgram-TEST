// Garage İstanbul - Migration Test API overrides
const MIGRATION_TEST_MODE = true;
const MIGRATION_API_BASE = "https://api.scheax.com.tr/migration-test";
const MIGRATION_TOKEN_KEY = "garage_migration_test_jwt_v1";
const MIGRATION_ALLOWED_TABS = new Set(["operation", "movements", "critical", "orderSuggestion", "add"]);

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
