// Garage İstanbul - Migration Test API overrides
const MIGRATION_TEST_MODE = true;
const MIGRATION_API_BASE = "https://api.scheax.com.tr/migration-test";
const MIGRATION_TOKEN_KEY = "garage_migration_test_jwt_v1";
const MIGRATION_ALLOWED_TABS = new Set(["operation", "movements", "critical", "categoryValues", "orderSuggestion", "add", "requests", "purchaseOrders", "management", "users", "settings", "logs"]);

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

// ---- Aktivite logları (PostgreSQL API) ----
// Log sahibini frontend belirlemez; backend JWT'deki kullanıcıyı yazar.
// Log servisinde geçici sorun olursa ana işlem bozulmasın diye yerel fallback tutulur.
logActivity = async function(action, description, entity_table = null, entity_id = null) {
  const fallbackStaff = currentStaff();
  try {
    const payload = await apiFetch('/api/activity-logs', {
      method: 'POST',
      body: {
        action,
        description,
        entity_table,
        entity_id: entity_id == null ? null : String(entity_id)
      }
    });

    const item = payload?.log;
    if (item) {
      localActivityPush(item);
      state.activityLogs = [
        item,
        ...(state.activityLogs || []).filter(x => String(x.id) !== String(item.id))
      ].slice(0, 120);
      renderActivityLogs();
      if (typeof renderUsersList === 'function') renderUsersList();
      if (typeof renderRolePermissionEditor === 'function') renderRolePermissionEditor();
    }
    return item || null;
  } catch (err) {
    console.warn('Aktivite logu API\'ye yazılamadı; yerel fallback kullanılıyor:', err?.message || err);
    const item = {
      id: 'local_' + Date.now() + '_' + Math.random().toString(16).slice(2),
      actor_name: fallbackStaff.name,
      actor_role: fallbackStaff.role,
      action,
      description,
      entity_table,
      entity_id: entity_id == null ? null : String(entity_id),
      created_at: new Date().toISOString()
    };
    localActivityPush(item);
    state.activityLogs = [item, ...(state.activityLogs || [])].slice(0, 120);
    renderActivityLogs();
    return item;
  }
};

loadActivityLogs = async function() {
  try {
    const payload = await apiFetch('/api/activity-logs?limit=120');
    state.activityLogs = Array.isArray(payload?.logs) ? payload.logs : [];
    renderActivityLogs();
    return state.activityLogs;
  } catch (err) {
    console.warn('Aktivite logları API\'den alınamadı; yerel kayıtlar gösteriliyor:', err?.message || err);
    state.activityLogs = readLocalActivityLogs();
    renderActivityLogs();
    return state.activityLogs;
  }
};
window.loadActivityLogs = loadActivityLogs;


// ---- Kategori değerleri + toplu fiyat (PostgreSQL API) ----
function migrationCategoryValueRow(row) {
  return {
    category: String(row?.category || "Kategorisiz"),
    qty: Number(row?.total_stock || 0),
    productCount: Number(row?.product_count || 0),
    purchase: Number(row?.average_purchase || 0),
    sale: Number(row?.average_sale || 0),
    totalPurchase: Number(row?.total_purchase_value || 0),
    totalSale: Number(row?.total_sale_value || 0),
    estimatedDiff: Number(row?.estimated_difference || 0),
    zeroPurchaseCount: Number(row?.zero_purchase_count || 0),
    zeroSaleCount: Number(row?.zero_sale_count || 0),
    pricedProductCount: Number(row?.priced_product_count || 0),
    hasPrice: Number(row?.priced_product_count || 0) > 0
  };
}

computeCategoryValueRows = function() {
  return Array.isArray(state.categoryValueRows) ? state.categoryValueRows : [];
};

loadCategoryValues = async function() {
  const payload = await apiFetch('/api/category-values');
  state.categoryValues = Array.isArray(payload?.rows) ? payload.rows : [];
  state.categoryValueRows = state.categoryValues
    .map(migrationCategoryValueRow)
    .sort((a, b) => a.category.localeCompare(b.category, 'tr'));

  renderCategoryValues();

  const isAdmin = currentStaff().role === 'admin';
  [el.bulkPriceCategory, el.bulkPriceField, el.bulkPriceMode, el.bulkPriceAmount].forEach(node => {
    if (node) node.disabled = !isAdmin;
  });
  const applyBtn = document.querySelector('#page-categoryValues button[onclick="applyCategoryPriceUpdate()"]');
  if (applyBtn) applyBtn.disabled = !isAdmin;
  if (!isAdmin && el.bulkPricePreview) {
    el.bulkPricePreview.textContent = 'Toplu fiyat güncelleme sadece Admin tarafından yapılabilir.';
  }

  return state.categoryValueRows;
};
window.loadCategoryValues = loadCategoryValues;

let migrationPricePreviewTimer = null;
let migrationLastPricePreview = null;

function migrationPriceRequestBody() {
  return {
    category: String(el.bulkPriceCategory?.value || '').trim(),
    field: String(el.bulkPriceField?.value || 'average_sale_price'),
    mode: String(el.bulkPriceMode?.value || 'percent'),
    amount: Number(el.bulkPriceAmount?.value || 0)
  };
}

function migrationPriceFieldLabel(field) {
  return field === 'purchase_price'
    ? 'alış fiyatı'
    : field === 'both'
      ? 'alış ve satış fiyatları'
      : 'ortalama satış fiyatı';
}

function migrationPriceAmountIsValid(mode, amount) {
  if (!Number.isFinite(amount)) return false;
  if (mode === 'fixed') return amount !== 0;
  return amount > 0;
}

function migrationPriceChangeLabel(mode, amount) {
  if (mode === 'percent') return `%${amount} artış`;
  if (amount < 0) return `${formatTL(Math.abs(amount))} düşüş`;
  return `${formatTL(amount)} artış`;
}

function migrationPriceChangeSentence(mode, amount) {
  if (mode === 'percent') return `%${amount} artırılacak`;
  if (amount < 0) return `${formatTL(Math.abs(amount))} düşürülecek`;
  return `${formatTL(amount)} artırılacak`;
}

function migrationPricePreviewText(preview) {
  const field = String(preview?.field || 'average_sale_price');
  const mode = String(preview?.mode || 'percent');
  const amount = Number(preview?.amount || 0);
  const count = Number(preview?.affected_products || 0);
  const zeroCount = field === 'purchase_price'
    ? Number(preview?.zero_purchase_count || 0)
    : field === 'average_sale_price'
      ? Number(preview?.zero_sale_count || 0)
      : Math.max(Number(preview?.zero_purchase_count || 0), Number(preview?.zero_sale_count || 0));

  let currentText = '';
  let nextText = '';
  if (field === 'purchase_price') {
    currentText = formatTL(preview?.current_purchase_value || 0);
    nextText = formatTL(preview?.next_purchase_value || 0);
  } else if (field === 'average_sale_price') {
    currentText = formatTL(preview?.current_sale_value || 0);
    nextText = formatTL(preview?.next_sale_value || 0);
  } else {
    currentText = `${formatTL(preview?.current_purchase_value || 0)} / ${formatTL(preview?.current_sale_value || 0)}`;
    nextText = `${formatTL(preview?.next_purchase_value || 0)} / ${formatTL(preview?.next_sale_value || 0)}`;
  }

  const zeroNote = zeroCount
    ? ` · ${zeroCount} üründe seçili fiyatlardan en az biri 0`
    : '';
  return `${count} ürün · ${migrationPriceFieldLabel(field)} ${migrationPriceChangeLabel(mode, amount)} · Stok değeri ${currentText} → ${nextText}${zeroNote}`;
}

updateBulkPricePreview = async function() {
  if (!el.bulkPricePreview) return;
  if (currentStaff().role !== 'admin') {
    el.bulkPricePreview.textContent = 'Toplu fiyat güncelleme sadece Admin tarafından yapılabilir.';
    return;
  }

  const body = migrationPriceRequestBody();
  if (!body.category || !migrationPriceAmountIsValid(body.mode, body.amount)) {
    migrationLastPricePreview = null;
    el.bulkPricePreview.textContent = 'Kategori ve tutar seçildiğinde işlem özeti burada görünür.';
    return;
  }

  try {
    el.bulkPricePreview.textContent = 'Önizleme hazırlanıyor...';
    const payload = await apiFetch('/api/category-price-update/preview', {
      method: 'POST',
      body
    });
    migrationLastPricePreview = payload?.preview || null;
    el.bulkPricePreview.textContent = migrationPricePreviewText(migrationLastPricePreview);
    return migrationLastPricePreview;
  } catch (err) {
    migrationLastPricePreview = null;
    el.bulkPricePreview.textContent = err.message || 'Önizleme alınamadı';
    throw err;
  }
};
window.updateBulkPricePreview = updateBulkPricePreview;

function migrationSchedulePricePreview() {
  clearTimeout(migrationPricePreviewTimer);
  migrationPricePreviewTimer = setTimeout(() => {
    updateBulkPricePreview().catch(() => {});
  }, 350);
}

[el.bulkPriceCategory, el.bulkPriceField, el.bulkPriceMode].forEach(node => {
  node?.addEventListener('change', migrationSchedulePricePreview);
});
el.bulkPriceAmount?.addEventListener('input', migrationSchedulePricePreview);

applyCategoryPriceUpdate = async function() {
  if (!requireRoleAction(['admin'], 'Toplu fiyat güncellemesini sadece Admin yapabilir')) return;

  const body = migrationPriceRequestBody();
  if (!body.category) return showToast('Önce kategori seç', true);
  if (!migrationPriceAmountIsValid(body.mode, body.amount)) {
    return showToast(
      body.mode === 'fixed'
        ? "Sabit değişim 0 olamaz. Düşürmek için örn. -5000 yazabilirsin."
        : "Yüzde artış 0'dan büyük olmalı",
      true
    );
  }

  try {
    setLoading(true);
    const previewPayload = await apiFetch('/api/category-price-update/preview', {
      method: 'POST',
      body
    });
    const preview = previewPayload?.preview;
    if (!preview) throw new Error('Önizleme alınamadı');
    migrationLastPricePreview = preview;
    if (el.bulkPricePreview) el.bulkPricePreview.textContent = migrationPricePreviewText(preview);

    const field = String(preview.field || body.field);
    const zeroCount = field === 'purchase_price'
      ? Number(preview.zero_purchase_count || 0)
      : field === 'average_sale_price'
        ? Number(preview.zero_sale_count || 0)
        : Math.max(Number(preview.zero_purchase_count || 0), Number(preview.zero_sale_count || 0));
    let zeroWarning = '';
    if (preview.mode === 'percent' && zeroCount) {
      zeroWarning = `\n\n${zeroCount} üründe seçili fiyatlardan en az biri 0. Yüzde artışta 0 kalır.`;
    } else if (preview.mode === 'fixed' && Number(preview.amount || 0) > 0 && zeroCount) {
      zeroWarning = `\n\n${zeroCount} üründe seçili fiyatlardan en az biri 0. Sabit artışta girilen tutar eklenir.`;
    } else if (preview.mode === 'fixed' && Number(preview.amount || 0) < 0) {
      zeroWarning = `\n\n0 TL'nin altına düşecek fiyatlar otomatik olarak 0 TL'de durdurulur.`;
    }

    const currentValue = field === 'purchase_price'
      ? formatTL(preview.current_purchase_value || 0)
      : field === 'average_sale_price'
        ? formatTL(preview.current_sale_value || 0)
        : `${formatTL(preview.current_purchase_value || 0)} alış / ${formatTL(preview.current_sale_value || 0)} satış`;
    const nextValue = field === 'purchase_price'
      ? formatTL(preview.next_purchase_value || 0)
      : field === 'average_sale_price'
        ? formatTL(preview.next_sale_value || 0)
        : `${formatTL(preview.next_purchase_value || 0)} alış / ${formatTL(preview.next_sale_value || 0)} satış`;

    const ok = await appConfirm(
      `${preview.category} kategorisindeki ${Number(preview.affected_products || 0)} ürünün ${migrationPriceFieldLabel(field)} ${migrationPriceChangeSentence(preview.mode, Number(preview.amount || 0))}.\n\nStok değeri: ${currentValue} → ${nextValue}${zeroWarning}\n\nDevam edilsin mi?`,
      { title: 'Toplu fiyat güncelleme', okText: 'Güncelle' }
    );
    if (!ok) return;

    const resultPayload = await apiFetch('/api/category-price-update/apply', {
      method: 'POST',
      body: {
        ...body,
        confirm_count: Number(preview.affected_products || 0)
      }
    });

    const updated = Number(resultPayload?.result?.updated_products || 0);
    showToast(`${updated} ürünün fiyatı güncellendi ✅`);
    if (el.bulkPriceAmount) el.bulkPriceAmount.value = '';
    migrationLastPricePreview = null;
    await loadCategoryValues();
    if (el.bulkPricePreview) el.bulkPricePreview.textContent = 'Kategori ve tutar seçildiğinde işlem özeti burada görünür.';
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Toplu fiyat güncellemesi başarısız oldu', true);
  } finally {
    setLoading(false);
  }
};
window.applyCategoryPriceUpdate = applyCategoryPriceUpdate;


// ---- v10.2 Kategori içinden ürün bazlı fiyat düzenleme + sabit fiyat düşürme ----
let migrationCategoryPriceEditorCategory = '';
let migrationCategoryPriceEditorRows = [];
let migrationCategoryPriceEditorTimer = null;

window.openCategoryPriceEditorFromButton = function(button) {
  const category = String(button?.dataset?.category || '').trim();
  return openCategoryPriceEditor(category);
};

window.openCategoryPriceEditor = async function(category) {
  if (!requireRoleAction(['admin'], 'Ürün fiyatlarını sadece Admin düzenleyebilir')) return;
  migrationCategoryPriceEditorCategory = String(category || '').trim();
  if (!migrationCategoryPriceEditorCategory) return showToast('Kategori bulunamadı', true);

  const modal = document.getElementById('categoryPriceEditorModal');
  const categoryInput = document.getElementById('categoryPriceEditorCategory');
  const title = document.getElementById('categoryPriceEditorTitle');
  const search = document.getElementById('categoryPriceEditorSearch');
  if (categoryInput) categoryInput.value = migrationCategoryPriceEditorCategory;
  if (title) title.textContent = `${migrationCategoryPriceEditorCategory} · ürün bazlı alış / satış fiyatı düzenleme`;
  if (search) search.value = '';
  modal?.classList.remove('hidden');
  await loadCategoryPriceEditorProducts();
};

window.closeCategoryPriceEditor = function() {
  document.getElementById('categoryPriceEditorModal')?.classList.add('hidden');
  migrationCategoryPriceEditorRows = [];
};

window.scheduleCategoryPriceEditorSearch = function() {
  clearTimeout(migrationCategoryPriceEditorTimer);
  migrationCategoryPriceEditorTimer = setTimeout(() => {
    loadCategoryPriceEditorProducts().catch(() => {});
  }, 350);
};

window.loadCategoryPriceEditorProducts = async function() {
  if (!migrationCategoryPriceEditorCategory) return;
  const list = document.getElementById('categoryPriceEditorList');
  const info = document.getElementById('categoryPriceEditorInfo');
  const q = String(document.getElementById('categoryPriceEditorSearch')?.value || '').trim();
  if (list) list.innerHTML = '<div class="empty-state">Ürünler yükleniyor...</div>';
  if (info) info.textContent = 'Aranıyor...';

  try {
    const params = new URLSearchParams();
    params.set('category', migrationCategoryPriceEditorCategory);
    if (q) params.set('q', q);
    params.set('limit', '100');
    const payload = await apiFetch('/api/products?' + params.toString());
    migrationCategoryPriceEditorRows = (payload.products || []).map(mapProduct);
    renderCategoryPriceEditorProducts();
  } catch (err) {
    if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Ürünler alınamadı')}</div>`;
    if (info) info.textContent = 'Yükleme başarısız';
  }
};

function renderCategoryPriceEditorProducts() {
  const list = document.getElementById('categoryPriceEditorList');
  const info = document.getElementById('categoryPriceEditorInfo');
  if (!list) return;
  const rows = migrationCategoryPriceEditorRows || [];
  if (info) info.textContent = rows.length >= 100
    ? 'İlk 100 sonuç gösteriliyor. Daha hızlı bulmak için arama kutusunu kullan.'
    : `${rows.length} ürün bulundu.`;

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">Bu aramada ürün bulunamadı.</div>';
    return;
  }

  list.innerHTML = `
    <div class="table-wrap">
      <table class="category-price-editor-table">
        <thead><tr><th>Ürün</th><th>Alış Fiyatı</th><th>Ort. Satış Fiyatı</th><th>İşlem</th></tr></thead>
        <tbody>${rows.map(p => `
          <tr data-price-row="${escapeHtml(String(p.id))}">
            <td>
              <strong>${escapeHtml(p.name || p.category || '-')}</strong>
              <div class="category-price-editor-meta">${escapeHtml([p.productBrand, p.carBrand, p.carModel, p.carType, p.vehicleYear].filter(Boolean).join(' · '))}</div>
            </td>
            <td><input data-price-purchase type="number" min="0" step="0.01" value="${Number(p.purchasePrice || 0)}"></td>
            <td><input data-price-sale type="number" min="0" step="0.01" value="${Number(p.averageSalePrice || 0)}"></td>
            <td>
              <div class="action-group">
                <button class="action-btn edit" type="button" onclick="saveCategoryPriceEditorProduct('${escapeHtml(String(p.id))}', this)">Kaydet</button>
                <button class="action-btn" type="button" style="background:#475569" onclick="openFullProductFromPriceEditor('${escapeHtml(String(p.id))}')">Kartı Aç</button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

window.saveCategoryPriceEditorProduct = async function(productId, button) {
  if (!requireRoleAction(['admin'], 'Ürün fiyatlarını sadece Admin düzenleyebilir')) return;
  const tr = button?.closest?.('tr');
  if (!tr) return;
  const purchase = Number(tr.querySelector('[data-price-purchase]')?.value || 0);
  const sale = Number(tr.querySelector('[data-price-sale]')?.value || 0);
  if (!Number.isFinite(purchase) || !Number.isFinite(sale) || purchase < 0 || sale < 0) {
    return showToast('Fiyatlar 0 veya daha büyük olmalı', true);
  }

  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = 'Kaydediliyor...';
  try {
    const payload = await apiFetch('/api/products/' + encodeURIComponent(productId), {
      method: 'PATCH',
      body: {
        purchase_price: Math.round((purchase + Number.EPSILON) * 100) / 100,
        average_sale_price: Math.round((sale + Number.EPSILON) * 100) / 100
      }
    });
    const fresh = payload?.product ? mapProduct(payload.product) : null;
    if (fresh) {
      const idx = migrationCategoryPriceEditorRows.findIndex(p => String(p.id) === String(productId));
      if (idx >= 0) migrationCategoryPriceEditorRows[idx] = fresh;
      await refreshMigrationProductState(productId, { product: payload.product }).catch(() => {});
    }
    await logActivity(
      'product_price_update',
      `${fresh?.name || 'Ürün'} fiyatı düzenlendi · Alış: ${formatTL(purchase)} · Ort. Satış: ${formatTL(sale)}`,
      'stock_products',
      productId
    ).catch(() => {});
    showToast('Ürün fiyatı güncellendi ✅');
    await loadCategoryValues();
  } catch (err) {
    showToast(err.message || 'Fiyat güncellenemedi', true);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
};

window.openFullProductFromPriceEditor = function(productId) {
  const product = migrationCategoryPriceEditorRows.find(p => String(p.id) === String(productId));
  if (!product) return showToast('Ürün bulunamadı', true);
  state.products = [product, ...(state.products || []).filter(p => String(p.id) !== String(productId))];
  closeCategoryPriceEditor();
  editProduct(productId);
};

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


// === Migration Test v7 - Sipariş Havuzu + Verilen Siparişler ===
function migrationPurchaseDraftItem(row) {
  return {
    productId: row.product_id,
    name: row.product_name || row.category || "Ürün",
    productBrand: row.product_brand || "",
    category: row.category || "",
    detail: [
      row.product_brand,
      row.category,
      row.vehicle_brand,
      row.vehicle_model,
      row.vehicle_type,
      row.vehicle_year
    ].filter(Boolean).join(" · "),
    quantity: Number(row.quantity || 1),
    supplierHint: row.supplier_hint || row.product_brand || "",
    note: row.note || ""
  };
}

loadSharedPurchaseOrderDraft = async function() {
  if (!el.purchaseDraftList) return [];
  try {
    const payload = await apiFetch("/api/purchase-order-draft");
    state.purchaseOrderDraft = (payload.items || []).map(migrationPurchaseDraftItem);
    renderPurchaseOrderDraft();
    return state.purchaseOrderDraft;
  } catch (err) {
    console.error(err);
    el.purchaseDraftList.innerHTML = `<div class="empty-state">${escapeHtml(err.message || "Sipariş havuzu alınamadı")}</div>`;
    throw err;
  }
};
window.loadSharedPurchaseOrderDraft = loadSharedPurchaseOrderDraft;

// Supabase Realtime yerine manuel yenileme kullanıyoruz.
subscribeSharedPurchaseOrderDraft = function() {};
window.subscribeSharedPurchaseOrderDraft = subscribeSharedPurchaseOrderDraft;

window.addProductToPurchaseOrder = async function(productId) {
  if (!requireUserAction("addToOrderPool", "Sipariş havuzuna ekleme yetkin yok")) return;
  const p = purchaseProductById(productId);
  if (!p) return showToast("Ürün bulunamadı", true);
  if (!canAccessCategory(p.category)) return showToast("Bu ürün kategorisine yetkin yok", true);
  const qty = Math.max(1, Math.floor(Number(getOperationQty(productId) || 1)));
  try {
    setLoading(true);
    await apiFetch("/api/purchase-order-draft", {
      method: "POST",
      body: { product_id: productId, quantity: qty }
    });
    await loadSharedPurchaseOrderDraft();
    showToast(`${p.name || p.category || "Ürün"} sipariş havuzuna eklendi ✅`);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Ürün havuza eklenemedi", true);
  } finally { setLoading(false); }
};

window.setPurchaseOrderItemQty = async function(productId, value) {
  const qty = Math.max(1, Math.floor(Number(value || 1)));
  try {
    await apiFetch(`/api/purchase-order-draft/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: { quantity: qty }
    });
    await loadSharedPurchaseOrderDraft();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Sipariş miktarı güncellenemedi", true);
    await loadSharedPurchaseOrderDraft().catch(() => {});
  }
};

window.setPurchaseDraftSupplier = async function(productId, value) {
  try {
    await apiFetch(`/api/purchase-order-draft/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: { supplier_hint: String(value || "").trim() }
    });
    const row = state.purchaseOrderDraft.find(x => String(x.productId) === String(productId));
    if (row) row.supplierHint = String(value || "").trim();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Tedarikçi güncellenemedi", true);
  }
};

window.removePurchaseOrderItem = async function(productId) {
  try {
    setLoading(true);
    await apiFetch(`/api/purchase-order-draft/${encodeURIComponent(productId)}`, {
      method: "DELETE"
    });
    await loadSharedPurchaseOrderDraft();
    showToast("Ürün sipariş havuzundan kaldırıldı");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Ürün havuzdan kaldırılamadı", true);
  } finally { setLoading(false); }
};

// Migration testte gerçek havuz kayıtları bulunduğu için toplu temizleme kapalı.
window.clearPurchaseOrderDraft = async function() {
  showToast("Migration testte havuzu toplu temizleme güvenlik nedeniyle kapalı. Ürünleri tek tek kaldırabilirsin.", true);
};

window.createGroupedPurchaseOrder = async function() {
  const ids = selectedPurchaseGroupIds();
  if (!ids.length) return showToast("En az bir ürün seç", true);
  const supplier = String(el.purchaseGroupSupplier?.value || "").trim();
  if (!supplier) return showToast("Tedarikçi adını yaz", true);
  const expectedDate = String(el.purchaseGroupExpectedDate?.value || "").trim();
  const note = String(el.purchaseGroupNote?.value || "").trim();
  const selected = state.purchaseOrderDraft.filter(x => ids.includes(String(x.productId)));
  if (!(await appConfirm(`${supplier} için ${selected.length} kalem sipariş oluşturulsun mu?`, { okText: "Sipariş Oluştur" }))) return;
  try {
    setLoading(true);
    const payload = await apiFetch("/api/purchase-orders", {
      method: "POST",
      body: {
        supplier,
        expected_date: expectedDate || null,
        note: note || null,
        product_ids: ids
      }
    });
    closePurchaseOrderGroupModal();
    await Promise.all([loadSharedPurchaseOrderDraft(), loadPurchaseOrders()]);
    showToast(`Sipariş oluşturuldu: ${payload.order?.order_no || "Yeni sipariş"} ✅`);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Sipariş oluşturulamadı", true);
  } finally { setLoading(false); }
};
window.savePurchaseOrder = window.createGroupedPurchaseOrder;

loadPurchaseOrders = async function() {
  if (!el.purchaseOrderList) return [];
  try {
    const payload = await apiFetch("/api/purchase-orders?limit=100");
    state.purchaseOrders = payload.orders || [];
    renderPurchaseOrders();
    return state.purchaseOrders;
  } catch (err) {
    console.error(err);
    el.purchaseOrderList.innerHTML = `<div class="empty-state">${escapeHtml(err.message || "Siparişler alınamadı")}</div>`;
    throw err;
  }
};
window.loadPurchaseOrders = loadPurchaseOrders;

window.receivePurchaseOrderPartial = async function(orderId) {
  const inputs = [...document.querySelectorAll(`[data-receive-order="${orderId}"]`)];
  const lines = inputs
    .map(x => ({ item_id: x.dataset.receiveItem, quantity: Math.floor(Number(x.value || 0)) }))
    .filter(x => x.quantity > 0);
  if (!lines.length) return showToast("Gelen adetleri yaz", true);
  if (!(await appConfirm(`${lines.length} kalem için girilen miktarlar stoğa işlensin mi?`, { okText: "Stoğa İşle" }))) return;
  try {
    setLoading(true);
    await apiFetch(`/api/purchase-orders/${encodeURIComponent(orderId)}/receive`, {
      method: "POST",
      body: { lines }
    });
    await Promise.allSettled([loadPurchaseOrders(), loadDashboardStats(), loadMovements()]);
    showToast("Gelen ürünler stoğa işlendi ✅");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Kısmi giriş yapılamadı", true);
  } finally { setLoading(false); }
};

window.receivePurchaseOrderAll = async function(orderId) {
  const order = state.purchaseOrders.find(o => String(o.id) === String(orderId));
  if (!order) return showToast("Sipariş bulunamadı", true);
  const remaining = (order.purchase_order_items || [])
    .reduce((sum, i) => sum + Math.max(Number(i.ordered_quantity || 0) - Number(i.received_quantity || 0), 0), 0);
  if (!remaining) return showToast("Bu siparişte bekleyen ürün yok", true);
  if (!(await appConfirm(`Siparişte kalan toplam ${remaining} ürün stoğa işlensin mi?`, { okText: "Tamamını Al" }))) return;
  try {
    setLoading(true);
    await apiFetch(`/api/purchase-orders/${encodeURIComponent(orderId)}/receive-all`, {
      method: "POST"
    });
    await Promise.allSettled([loadPurchaseOrders(), loadDashboardStats(), loadMovements()]);
    showToast("Siparişin kalanının tamamı stoğa işlendi ✅");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Sipariş stoğa işlenemedi", true);
  } finally { setLoading(false); }
};
window.receivePurchaseOrder = window.receivePurchaseOrderAll;

window.cancelPurchaseOrder = async function(orderId) {
  const order = state.purchaseOrders.find(o => String(o.id) === String(orderId));
  if (!order) return showToast("Sipariş bulunamadı", true);
  if (!(await appConfirm(`${order.order_no || "Sipariş"} iptal edilsin mi? Stok değişmeyecek.`, { danger: true, okText: "İptal Et" }))) return;
  try {
    setLoading(true);
    await apiFetch(`/api/purchase-orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "PATCH"
    });
    await loadPurchaseOrders();
    showToast("Sipariş iptal edildi");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Sipariş iptal edilemedi", true);
  } finally { setLoading(false); }
};


// ============================================================
// Migration Test v8.0 - Kullanıcılar / Yetkiler / Ayarlar
// ============================================================
const migrationUserIdByUsername = new Map();

function migrationUsernameKey(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function migrationUserIdFor(staff) {
  return migrationUserIdByUsername.get(migrationUsernameKey(staff?.username)) || "";
}

loadStaffListFromSupabase = async function() {
  const payload = await apiFetch("/api/users");
  migrationUserIdByUsername.clear();
  const rows = (payload.users || []).filter(row => row?.is_active !== false);
  rows.forEach(row => {
    if (row?.username && row?.id) migrationUserIdByUsername.set(migrationUsernameKey(row.username), row.id);
  });
  const cleaned = cleanStaffList(rows.map(row => normalizeStaffItem({
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
  const freshCurrent = cleaned.find(x =>
    (state.currentUser?.username && migrationUsernameKey(x.username) === migrationUsernameKey(state.currentUser.username)) ||
    (state.currentUser?.name && normalizeText(x.name) === normalizeText(state.currentUser.name))
  );
  if (freshCurrent) state.currentUser = { ...state.currentUser, ...freshCurrent };
  renderUsersList();
  renderUserCategoryPermissions();
  return cleaned;
};

renderUsersList = function() {
  if (!el.usersList) return;
  const staff = readStaffList();
  if (!staff.length) {
    el.usersList.innerHTML = `<div class="empty-state">Aktif personel bulunamadı</div>`;
    return;
  }
  el.usersList.innerHTML = staff.map(s => {
    const seen = s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : 0;
    const online = !!seen && Date.now() - seen < 2 * 60 * 1000;
    return `<div class="user-row ${online ? "online" : ""}">
      <div class="user-avatar">${escapeHtml((s.name || "?").slice(0,1).toLocaleUpperCase("tr-TR"))}</div>
      <div>
        <strong>${escapeHtml(s.name || "-")}</strong>
        <div class="muted">@${escapeHtml(s.username || "-")} · ${escapeHtml(roleLabel(s.role))}</div>
        <div class="muted">Son giriş: ${s.lastLoginAt ? formatDate(s.lastLoginAt) : "-"}</div>
        <div class="muted">Son görünme: ${s.lastSeenAt ? formatDate(s.lastSeenAt) : "-"}</div>
      </div>
      <span class="user-status">${online ? "Çevrimiçi" : "Aktif"}</span>
    </div>`;
  }).join("");
};
window.renderUsersList = renderUsersList;

function migrationStaffEditorRow(item = {}) {
  const s = normalizeStaffItem(item);
  const userId = migrationUserIdFor(s);
  const isCurrent = migrationUsernameKey(s.username) === migrationUsernameKey(state.currentUser?.username);
  return `<div class="staff-editor-row migration-staff-editor-row" data-staff-row data-user-id="${escapeHtml(userId)}">
    <input data-staff-username value="${escapeHtml(s.username || "")}" placeholder="Kullanıcı adı" autocomplete="off" />
    <input data-staff-name value="${escapeHtml(s.name || "")}" placeholder="Personel adı" />
    <select data-staff-role>
      <option value="admin" ${s.role === "admin" ? "selected" : ""}>Admin</option>
      <option value="kasa" ${s.role === "kasa" ? "selected" : ""}>Kasa</option>
      <option value="satis" ${s.role === "satis" ? "selected" : ""}>Satış</option>
      <option value="depo" ${s.role === "depo" ? "selected" : ""}>Depo</option>
      <option value="usta" ${s.role === "usta" ? "selected" : ""}>Usta</option>
    </select>
    <input data-staff-password type="password" value="" placeholder="${userId ? "Değiştirmek için yeni şifre" : "Yeni şifre (min. 4)"}" autocomplete="new-password" />
    <button type="button" class="btn danger" ${isCurrent ? "disabled title=\"Kendi hesabını pasifleştiremezsin\"" : ""} onclick="migrationDeactivateStaffRow(this)">${userId ? "Pasife Al" : "Satırı Sil"}</button>
  </div>`;
}

window.openStaffEditor = async function() {
  if (!requireRoleAction(["admin"], "Personel yönetimi sadece Admin")) return;
  if (!el.staffEditor || !el.staffEditorBody) return;
  try {
    setLoading(true);
    await loadStaffListFromSupabase();
    el.staffEditorBody.innerHTML = readStaffList().map(migrationStaffEditorRow).join("");
    setStaffEditorMessage("Personel değişiklikleri doğrudan PostgreSQL migration-test veritabanına kaydedilir.", "info");
    el.staffEditor.classList.remove("hidden");
  } catch (err) {
    showToast(err?.message || "Personeller yüklenemedi", true);
  } finally { setLoading(false); }
};

window.addStaffEditorRow = function() {
  if (!el.staffEditorBody) return;
  el.staffEditorBody.insertAdjacentHTML("beforeend", migrationStaffEditorRow({ name: "", username: "", role: "kasa" }));
  setStaffEditorMessage("Yeni personel için kullanıcı adı, ad, rol ve en az 4 karakterli şifre gir.", "info");
};

window.migrationDeactivateStaffRow = async function(button) {
  const row = button?.closest?.("[data-staff-row]");
  if (!row) return;
  const userId = String(row.dataset.userId || "").trim();
  if (!userId) { row.remove(); return; }
  const name = String(row.querySelector("[data-staff-name]")?.value || "Personel").trim();
  if (!(await appConfirm(`${name} pasife alınsın mı? Artık giriş yapamayacak.`, { danger: true, okText: "Pasife Al" }))) return;
  try {
    setLoading(true);
    await apiFetch(`/api/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { is_active: false } });
    await loadStaffListFromSupabase();
    el.staffEditorBody.innerHTML = readStaffList().map(migrationStaffEditorRow).join("");
    showToast(`${name} pasife alındı ✅`);
  } catch (err) { showToast(err?.message || "Personel pasife alınamadı", true); }
  finally { setLoading(false); }
};

window.saveStaffEditor = async function() {
  if (!requireRoleAction(["admin"], "Personel yönetimi sadece Admin")) return;
  const rows = [...(el.staffEditorBody?.querySelectorAll("[data-staff-row]") || [])];
  if (!rows.length) return;
  const saveButton = document.getElementById("saveStaffEditorBtn");
  const seenUsers = new Set();
  for (const row of rows) {
    const username = String(row.querySelector("[data-staff-username]")?.value || "").trim();
    const name = String(row.querySelector("[data-staff-name]")?.value || "").replace(/\s+/g," ").trim();
    const role = String(row.querySelector("[data-staff-role]")?.value || "kasa");
    const password = String(row.querySelector("[data-staff-password]")?.value || "");
    const userId = String(row.dataset.userId || "").trim();
    if (!username || username.length < 3) return setStaffEditorMessage("Her personel için en az 3 karakterli kullanıcı adı gerekli.", "error");
    if (!/^[A-Za-z0-9._-]+$/.test(username)) return setStaffEditorMessage(`${username}: kullanıcı adında yalnızca harf, rakam, nokta, alt çizgi ve tire kullanılabilir.`, "error");
    if (!name) return setStaffEditorMessage("Personel adı boş bırakılamaz.", "error");
    const key = migrationUsernameKey(username);
    if (seenUsers.has(key)) return setStaffEditorMessage(`${username} kullanıcı adı listede iki kez kullanılmış.`, "error");
    seenUsers.add(key);
    if (!userId && password.length < 4) return setStaffEditorMessage(`${name} için en az 4 karakterli şifre gir.`, "error");
  }

  try {
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Kaydediliyor…"; }
    setStaffEditorMessage("Personel hesapları kaydediliyor…", "info");
    for (const row of rows) {
      const username = String(row.querySelector("[data-staff-username]")?.value || "").trim();
      const name = String(row.querySelector("[data-staff-name]")?.value || "").replace(/\s+/g," ").trim();
      const role = String(row.querySelector("[data-staff-role]")?.value || "kasa");
      const password = String(row.querySelector("[data-staff-password]")?.value || "");
      const userId = String(row.dataset.userId || "").trim();
      if (userId) {
        await apiFetch(`/api/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { username, name, role, is_active: true } });
        if (password) await apiFetch(`/api/users/${encodeURIComponent(userId)}/password`, { method: "PATCH", body: { password } });
      } else {
        const created = await apiFetch("/api/users", { method: "POST", body: {
          username, name, role, password, is_active: true,
          allowed_categories: [],
          permissions: { stockIn: true, stockOut: true, themeSettings: false, addToOrderPool: true }
        }});
        if (created?.user?.id) row.dataset.userId = created.user.id;
      }
    }
    await loadStaffListFromSupabase();
    renderStaffSelector();
    renderUserCategoryPermissions();
    el.staffEditorBody.innerHTML = readStaffList().map(migrationStaffEditorRow).join("");
    setStaffEditorMessage("Personel hesapları kaydedildi ✅", "info");
    showToast("Personel hesapları kaydedildi ✅");
  } catch (err) {
    setStaffEditorMessage(err?.message || "Personel kaydedilemedi", "error");
    showToast(err?.message || "Personel kaydedilemedi", true);
  } finally {
    if (saveButton) { saveButton.disabled = false; saveButton.textContent = "Kaydet"; }
  }
};

window.resetStaffEditor = async function() {
  showToast("Migration testte toplu personel sıfırlama güvenlik nedeniyle kapalı.", true);
};

window.saveUserCategoryPermissions = async function() {
  if (!requireRoleAction(["admin"], "Kategori yetkilerini sadece Admin düzenleyebilir")) return;
  try {
    setLoading(true);
    const list = readStaffList();
    const cards = [...document.querySelectorAll('[data-user-permission-card]')];
    for (const card of cards) {
      const user = list.find(s => s.name === card.dataset.userPermissionCard);
      if (!user) continue;
      const userId = migrationUserIdFor(user);
      if (!userId) continue;
      const allowed_categories = [...card.querySelectorAll('[data-user-category]:checked')].map(x => x.value);
      const permissions = {};
      card.querySelectorAll('[data-user-action]').forEach(x => permissions[x.dataset.userAction] = x.checked);
      await apiFetch(`/api/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { allowed_categories, permissions } });
    }
    await loadStaffListFromSupabase();
    renderUserCategoryPermissions();
    applyRoleVisibility();
    await logActivity("user_category_permissions", "Personel kategori ve işlem yetkileri PostgreSQL'e kaydedildi", "app_users", "permissions");
    showToast("Kategori ve işlem yetkileri kaydedildi ✅");
  } catch (err) { showToast(err?.message || "Yetkiler kaydedilemedi", true); }
  finally { setLoading(false); }
};

window.saveRolePermissions = async function() {
  if (!requireRoleAction(["admin"], "Menü yetkilerini sadece Admin düzenleyebilir")) return;
  const current = readRolePermissions();
  ["depo", "kasa", "satis", "usta"].forEach(role => {
    current[role] = [...document.querySelectorAll(`[data-role-permission="${role}"]:checked`)].map(input => input.value);
  });
  try {
    setLoading(true);
    const payload = await apiFetch("/api/settings/role-permissions", { method: "PUT", body: { value: current } });
    const saved = normalizeRolePermissions(payload.setting?.value || current);
    localStorage.setItem(ROLE_PERMISSION_STORE_KEY, JSON.stringify(saved));
    applyRoleVisibility();
    renderRolePermissionEditor();
    showToast("Menü yetkileri kaydedildi ✅");
  } catch (err) { showToast(err?.message || "Menü yetkileri kaydedilemedi", true); }
  finally { setLoading(false); }
};

saveRolePermissionsToSupabase = async function(permissions) {
  const payload = await apiFetch("/api/settings/role-permissions", { method: "PUT", body: { value: permissions } });
  return payload.setting?.value || permissions;
};

window.resetRolePermissions = async function() {
  if (!requireRoleAction(["admin"], "Menü yetkilerini sadece Admin sıfırlayabilir")) return;
  if (!(await appConfirm("Menü yetkileri varsayılana dönsün mü?", { danger: true, okText: "Varsayılana Dön" }))) return;
  try {
    setLoading(true);
    const defaults = normalizeRolePermissions(DEFAULT_ROLE_PERMISSIONS);
    const saved = await saveRolePermissionsToSupabase(defaults);
    localStorage.setItem(ROLE_PERMISSION_STORE_KEY, JSON.stringify(normalizeRolePermissions(saved)));
    applyRoleVisibility();
    renderRolePermissionEditor();
    showToast("Menü yetkileri varsayılana döndü ✅");
  } catch (err) { showToast(err?.message || "Menü yetkileri sıfırlanamadı", true); }
  finally { setLoading(false); }
};

// Settings sekmesi sadece tema/yerel görüntü ayarlarını kullanır; Supabase yazma çağrıları migration testte yoktur.


// ---- v11 Yönetim / SİLİNECEK toplu ürün temizleme ----
state.migrationDeleteMarkedPreview = state.migrationDeleteMarkedPreview || null;

function renderMigrationDeleteMarkedPreview(preview) {
  const p = preview || {};
  const countEl = document.getElementById("deleteMarkedCount");
  const infoEl = document.getElementById("deleteMarkedInfo");
  const detailsEl = document.getElementById("deleteMarkedPreviewDetails");
  const deleteBtn = document.getElementById("deleteMarkedProductsBtn");

  const productCount = Number(p.product_count || 0);
  if (countEl) countEl.textContent = String(productCount);

  const values = {
    deleteMarkedMovementCount: Number(p.movement_count || 0),
    deleteMarkedReservationCount: Number(p.reservation_count || 0),
    deleteMarkedDraftCount: Number(p.draft_item_count || 0),
    deleteMarkedPurchaseItemCount: Number(p.purchase_item_count || 0),
    deleteMarkedStockCount: Number(p.total_stock || 0),
    deleteMarkedReservedCount: Number(p.total_reserved || 0)
  };
  Object.entries(values).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  });

  if (detailsEl) detailsEl.classList.toggle("hidden", productCount <= 0);

  if (infoEl) {
    infoEl.textContent = productCount
      ? `${productCount} ürün kalıcı silmeye hazır. Yalnızca Ürün Markası "SİLİNECEK" olanlar silinecek.`
      : `Ürün Markası "SİLİNECEK" olan ürün bulunamadı.`;
  }

  if (deleteBtn) deleteBtn.disabled = productCount <= 0;
}

loadDeleteMarkedCount = async function() {
  const countEl = document.getElementById("deleteMarkedCount");
  const infoEl = document.getElementById("deleteMarkedInfo");
  const detailsEl = document.getElementById("deleteMarkedPreviewDetails");
  const deleteBtn = document.getElementById("deleteMarkedProductsBtn");

  if (countEl) countEl.textContent = "...";
  if (infoEl) infoEl.textContent = "SİLİNECEK ürünler ve bağlı kayıtlar kontrol ediliyor...";
  if (detailsEl) detailsEl.classList.add("hidden");
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    const payload = await apiFetch("/api/management/delete-marked/preview");
    const preview = payload.preview || {};
    state.migrationDeleteMarkedPreview = preview;
    renderMigrationDeleteMarkedPreview(preview);
    return Number(preview.product_count || 0);
  } catch (err) {
    state.migrationDeleteMarkedPreview = null;
    if (countEl) countEl.textContent = "!";
    if (infoEl) infoEl.textContent = err.message || "SİLİNECEK ürün önizlemesi alınamadı.";
    showToast(err.message || "SİLİNECEK ürün önizlemesi alınamadı", true);
    return 0;
  }
};
window.loadDeleteMarkedCount = loadDeleteMarkedCount;

deleteMarkedProducts = async function() {
  if (!requireRoleAction(["admin"], "Toplu silme işlemini sadece Admin yapabilir")) return;

  const deleteBtn = document.getElementById("deleteMarkedProductsBtn");
  const infoEl = document.getElementById("deleteMarkedInfo");

  try {
    const count = await loadDeleteMarkedCount();
    const preview = state.migrationDeleteMarkedPreview || {};
    if (!count) return;

    const summary = [
      `${count} ürün kalıcı olarak silinecek.`,
      `Stok hareketi: ${Number(preview.movement_count || 0)}`,
      `Rezervasyon: ${Number(preview.reservation_count || 0)}`,
      `Sipariş havuzu: ${Number(preview.draft_item_count || 0)}`,
      `Verilmiş sipariş kalemi: ${Number(preview.purchase_item_count || 0)}`,
      `Toplam stok: ${Number(preview.total_stock || 0)}`,
      `Rezerve stok: ${Number(preview.total_reserved || 0)}`,
      "",
      `Yalnızca Ürün Markası "SİLİNECEK" olan kayıtlar hedeflenir.`,
      `Bu işlem geri alınamaz.`
    ].join("\n");

    const firstOk = await appConfirm(summary, {
      title: "SİLİNECEK Ürünleri Önizle",
      okText: "Devam Et",
      cancelText: "Vazgeç",
      danger: true
    });
    if (!firstOk) return;

    const typed = await appPrompt(
      `Son onay için SİLİNECEK yaz.`,
      "",
      {
        title: "Kalıcı Silme Onayı",
        placeholder: "SİLİNECEK",
        okText: "Kalıcı Olarak Sil",
        cancelText: "İptal",
        danger: true
      }
    );
    if (typed === null) return;

    const normalized = String(typed || "").trim().toLocaleUpperCase("tr-TR");
    if (!["SİLİNECEK", "SILINECEK"].includes(normalized)) {
      return showToast('Onay için "SİLİNECEK" yazmalısın', true);
    }

    if (deleteBtn) deleteBtn.disabled = true;
    if (infoEl) infoEl.textContent = "Toplu silme uygulanıyor...";

    const payload = await apiFetch("/api/management/delete-marked/apply", {
      method: "POST",
      body: {
        confirm_count: count,
        confirm_text: "SİLİNECEK"
      }
    });

    const r = payload.result || {};

    // Server-side işlem logu zaten oluşuyor; burada ikinci bir log üretmiyoruz.
    state.migrationDeleteMarkedPreview = null;
    state.products = (state.products || []).filter(p =>
      String(p.productBrand || "").trim().toLocaleUpperCase("tr-TR") !== "SİLİNECEK" &&
      String(p.productBrand || "").trim().toUpperCase() !== "SILINECEK"
    );
    state.operationFilterOptionsLoaded = false;
    state.operationCacheKey = "";

    await Promise.allSettled([
      loadDashboardStats(),
      loadMovements(),
      loadOperationFilterOptions()
    ]);

    if (typeof updateStats === "function") updateStats();
    if (typeof refreshProductQuickLists === "function") refreshProductQuickLists();
    if (typeof refreshOperationFilters === "function") refreshOperationFilters();
    if (typeof renderOperationResults === "function") renderOperationResults();

    await loadDeleteMarkedCount();

    showToast(
      `${Number(r.deleted_products || count)} ürün kalıcı silindi ✅`
    );
  } catch (err) {
    console.error(err);
    showToast(err.message || "Toplu silme başarısız oldu", true);
    await loadDeleteMarkedCount().catch(() => {});
  } finally {
    if (deleteBtn) {
      const current = Number(state.migrationDeleteMarkedPreview?.product_count || 0);
      deleteBtn.disabled = current <= 0;
    }
  }
};
window.deleteMarkedProducts = deleteMarkedProducts;
