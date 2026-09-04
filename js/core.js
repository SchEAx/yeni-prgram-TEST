// Core: yapılandırma, state, DOM, yetkiler, bildirimler ve ortak yardımcılar
const APP_VERSION = '3.13.1-migration-test-jwt-14.2';
let isOffline = !navigator.onLine;
let globalLoading = false;

const VAPID_PUBLIC_KEY = "";
// Migration-test güvenlik kilidi: eski Supabase kodu dosyalarda dursa bile ağ isteği yapamaz.
const migrationDisabled = () => { throw new Error("Migration test: Bu özellik henüz PostgreSQL API'ye taşınmadı."); };
const supabaseClient = new Proxy({
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: migrationDisabled, getUser: migrationDisabled, signInWithPassword: migrationDisabled,
    signOut: migrationDisabled, updateUser: migrationDisabled
  },
  from: migrationDisabled, rpc: migrationDisabled, channel: migrationDisabled,
  storage: new Proxy({}, { get: () => migrationDisabled })
}, { get(target, prop) { return prop in target ? target[prop] : migrationDisabled; } });

const state = {
  products: [], filteredProducts: [], movements: [], stockRequests: [], requestFilter: "all",
  activeTab: "requests", loading: false, selectedStockRequestId: null, seenRequestIds: new Set(), realtimeReady: false, newRequestCount: 0,
highlightRequestIds: new Set(),
originalTitle: document.title,
  saleCart: [],
  lastQuickSale: null,
  operationQty: {},
  operationResults: [], operationSearchTimer: null, operationQuerySeq: 0, operationCacheKey: "",
  movementResults: [], movementSearchTimer: null, movementQuerySeq: 0,
  operationFilterOptionsLoaded: false, operationBrands: [], operationCategories: [],
  quickQty: {},
  notifications: [], notificationFilter: "all", unreadNotificationCount: 0, notificationTableReady: true,
  activityLogs: [], activityLogTableReady: true, authReady: false, currentUser: null,
  categoryValues: [], categoryValueRows: [],
  orderSuggestionRows: [],
  purchaseOrderDraft: [], purchaseOrders: [], purchaseGroupSeedProductId: null,
  criticalCategoryFilter: "all", criticalProductBrandFilter: "all", criticalCarBrandFilter: "all",
  orderSuggestionCategoryFilter: "all", orderSuggestionProductBrandFilter: "all", orderSuggestionCarBrandFilter: "all",
};

const el = {
  totalProductCount: document.getElementById("totalProductCount"), totalStockCount: document.getElementById("totalStockCount"), reservedStockCount: document.getElementById("reservedStockCount"), criticalStockCount: document.getElementById("criticalStockCount"),
  refreshBtn: document.getElementById("refreshBtn"), checkUpdateBtn: document.getElementById("checkUpdateBtn"), pwaInstallBtn: document.getElementById("pwaInstallBtn"), enableNotifyBtn: document.getElementById("enableNotifyBtn"), productForm: document.getElementById("productForm"), productId: document.getElementById("productId"), barcode: document.getElementById("barcode"),
  productBrand: document.getElementById("productBrand"), category: document.getElementById("category"), carBrand: document.getElementById("carBrand"), carModel: document.getElementById("carModel"), carType: document.getElementById("carType"), vehicleYear: document.getElementById("vehicleYear"), stock: document.getElementById("stock"), minStock: document.getElementById("minStock"), location: document.getElementById("location"), note: document.getElementById("note"),
  saveProductBtn: document.getElementById("saveProductBtn"), clearProductBtn: document.getElementById("clearProductBtn"), movementSearchInput: document.getElementById("movementSearchInput"), movementSearchList: document.getElementById("movementSearchList"), searchInput: document.getElementById("searchInput"), productTableBody: document.getElementById("productTableBody"), movementList: document.getElementById("movementList"),
  stockRequestsBox: document.getElementById("stockRequestsBox"), reservationPanel: document.getElementById("reservationPanel"), requestedTextBox: document.getElementById("requestedTextBox"), productSearchInput: document.getElementById("productSearchInput"), productMatchBox: document.getElementById("productMatchBox"), toast: document.getElementById("toast"),
  saleSearchInput: document.getElementById("saleSearchInput"), saleProductList: document.getElementById("saleProductList"), saleCartList: document.getElementById("saleCartList"), saleTotal: document.getElementById("saleTotal"), saleDiscount: document.getElementById("saleDiscount"), saleFinalTotal: document.getElementById("saleFinalTotal"), salePaymentType: document.getElementById("salePaymentType"), saleCustomerName: document.getElementById("saleCustomerName"),
saleCustomerPhone: document.getElementById("saleCustomerPhone"), saleCustomerNote: document.getElementById("saleCustomerNote"), completeSaleBtn: document.getElementById("completeSaleBtn"), clearSaleBtn: document.getElementById("clearSaleBtn"), todaySaleTotal: document.getElementById("todaySaleTotal"), todaySaleQty: document.getElementById("todaySaleQty"), todayCashTotal: document.getElementById("todayCashTotal"), todayCardTotal: document.getElementById("todayCardTotal"), topSaleProducts: document.getElementById("topSaleProducts"), currentStaffSelect: document.getElementById("currentStaffSelect"), staffRoleBadge: document.getElementById("staffRoleBadge"), staffEditor: document.getElementById("staffEditor"), staffEditorBody: document.getElementById("staffEditorBody"), printLastSaleBtn: document.getElementById("printLastSaleBtn"), cancelLastSaleBtn: document.getElementById("cancelLastSaleBtn"), productImage: document.getElementById("productImage"), reportStartDate: document.getElementById("reportStartDate"), reportEndDate: document.getElementById("reportEndDate"), reportSearchInput: document.getElementById("reportSearchInput"), criticalSearchInput: document.getElementById("criticalSearchInput"), historySearchInput: document.getElementById("historySearchInput"),
  operationBrandFilter: document.getElementById("operationBrandFilter"), operationCategoryFilter: document.getElementById("operationCategoryFilter"), operationSearchInput: document.getElementById("operationSearchInput"), operationResultBox: document.getElementById("operationResultBox"),
  notificationBellBtn: document.getElementById("notificationBellBtn"), notificationUnreadCount: document.getElementById("notificationUnreadCount"), notificationList: document.getElementById("notificationList"),
  loginOverlay: document.getElementById("loginOverlay"), appShell: document.getElementById("appShell"), loginStaffSelect: document.getElementById("loginStaffSelect"), loginPasswordInput: document.getElementById("loginPasswordInput"), loginBtn: document.getElementById("loginBtn"), logoutBtn: document.getElementById("logoutBtn"), activeUserName: document.getElementById("activeUserName"), activeUserRole: document.getElementById("activeUserRole"), usersList: document.getElementById("usersList"), activityLogList: document.getElementById("activityLogList"), rolePermissionEditor: document.getElementById("rolePermissionEditor"),
excelProductBrandFilter: document.getElementById("excelProductBrandFilter"),
excelCategoryFilter: document.getElementById("excelCategoryFilter"),
excelCarBrandFilter: document.getElementById("excelCarBrandFilter"),
excelFilterSummary: document.getElementById("excelFilterSummary"),
productImageFile: document.getElementById("productImageFile"),
productCameraFile: document.getElementById("productCameraFile"),
productCameraModal: document.getElementById("productCameraModal"),
productCameraVideo: document.getElementById("productCameraVideo"),
productCameraCanvas: document.getElementById("productCameraCanvas"),
productCameraMessage: document.getElementById("productCameraMessage"),
productCameraSwitchBtn: document.getElementById("productCameraSwitchBtn"),
productCameraCaptureBtn: document.getElementById("productCameraCaptureBtn"),
productImagePreview: document.getElementById("productImagePreview"),
productImageStatus: document.getElementById("productImageStatus"),
productImageRemoveBtn: document.getElementById("productImageRemoveBtn"),
productImageViewBtn: document.getElementById("productImageViewBtn"),
categoryValueForm: document.getElementById("categoryValueForm"),
categoryValueId: document.getElementById("categoryValueId"),
categoryValueCategory: document.getElementById("categoryValueCategory"),
categoryValuePurchase: document.getElementById("categoryValuePurchase"),
categoryValueSale: document.getElementById("categoryValueSale"),
categoryValueList: document.getElementById("categoryValueList"),
categoryValueSummary: document.getElementById("categoryValueSummary"),
categoryValueDetail: document.getElementById("categoryValueDetail"),
bulkPriceCategory: document.getElementById("bulkPriceCategory"),
bulkPriceField: document.getElementById("bulkPriceField"),
bulkPriceMode: document.getElementById("bulkPriceMode"),
bulkPriceAmount: document.getElementById("bulkPriceAmount"),
bulkPricePreview: document.getElementById("bulkPricePreview"),
productPurchasePrice: document.getElementById("productPurchasePrice"),
productAverageSalePrice: document.getElementById("productAverageSalePrice"),
managementCategoryBrandSummary: document.getElementById("managementCategoryBrandSummary"),
managementCategoryBrandList: document.getElementById("managementCategoryBrandList"),
purchaseSupplier: document.getElementById("purchaseSupplier"), purchaseExpectedDate: document.getElementById("purchaseExpectedDate"), purchaseOrderNote: document.getElementById("purchaseOrderNote"), purchaseDraftList: document.getElementById("purchaseDraftList"), purchaseDraftTotal: document.getElementById("purchaseDraftTotal"), purchaseOrderList: document.getElementById("purchaseOrderList"), purchaseOrderBadge: document.getElementById("purchaseOrderBadge"), savePurchaseOrderBtn: document.getElementById("savePurchaseOrderBtn"), purchaseGroupModal: document.getElementById("purchaseGroupModal"), purchaseGroupSupplier: document.getElementById("purchaseGroupSupplier"), purchaseGroupExpectedDate: document.getElementById("purchaseGroupExpectedDate"), purchaseGroupNote: document.getElementById("purchaseGroupNote"), purchaseGroupItemList: document.getElementById("purchaseGroupItemList"), purchaseGroupSelectedCount: document.getElementById("purchaseGroupSelectedCount")
};

// Performans notu: Ürün arama ekranlarında sadece görünen/gerekli kolonları çekiyoruz.
// Böylece özellikle tablet/WebView tarafında gereksiz veri ve RAM tüketimi azalır.
const STOCK_IMAGE_BUCKET = "product-images";
const STOCK_IMAGE_MAX_SIZE = 1200;
const STOCK_IMAGE_QUALITY = 0.72;
const STOCK_PRODUCT_SELECT = "id,barcode,product_name,product_brand,category,vehicle_brand,vehicle_model,vehicle_type,vehicle_year,quantity,reserved_quantity,min_stock,location,note,image_url,image_thumb_url,purchase_price,average_sale_price,created_at";


// APK/WebView içinde alert/confirm bazen çalışmadığı için uygulama içi onay penceresi.
function appConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("appConfirmOverlay");
    const titleEl = document.getElementById("appConfirmTitle");
    const msgEl = document.getElementById("appConfirmMessage");
    const okBtn = document.getElementById("appConfirmOk");
    const cancelBtn = document.getElementById("appConfirmCancel");
    if (!overlay || !msgEl || !okBtn || !cancelBtn) {
      // Son çare: tarayıcı confirm. Normalde APK'da buraya düşmemeli.
      resolve(window.confirm(String(message || "Devam edilsin mi?")));
      return;
    }
    titleEl.textContent = options.title || "Onay gerekiyor";
    msgEl.textContent = String(message || "Devam edilsin mi?");
    okBtn.textContent = options.okText || "Onayla";
    cancelBtn.textContent = options.cancelText || "İptal";
    okBtn.className = "btn " + (options.danger ? "danger" : "primary");
    const cleanup = (value) => {
      overlay.classList.add("hidden");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      document.onkeydown = null;
      resolve(value);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    document.onkeydown = (e) => { if (e.key === "Escape") cleanup(false); };
    overlay.classList.remove("hidden");
    setTimeout(() => okBtn.focus(), 50);
  });
}

// APK/WebView prompt da çoğu cihazda sorun çıkarabiliyor. Bu yüzden miktar/şifre girişlerini de uygulama içi pencereden alıyoruz.
function appPrompt(message, defaultValue = "", options = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("appConfirmOverlay");
    const titleEl = document.getElementById("appConfirmTitle");
    const msgEl = document.getElementById("appConfirmMessage");
    const okBtn = document.getElementById("appConfirmOk");
    const cancelBtn = document.getElementById("appConfirmCancel");
    if (!overlay || !msgEl || !okBtn || !cancelBtn) {
      resolve(window.prompt(String(message || "Değer gir:"), String(defaultValue ?? "")));
      return;
    }

    let input = document.getElementById("appPromptInput");
    if (!input) {
      input = document.createElement("input");
      input.id = "appPromptInput";
      input.className = "app-prompt-input";
      msgEl.insertAdjacentElement("afterend", input);
    }

    titleEl.textContent = options.title || "Bilgi gir";
    msgEl.textContent = String(message || "Değer gir:");
    input.type = options.type || "text";
    input.inputMode = options.inputMode || (options.type === "number" ? "numeric" : "text");
    input.value = String(defaultValue ?? "");
    input.placeholder = options.placeholder || "";
    input.classList.remove("hidden");
    okBtn.textContent = options.okText || "Tamam";
    cancelBtn.textContent = options.cancelText || "İptal";
    okBtn.className = "btn " + (options.danger ? "danger" : "primary");

    const cleanup = (value) => {
      overlay.classList.add("hidden");
      input.classList.add("hidden");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      input.onkeydown = null;
      document.onkeydown = null;
      resolve(value);
    };

    okBtn.onclick = () => cleanup(input.value);
    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    input.onkeydown = (e) => {
      if (e.key === "Enter") cleanup(input.value);
      if (e.key === "Escape") cleanup(null);
    };
    document.onkeydown = (e) => { if (e.key === "Escape") cleanup(null); };
    overlay.classList.remove("hidden");
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}


const SESSION_STORE_KEY = "garage_current_session_v2";
const STAFF_META_STORE_KEY = "garage_staff_meta_v2";
const ACTIVITY_STORE_KEY = "garage_activity_logs_v2";
const ROLE_PERMISSION_STORE_KEY = "garage_role_permissions_v1";
const TAB_DEFINITIONS = [
  { key: "operation", label: "İşlem" },
  { key: "add", label: "Ürün Ekle" },
  { key: "requests", label: "Talepler" },
  { key: "movements", label: "Hareketler" },
  { key: "critical", label: "Kritik Stok" },
  { key: "categoryValues", label: "Kategori Değerleri" },
  { key: "orderSuggestion", label: "Sipariş Önerisi" },
  { key: "purchaseOrders", label: "Verilen Siparişler" },
  { key: "surveys", label: "Müşteri Memnuniyeti" },
  { key: "management", label: "Yönetim" },
  { key: "settings", label: "Ayarlar" },
  { key: "users", label: "Kullanıcılar / Yetkiler" },
  { key: "logs", label: "Loglar" }
];
const ALL_TAB_KEYS = TAB_DEFINITIONS.map(t => t.key);
const DEFAULT_ROLE_PERMISSIONS = {
  admin: [...ALL_TAB_KEYS],
  depo: ["operation", "add", "movements", "critical", "categoryValues", "orderSuggestion", "purchaseOrders", "settings", "surveys"],
  kasa: ["operation", "movements", "critical", "categoryValues", "orderSuggestion", "purchaseOrders", "surveys"],
  satis: ["operation", "movements", "critical"],
  usta: ["operation", "movements", "critical"]
};
const ROLE_DEFAULT_TAB = { admin: "operation", depo: "operation", kasa: "operation", satis: "operation", usta: "operation" };
function normalizeRolePermissions(data) {
  const output = {};
  Object.keys(DEFAULT_ROLE_PERMISSIONS).forEach(role => {
    const incoming = Array.isArray(data?.[role]) ? data[role] : DEFAULT_ROLE_PERMISSIONS[role];
    output[role] = [...new Set(incoming.filter(tab => ALL_TAB_KEYS.includes(tab)))];
    if (role === "admin") output[role] = [...ALL_TAB_KEYS];
    if (!output[role].length) output[role] = [...DEFAULT_ROLE_PERMISSIONS[role]];
  });
  return output;
}
function readRolePermissions() {
  try {
    return normalizeRolePermissions(JSON.parse(localStorage.getItem(ROLE_PERMISSION_STORE_KEY) || "null"));
  } catch {
    return normalizeRolePermissions(null);
  }
}
function writeRolePermissions(permissions) {
  const normalized = normalizeRolePermissions(permissions);
  localStorage.setItem(ROLE_PERMISSION_STORE_KEY, JSON.stringify(normalized));
  saveRolePermissionsToSupabase(normalized).catch(() => {});
  return normalized;
}
async function loadRolePermissionsFromSupabase() {
  try {
    const { data, error } = await supabaseClient.from("app_settings").select("value").eq("key", "role_permissions").maybeSingle();
    if (error || !data?.value) return;
    localStorage.setItem(ROLE_PERMISSION_STORE_KEY, JSON.stringify(normalizeRolePermissions(data.value)));
  } catch (err) {
    console.warn("Yetki ayarları Supabase'den alınamadı, local devam:", err?.message || err);
  }
}
async function saveRolePermissionsToSupabase(permissions) {
  try {
    await supabaseClient.from("app_settings").upsert({ key: "role_permissions", value: normalizeRolePermissions(permissions), updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch (err) {
    console.warn("Yetki ayarları Supabase'e yazılamadı:", err?.message || err);
  }
}
function permissionsForRole(role) { return readRolePermissions()[role] || readRolePermissions().kasa; }
function canAccessTab(tab, role = currentStaff().role) {
  const staff = currentStaff();
  if (tab === "settings") return role === "admin" || staff.permissions?.themeSettings === true;
  return permissionsForRole(role).includes(tab);
}
function readStaffMeta() { try { return JSON.parse(localStorage.getItem(STAFF_META_STORE_KEY) || "{}"); } catch { return {}; } }
function writeStaffMeta(meta) { localStorage.setItem(STAFF_META_STORE_KEY, JSON.stringify(meta || {})); }
function updateStaffMeta(name, patch) {
  const key = normalizeStaffName(name);
  if (!key) return;
  const meta = readStaffMeta();
  meta[key] = { ...(meta[key] || {}), ...(patch || {}) };
  writeStaffMeta(meta);
}
function currentSession() { try { return JSON.parse(localStorage.getItem(SESSION_STORE_KEY) || "null"); } catch { return null; } }
function setCurrentSession(staff) {
  const session = { name: staff.name, role: staff.role, loginAt: new Date().toISOString(), sessionId: Date.now() + "_" + Math.random().toString(16).slice(2) };
  localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(session));
  localStorage.setItem(CURRENT_STAFF_STORE_KEY, staff.name);
  updateStaffMeta(staff.name, { lastLoginAt: session.loginAt, lastSeenAt: session.loginAt, role: staff.role });
  state.currentUser = session;
  supabaseClient
  .from("app_users")
  .update({
    last_seen_at: new Date().toISOString(),
    last_login_at: new Date().toISOString()
  })
  .eq("auth_user_id", staff.authUserId || "00000000-0000-0000-0000-000000000000");
  return session;
}
async function setUserOffline() {
  try {
    const session = currentSession();
    if (!session?.name) return;

    await supabaseClient
      .from("app_users")
      .update({
        last_seen_at: null
      })
      .eq("auth_user_id", state.currentUser?.authUserId || "00000000-0000-0000-0000-000000000000");

  } catch (err) {
    console.warn("Offline güncellenemedi:", err);
  }
}

function clearCurrentSession() {
  setUserOffline();
  localStorage.removeItem(SESSION_STORE_KEY);
  state.currentUser = null;
}
function authEmailForUsername(username) {
  const slug = String(username || "")
    .trim().toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "");
  return `${slug || "personel"}@garage.local`;
}
function populateLoginStaffSelect() {
  // Supabase Auth + RLS modunda kullanıcı listesi girişten önce veritabanından gösterilmez.
  // Alan artık serbest kullanıcı adı girişidir.
}
async function loadAuthenticatedProfile() {
  const { data: authData, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !authData?.user) throw authError || new Error("Oturum bulunamadı");
  const { data, error } = await supabaseClient
    .from("app_users")
    .select("auth_user_id,username,name,role,is_active,last_seen_at,last_login_at,allowed_categories,permissions")
    .eq("auth_user_id", authData.user.id)
    .single();
  if (error) throw error;
  if (!data?.is_active) throw new Error("Bu personel hesabı pasif");
  const profile = normalizeStaffItem({
    authUserId: data.auth_user_id,
    username: data.username,
    name: data.name,
    role: data.role,
    allowedCategories: data.allowed_categories || [],
    permissions: data.permissions || {},
    lastSeenAt: data.last_seen_at,
    lastLoginAt: data.last_login_at
  });
  localStorage.setItem(STAFF_STORE_KEY, JSON.stringify([profile]));
  localStorage.setItem(CURRENT_STAFF_STORE_KEY, profile.name);
  state.currentUser = profile;
  return profile;
}
function updateUserPill() {
  const staff = currentStaff();
  if (el.activeUserName) el.activeUserName.textContent = staff.name || "-";
  if (el.activeUserRole) el.activeUserRole.textContent = roleLabel(staff.role || "kasa");
}
function applyRoleVisibility() {
  const staff = currentStaff();
  const allowed = new Set(permissionsForRole(staff.role));
  ALL_TAB_KEYS.forEach(tab => {
    const nav = document.getElementById("nav-" + tab);
    let visible = allowed.has(tab);
    if (tab === "settings") visible = staff.role === "admin" || staff.permissions?.themeSettings === true;
    if (nav) nav.classList.toggle("hidden", !visible);
  });
  document.body.dataset.role = staff.role || "kasa";
}
function showLogin() {
  if (el.loginOverlay) el.loginOverlay.classList.remove("hidden");
  if (el.appShell) el.appShell.classList.add("locked");
  setTimeout(() => el.loginStaffSelect?.focus(), 100);
}
function hideLogin() {
  if (el.loginOverlay) el.loginOverlay.classList.add("hidden");
  if (el.appShell) el.appShell.classList.remove("locked");
}
async function loginWithSelectedStaff() {
  const username = String(el.loginStaffSelect?.value || "").trim();
  const pass = String(el.loginPasswordInput?.value || "");
  if (!username || !pass) return showToast("Kullanıcı adı ve şifre gerekli", true);
  try {
    setLoading(true);
    const { error } = await supabaseClient.auth.signInWithPassword({ email: authEmailForUsername(username), password: pass });
    if (error) throw error;
    const staff = await loadAuthenticatedProfile();
    if (el.loginPasswordInput) el.loginPasswordInput.value = "";
    hideLogin(); updateUserPill(); applyRoleVisibility();
    await loadStaffListFromSupabase();
    renderStaffSelector(); renderUsersList(); renderRolePermissionEditor(); renderUserCategoryPermissions();
    const target = canAccessTab(state.activeTab, staff.role) ? state.activeTab : (ROLE_DEFAULT_TAB[staff.role] || "operation");
    switchTab(target);
    await logActivity("login", `${staff.name} giriş yaptı`, "staff", staff.name);
    showToast(`Hoş geldin ${staff.name} ✅`);
  } catch (err) {
    await supabaseClient.auth.signOut({ scope: "local" }).catch(() => {});
    showToast(err?.message === "Invalid login credentials" ? "Kullanıcı adı veya şifre hatalı" : (err?.message || "Giriş yapılamadı"), true);
  } finally { setLoading(false); }
}
async function initAuthGate() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data?.session) { showLogin(); return; }
  try {
    const staff = await loadAuthenticatedProfile();
    hideLogin();
    await loadRolePermissionsFromSupabase();
    await loadStaffListFromSupabase();
    updateUserPill(); applyRoleVisibility(); renderUsersList(); renderRolePermissionEditor(); renderUserCategoryPermissions();
  } catch (err) {
    console.warn("Güvenli oturum açılamadı:", err);
    await supabaseClient.auth.signOut({ scope: "local" });
    showLogin();
  }
}
window.logoutCurrentUser = async function() {
  const staff = currentStaff();
  await logActivity("logout", `${staff.name} çıkış yaptı`, "staff", staff.name).catch(() => {});
  await supabaseClient.auth.signOut({ scope: "local" });
  localStorage.removeItem(SESSION_STORE_KEY);
  localStorage.removeItem(CURRENT_STAFF_STORE_KEY);
  localStorage.removeItem(STAFF_STORE_KEY);
  state.currentUser = null;
  showLogin(); showToast("Çıkış yapıldı");
};
function localActivityPush(item) {
  const logs = readLocalActivityLogs();
  logs.unshift(item);
  localStorage.setItem(ACTIVITY_STORE_KEY, JSON.stringify(logs.slice(0, 300)));
}
function readLocalActivityLogs() { try { return JSON.parse(localStorage.getItem(ACTIVITY_STORE_KEY) || "[]"); } catch { return []; } }
async function logActivity(action, description, entity_table = null, entity_id = null) {
  const staff = currentStaff();
  const item = { id: "local_" + Date.now() + "_" + Math.random().toString(16).slice(2), actor_name: staff.name, actor_role: staff.role, action, description, entity_table, entity_id: entity_id ? String(entity_id) : null, created_at: new Date().toISOString() };
  localActivityPush(item);
  // Ekranda eski state.activityLogs doluysa yeni yerel kayıt görünmüyordu.
  // Yeni logu anında state'e de ekle; sayfa yenilemeden görünür olsun.
  state.activityLogs = [item, ...(state.activityLogs || []).filter(x => String(x.id) !== String(item.id))].slice(0, 120);
  if (state.activityLogTableReady) {
    try {
      const { error } = await supabaseClient.from("app_activity_logs").insert({ actor_name: item.actor_name, actor_role: item.actor_role, action: item.action, description: item.description, entity_table: item.entity_table, entity_id: item.entity_id });
      if (error) throw error;
    } catch (err) {
      console.warn("app_activity_logs tablosu yok veya erişilemiyor, yerel log tutuluyor:", err);
      state.activityLogTableReady = false;
    }
  }
  renderActivityLogs();
  renderUsersList();
  renderRolePermissionEditor();
}
async function loadActivityLogs() {
  let rows = readLocalActivityLogs();
  if (state.activityLogTableReady) {
    try {
      const { data, error } = await supabaseClient.from("app_activity_logs").select("*").order("created_at", { ascending: false }).limit(120);
      if (error) throw error;
      rows = data || rows;
    } catch (err) {
      console.warn("Aktivite logları Supabase'den alınamadı:", err);
      state.activityLogTableReady = false;
    }
  }
  state.activityLogs = rows || [];
  renderActivityLogs();
}
window.loadActivityLogs = loadActivityLogs;
function renderActivityLogs() {
  if (!el.activityLogList) return;
  const rows = (state.activityLogs.length ? state.activityLogs : readLocalActivityLogs()).slice(0, 80);
  el.activityLogList.innerHTML = rows.length ? rows.map(r => `<div class="movement-item"><div class="movement-top"><div><strong>${escapeHtml(r.actor_name || "-")}</strong><div class="muted">${escapeHtml(roleLabel(r.actor_role) || r.actor_role || "-")} · ${escapeHtml(r.action || "-")}</div></div><span class="muted">${formatDate(r.created_at)}</span></div><div>${escapeHtml(r.description || "-")}</div>${r.entity_table ? `<div class="muted">${escapeHtml(r.entity_table)} ${r.entity_id ? "#" + escapeHtml(String(r.entity_id).slice(0, 8)) : ""}</div>` : ""}</div>`).join("") : `<div class="empty-state">Henüz işlem kaydı yok</div>`;
}
function renderUsersList() {
  if (!el.usersList) return;
  const meta = readStaffMeta();
  const active = currentStaffName();
  const staff = readStaffList();
  el.usersList.innerHTML = staff.map(s => {
    const m = meta[s.name] || {};
    const lastSeen = m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : 0;
const online = lastSeen && (Date.now() - lastSeen < 2 * 60 * 1000);
    return `<div class="user-row ${online ? "online" : ""}"><div class="user-avatar">${escapeHtml((s.name || "?").slice(0,1).toLocaleUpperCase("tr-TR"))}</div><div><strong>${escapeHtml(s.name)}</strong><div class="muted">${roleLabel(s.role)} · Son giriş: ${m.lastLoginAt ? formatDate(m.lastLoginAt) : "-"}</div><div class="muted">Son görünme: ${m.lastSeenAt ? formatDate(m.lastSeenAt) : "-"}</div></div><span class="user-status">${online ? "Çevrimiçi" : "Pasif"}</span></div>`;
  }).join("");
}
window.renderUsersList = renderUsersList;

function renderRolePermissionEditor() {
  if (!el.rolePermissionEditor) return;
  const staff = currentStaff();
  if (staff.role !== "admin") {
    el.rolePermissionEditor.innerHTML = `<div class="empty-state">Menü yetkilerini sadece Admin düzenleyebilir.</div>`;
    return;
  }
  const permissions = readRolePermissions();
  const editableRoles = ["depo", "kasa", "satis", "usta"];
  el.rolePermissionEditor.innerHTML = editableRoles.map(role => `
    <div class="permission-role-card">
      <div class="permission-role-head">
        <strong>${roleLabel(role)}</strong>
        <small>${(permissions[role] || []).length} sekme aktif</small>
      </div>
      <div class="permission-check-grid">
        ${TAB_DEFINITIONS.filter(tab => !["users", "logs"].includes(tab.key)).map(tab => `
          <label class="permission-check">
            <input type="checkbox" data-role-permission="${role}" value="${tab.key}" ${(permissions[role] || []).includes(tab.key) ? "checked" : ""} />
            <span>${escapeHtml(tab.label)}</span>
          </label>
        `).join("")}
      </div>
    </div>
  `).join("");
}
window.renderRolePermissionEditor = renderRolePermissionEditor;

function allKnownCategories() {
  return uniqueCleanValues([...(state.products || []).map(p => p.category), ...getSuggestionValues("category")]);
}
function renderUserCategoryPermissions() {
  const box = document.getElementById("userCategoryPermissionEditor");
  if (!box) return;
  if (currentStaff().role !== "admin") { box.innerHTML = `<div class="empty-state">Kategori yetkilerini sadece Admin düzenleyebilir.</div>`; return; }
  const categories = allKnownCategories();
  box.innerHTML = readStaffList().filter(s => s.role !== "admin").map(s => `
    <div class="permission-role-card user-category-card" data-user-permission-card="${escapeHtml(s.name)}">
      <div class="permission-role-head"><strong>${escapeHtml(s.name)}</strong><small>${roleLabel(s.role)}</small></div>
      <div class="permission-check-grid action-permission-grid">
        <label class="permission-check"><input type="checkbox" data-user-action="stockIn" ${s.permissions?.stockIn ? "checked" : ""}><span>Stok Giriş</span></label>
        <label class="permission-check"><input type="checkbox" data-user-action="stockOut" ${s.permissions?.stockOut ? "checked" : ""}><span>Stok Çıkış</span></label>
        <label class="permission-check"><input type="checkbox" data-user-action="addToOrderPool" ${s.permissions?.addToOrderPool ? "checked" : ""}><span>Sipariş Havuzuna At</span></label>
        <label class="permission-check"><input type="checkbox" data-user-action="themeSettings" ${s.permissions?.themeSettings ? "checked" : ""}><span>Tema Ayarları</span></label>
      </div>
      <div class="category-permission-head"><b>Görebileceği kategoriler</b><button class="btn secondary mini" type="button" onclick="toggleAllUserCategories('${escapeHtml(s.name)}', true)">Tümü</button><button class="btn ghost mini" type="button" onclick="toggleAllUserCategories('${escapeHtml(s.name)}', false)">Temizle</button></div>
      <div class="permission-check-grid category-permission-grid">${categories.map(c => `<label class="permission-check"><input type="checkbox" data-user-category value="${escapeHtml(c)}" ${(s.allowedCategories || []).some(x => normalizeText(x) === normalizeText(c)) ? "checked" : ""}><span>${escapeHtml(c)}</span></label>`).join("") || `<div class="muted">Kategori listesi için ürünleri bir kez yükle.</div>`}</div>
    </div>`).join("");
}
window.toggleAllUserCategories = function(name, checked) {
  const card = [...document.querySelectorAll('[data-user-permission-card]')].find(x => x.dataset.userPermissionCard === name);
  card?.querySelectorAll('[data-user-category]').forEach(x => x.checked = checked);
};
window.saveUserCategoryPermissions = async function() {
  if (!requireRoleAction(["admin"], "Kategori yetkilerini sadece Admin düzenleyebilir")) return;
  const list = readStaffList();
  document.querySelectorAll('[data-user-permission-card]').forEach(card => {
    const user = list.find(s => s.name === card.dataset.userPermissionCard);
    if (!user) return;
    user.allowedCategories = [...card.querySelectorAll('[data-user-category]:checked')].map(x => x.value);
    user.permissions = {};
    card.querySelectorAll('[data-user-action]').forEach(x => user.permissions[x.dataset.userAction] = x.checked);
  });
  localStorage.setItem(STAFF_STORE_KEY, JSON.stringify(cleanStaffList(list)));
  const ok = await saveStaffListToSupabase(list);
  if (!ok) return;
  renderUserCategoryPermissions(); applyRoleVisibility();
  await logActivity("user_category_permissions", "Personel kategori ve işlem yetkileri güncellendi", "app_users", "permissions");
  showToast("Kategori ve işlem yetkileri kaydedildi ✅");
};

window.saveRolePermissions = function() {
  if (!requireRoleAction(["admin"], "Menü yetkilerini sadece Admin düzenleyebilir")) return;
  const current = readRolePermissions();
  ["depo", "kasa", "satis", "usta"].forEach(role => {
    current[role] = [...document.querySelectorAll(`[data-role-permission="${role}"]:checked`)].map(input => input.value);
  });
  writeRolePermissions(current);
  applyRoleVisibility();
  renderRolePermissionEditor();
  logActivity("role_permissions", "Rol bazlı menü yetkileri güncellendi", "permissions", "menu");
  showToast("Menü yetkileri kaydedildi ✅");
};

window.resetRolePermissions = async function() {
  if (!requireRoleAction(["admin"], "Menü yetkilerini sadece Admin sıfırlayabilir")) return;
  if (!(await appConfirm("Menü yetkileri varsayılana dönsün mü?", { danger: true }))) return;
  localStorage.removeItem(ROLE_PERMISSION_STORE_KEY);
  applyRoleVisibility();
  renderRolePermissionEditor();
  logActivity("role_permissions_reset", "Rol bazlı menü yetkileri varsayılana döndü", "permissions", "menu");
  showToast("Menü yetkileri varsayılana döndü ✅");
};

function currentUserCategoryPermissions() {
  const staff = currentStaff();
  if (staff.role === "admin") return [];
  return Array.isArray(staff.allowedCategories) ? staff.allowedCategories : [];
}
function canAccessCategory(category) {
  const staff = currentStaff();
  if (staff.role === "admin") return true;
  const allowed = currentUserCategoryPermissions();
  if (!allowed.length) return false;
  return allowed.some(v => normalizeText(v) === normalizeText(category));
}
function filterProductsByCurrentUser(rows) {
  return currentStaff().role === "admin" ? (rows || []) : (rows || []).filter(row => canAccessCategory(row.category || row.stock_products?.category || ""));
}
function userActionAllowed(action) {
  const staff = currentStaff();
  if (staff.role === "admin") return true;
  return staff.permissions?.[action] === true;
}
function requireUserAction(action, message) {
  if (!userActionAllowed(action)) { showToast(message || "Bu işlem için kişisel yetkin yok", true); return false; }
  return true;
}
function requireRoleAction(allowedRoles, message = "Bu işlem için yetkin yok") {
  const staff = currentStaff();
  if (!allowedRoles.includes(staff.role)) {
    showToast(message, true);
    logActivity("blocked", `${staff.name} yetkisiz işlem denedi: ${message}`, "permission", staff.role);
    return false;
  }
  return true;
}
function actorSuffix() {
  const staff = currentStaff();
  return ` · Personel: ${staff.name} (${roleLabel(staff.role)})`;
}

function showToast(message, isError = false) {
  el.toast.textContent = message; el.toast.classList.remove("hidden");
  el.toast.style.borderColor = isError ? "rgba(220,38,38,0.5)" : "rgba(22,163,74,0.5)";
  setTimeout(() => el.toast.classList.add("hidden"), 3500);
}
/* === Excel Aktarım Şelalesi === */

function createExcelProgress() {
  let box = document.getElementById("excelProgressBox");

  if (!box) {
    box = document.createElement("div");
    box.id = "excelProgressBox";
    box.className = "excel-progress-wrap";

    box.innerHTML = `
      <div class="excel-progress-title">Excel Aktarılıyor 🚀</div>

      <div class="excel-progress-bar">
        <div id="excelProgressFill" class="excel-progress-fill"></div>
      </div>

      <div id="excelProgressText" class="excel-progress-text">
        Hazırlanıyor...
      </div>

      <div id="excelProgressPercent" class="excel-progress-percent">
        0%
      </div>
    `;

    document.body.appendChild(box);
  }

  return box;
}

function updateExcelProgress(current, total, success = 0, error = 0) {
  const percent = total ? Math.round((current / total) * 100) : 0;

  createExcelProgress();

  const fill = document.getElementById("excelProgressFill");
  const text = document.getElementById("excelProgressText");
  const percentEl = document.getElementById("excelProgressPercent");

  if (fill) fill.style.width = percent + "%";

  if (text) {
    text.innerHTML = `
      Aktarılan: <b>${current}</b> / ${total}<br>
      Başarılı: <span class="excel-progress-success">${success}</span><br>
      Hatalı: <span class="excel-progress-error">${error}</span>
    `;
  }

  if (percentEl) {
    percentEl.textContent = percent + "%";
  }
}

function closeExcelProgress(delay = 1200) {
  setTimeout(() => {
    document.getElementById("excelProgressBox")?.remove();
  }, delay);
}

/* === Excel Aktarım Şelalesi SON === */
function notificationIcon(type) {
  return ({ stock_request: "📦", critical_stock: "⚠️", movement: "↔️", sale: "💳", system: "🔔" })[type] || "🔔";
}
function updateNotificationBadge() {
  const count = Number(state.unreadNotificationCount || 0);
  const text = count > 99 ? "99+" : String(count);
  if (el.notificationUnreadCount) {
    if (count > 0) {
      el.notificationUnreadCount.textContent = text;
      el.notificationUnreadCount.classList.remove("hidden");
      if (el.notificationBellBtn) el.notificationBellBtn.classList.add("has-unread");
    } else {
      el.notificationUnreadCount.classList.add("hidden");
      if (el.notificationBellBtn) el.notificationBellBtn.classList.remove("has-unread");
    }
  }
  const navCount = document.getElementById("navNotificationCount");
  if (navCount) {
    navCount.textContent = text;
    navCount.classList.toggle("hidden", count <= 0);
  }
}
function updateRequestBadge() {
  const count = (state.stockRequests || []).filter(r => ["bekliyor", "rezerve_edildi", "teslim_edildi"].includes(String(r.status || ""))).length;
  const badge = document.getElementById("requestPendingCount");
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count <= 0);
}
function renderNotifications() {
  if (!el.notificationList) return;
  let list = state.notifications || [];
  if (state.notificationFilter === "unread") list = list.filter(n => !n.is_read);
  else if (state.notificationFilter !== "all") list = list.filter(n => n.type === state.notificationFilter);
  if (!list.length) {
    el.notificationList.innerHTML = `<div class="empty-state">Bu filtrede bildirim yok</div>`;
    return;
  }
  el.notificationList.innerHTML = list.map(n => `
    <div class="notification-item ${n.is_read ? "read" : "unread"}">
      <div class="notification-icon">${notificationIcon(n.type)}</div>
      <div class="notification-body">
        <div class="notification-title-row">
          <strong>${escapeHtml(n.title || "Bildirim")}</strong>
          <span>${formatDate(n.created_at)}</span>
        </div>
        <div class="notification-message">${escapeHtml(n.message || "-")}</div>
        ${n.source_table || n.source_id ? `<div class="notification-source">${escapeHtml(n.source_table || "")}${n.source_id ? " #" + escapeHtml(String(n.source_id).slice(0, 8)) : ""}</div>` : ""}
      </div>
      <div class="notification-actions">
        ${n.is_read ? "" : `<button class="btn secondary mini" onclick="markNotificationRead('${n.id}')">Okundu</button>`}
      </div>
    </div>`).join("");
}
function pushLocalNotification({ title, message, type = "system", source_table = null, source_id = null, is_read = false }) {
  const item = { id: "local_" + Date.now() + "_" + Math.random().toString(16).slice(2), title, message, type, source_table, source_id, is_read, created_at: new Date().toISOString() };
  state.notifications.unshift(item);
  state.notifications = state.notifications.slice(0, 120);
  state.unreadNotificationCount = state.notifications.filter(n => !n.is_read).length;
  updateNotificationBadge();
  renderNotifications();
  return item;
}
async function createNotification({ title, message, type = "system", target_role = "depo", source_table = null, source_id = null, silent = false }) {
  const payload = { title, message, type, target_role, source_table, source_id, is_read: false };
  if (!state.notificationTableReady) {
    const item = pushLocalNotification(payload);
    if (!silent) playNotificationSound();
    return item;
  }
  try {
    const { data, error } = await supabaseClient.from("notifications").insert(payload).select("*").single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn("notifications tablosu kullanılamıyor, yerel bildirime düşüldü:", err);
    state.notificationTableReady = false;
    const item = pushLocalNotification(payload);
    if (!silent) playNotificationSound();
    return item;
  }
}
async function loadNotifications() {
  if (!state.notificationTableReady) { renderNotifications(); return; }
  try {
    const { data, error } = await supabaseClient.from("notifications").select("*").order("created_at", { ascending: false }).limit(120);
    if (error) throw error;
    state.notifications = data || [];
    state.unreadNotificationCount = state.notifications.filter(n => !n.is_read).length;
    updateNotificationBadge();
    renderNotifications();
  } catch (err) {
    console.warn("Bildirimler yüklenemedi:", err);
    state.notificationTableReady = false;
    renderNotifications();
  }
}
window.loadNotifications = loadNotifications;
window.setNotificationFilter = function(filter) { state.notificationFilter = filter || "all"; renderNotifications(); };
window.markNotificationRead = async function(id) {
  const item = state.notifications.find(n => String(n.id) === String(id));
  if (item) item.is_read = true;
  state.unreadNotificationCount = state.notifications.filter(n => !n.is_read).length;
  updateNotificationBadge();
  renderNotifications();
  if (!String(id).startsWith("local_") && state.notificationTableReady) {
    await supabaseClient.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", id);
  }
};
window.markAllNotificationsRead = async function() {
  state.notifications.forEach(n => n.is_read = true);
  state.unreadNotificationCount = 0;
  updateNotificationBadge();
  renderNotifications();
  if (state.notificationTableReady) {
    await supabaseClient.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("is_read", false);
  }
  showToast("Bildirimler okundu yapıldı ✅");
};
window.testInAppNotification = function() {
  pushLocalNotification({ title: "Test bildirimi", message: "Ses ve bildirim merkezi çalışıyor knk ✅", type: "system" });
  playNotificationSound();
  showToast("Test bildirimi oluşturuldu ✅");
};
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}
function searchIncludes(text, query) {
  const t = normalizeText(text);
  const q = normalizeText(query);

  return (
    t.includes(q) ||
    t.replace(/\s+/g, "").includes(q.replace(/\s+/g, ""))
  );
}

// Aynı ürün farklı raf/konumlarda ayrı kartlar halinde tutulabilir.
// Bu anahtar konumu/barkodu bilerek dışarıda bırakır; böylece ürünün toplam stoğu tek grupta görünür.
function groupedStockIdentityKey(product) {
  const clean = (value) => normalizeText(String(value || "")).replace(/\s+/g, " ").trim();
  const parts = [
    product?.productBrand ?? product?.product_brand,
    product?.category,
    product?.carBrand ?? product?.vehicle_brand,
    product?.carModel ?? product?.vehicle_model,
    product?.carType ?? product?.vehicle_type,
    product?.vehicleYear ?? product?.vehicle_year
  ].map(clean);
  const signature = parts.join("|");
  if (signature.replace(/\|/g, "").trim()) return `product:${signature}`;
  const barcode = clean(product?.barcode);
  return barcode ? `barcode:${barcode}` : `id:${product?.id || ""}`;
}

function buildGroupedStockProductGroups(products) {
  const groups = new Map();
  for (const product of products || []) {
    const key = groupedStockIdentityKey(product);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        first: product,
        members: [],
        totalStock: 0,
        totalReserved: 0,
        minStockTotal: 0,
        barcodes: new Set(),
        locations: new Set()
      });
    }
    const group = groups.get(key);
    group.members.push(product);
    group.totalStock += Number(product?.stock ?? product?.quantity ?? 0);
    group.totalReserved += Number(product?.reserved ?? product?.reserved_quantity ?? 0);
    group.minStockTotal += Number(product?.minStock ?? product?.min_stock ?? 0);
    const barcode = String(product?.barcode || "").trim();
    const location = String(product?.location || "").trim();
    if (barcode) group.barcodes.add(barcode);
    if (location) group.locations.add(location);
  }
  return [...groups.values()];
}

async function insertStockMovementRecord({ productId, movementType, quantity, description, plate = null, recordNo = null }) {
  const qty = Math.abs(Number(quantity || 0));
  if (!productId || !qty) return false;
  const payload = {
    product_id: productId,
    movement_type: String(movementType || "stok_duzeltme"),
    quantity: qty,
    description: String(description || "Stok hareketi")
  };
  if (plate) payload.plate = plate;
  if (recordNo) payload.record_no = recordNo;
  const { error } = await supabaseClient.from("stock_movements").insert(payload);
  if (error) throw error;
  return true;
}

async function recordDirectStockDelta({ productId, beforeQty, afterQty, source = "Stok düzeltme", productName = "Ürün" }) {
  const before = Number(beforeQty || 0);
  const after = Number(afterQty || 0);
  const delta = after - before;
  if (!delta) return false;
  const direction = delta > 0 ? "giris" : "cikis";
  const signed = `${delta > 0 ? "+" : ""}${delta}`;
  await insertStockMovementRecord({
    productId,
    movementType: `stok_duzeltme_${direction}`,
    quantity: Math.abs(delta),
    description: `${source}: ${before} → ${after} (${signed})${actorSuffix()}`
  });
  await logActivity(
    `stock_adjust_${direction}`,
    `${productName || "Ürün"} stoğu ${source.toLocaleLowerCase("tr-TR")} ile ${before} → ${after} (${signed})`,
    "stock_products",
    productId
  );
  return true;
}

async function safeRecordDirectStockDelta(args) {
  try {
    await recordDirectStockDelta(args);
    return true;
  } catch (err) {
    console.error("Stok hareket denetim kaydı yazılamadı:", err);
    try {
      await logActivity(
        "stock_audit_warning",
        `${args?.productName || "Ürün"} stok değişikliği yapıldı fakat Hareketler kaydı yazılamadı: ${err?.message || err}`,
        "stock_products",
        args?.productId || null
      );
    } catch (_) {}
    return false;
  }
}
function formatDate(value) { if (!value) return "-"; const d = new Date(value); if (Number.isNaN(d.getTime())) return value; return d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }); }
function buildProductName(row) { return [row.product_brand, row.category, row.vehicle_brand, row.vehicle_model, row.vehicle_type, row.vehicle_year].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); }
function extractImageUrlFromNote(note) {
  const m = String(note || "").match(/\[IMG:([^\]]+)\]/i);
  return m ? m[1].trim() : "";
}
function stripImageUrlFromNote(note) {
  return String(note || "").replace(/\s*\[IMG:[^\]]+\]\s*/ig, " ").replace(/\s+/g, " ").trim();
}
function publicUrlToStoragePath(url) {
  const value = String(url || "").trim();
  const marker = `/storage/v1/object/public/${STOCK_IMAGE_BUCKET}/`;
  const index = value.indexOf(marker);
  if (index < 0) return "";
  return decodeURIComponent(value.slice(index + marker.length).split("?")[0]);
}
function productImageHtml(p, sizeClass = "product-card-img") {
  const url = p?.imageThumbUrl || p?.imageUrl || "";
  return url
    ? `<img class="${sizeClass}" src="${escapeHtml(url)}" alt="Ürün resmi" loading="lazy" onclick="openProductImage('${escapeHtml(p.imageUrl || url)}')" />`
    : `<div class="${sizeClass} empty" title="Resim yok">📷</div>`;
}
function mapProduct(row) {
  const imageUrl = row.image_url || extractImageUrlFromNote(row.note || "");
  return { id: row.id || "", barcode: row.barcode || "", name: row.product_name || buildProductName(row), productBrand: row.product_brand || "", category: row.category || "", carBrand: row.vehicle_brand || "", carModel: row.vehicle_model || "", carType: row.vehicle_type || "", vehicleYear: row.vehicle_year || "", stock: Number(row.quantity || 0), reserved: Number(row.reserved_quantity || 0), minStock: Number(row.min_stock || 0), location: row.location || "", note: stripImageUrlFromNote(row.note || ""), imageUrl, imageThumbUrl: row.image_thumb_url || imageUrl, purchasePrice: Number(row.purchase_price || 0), averageSalePrice: Number(row.average_sale_price || 0), createdAt: row.created_at || "" };
}
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

function updateNotifyButtonUI(isWorking = false) {
  if (!el.enableNotifyBtn) return;

  if (isWorking) {
    el.enableNotifyBtn.textContent = "Bildirim Açılıyor...";
    el.enableNotifyBtn.disabled = true;
    return;
  }

  if ("Notification" in window && Notification.permission === "granted") {
    el.enableNotifyBtn.textContent = "Bildirim Açık ✅";
    el.enableNotifyBtn.classList.remove("ghost");
    el.enableNotifyBtn.classList.add("success");
    el.enableNotifyBtn.disabled = true;
  } else {
    el.enableNotifyBtn.textContent = "Bildirim Aç";
    el.enableNotifyBtn.classList.remove("success");
    el.enableNotifyBtn.classList.add("ghost");
    el.enableNotifyBtn.disabled = false;
  }
}

async function enablePushNotifications() {
  try {
    updateNotifyButtonUI(true);

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      showToast("Bu cihaz push bildirim desteklemiyor", true);
      updateNotifyButtonUI(false);
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      showToast("Bildirim izni verilmedi", true);
      updateNotifyButtonUI(false);
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const res = await fetch("/api/subscribe-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription)
    });

    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.message || "Push aboneliği kaydedilemedi");
    }

    updateNotifyButtonUI(false);
    showToast("Bildirim açık ✅");
  } catch (err) {
    console.error("Bildirim açma hatası:", err);
    updateNotifyButtonUI(false);
    showToast(err.message || "Bildirim açılamadı", true);
  }
}
function playNotificationSound() {
  try {
    const audio = new Audio("./notification.mp3");
    audio.volume = 1;
    audio.play().catch((err) => {
      console.warn("Ses otomatik çalınamadı:", err);
    });
  } catch (err) {
    console.warn("Bildirim sesi hatası:", err);
  }
}
function toProductRow(payload) {
  const productName = [payload.productBrand, payload.category, payload.carBrand, payload.carModel, payload.carType, payload.vehicleYear].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return { barcode: payload.barcode || null, product_name: productName || payload.category, product_brand: payload.productBrand || null, category: payload.category || null, vehicle_brand: payload.carBrand || null, vehicle_model: payload.carModel || null, vehicle_type: payload.carType || null, vehicle_year: payload.vehicleYear || null, quantity: Number(payload.stock || 0), min_stock: Number(payload.minStock || 0), location: payload.location || null, note: stripImageUrlFromNote(payload.note || "") || null, image_url: payload.imageUrl || null, image_thumb_url: payload.imageThumbUrl || payload.imageUrl || null, purchase_price: Number(payload.purchasePrice || 0), average_sale_price: Number(payload.averageSalePrice || 0) };
}
function formatRequestStatus(status) { return ({ bekliyor: "Bekliyor", rezerve_edildi: "Rezerve", teslim_edildi: "Teslim Edildi", montaj_bitti: "Tamamlandı", iptal: "İptal" })[status] || status || "-"; }

let productImageRemoveRequested = false;
let selectedProductImageBlob = null;
let selectedProductImageExt = "webp";

function updateProductImagePreview(url = "") {
  if (el.productImagePreview) {
    el.productImagePreview.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="Ürün resmi" />`
      : `<div class="product-image-empty">📷<span>Resim yok</span></div>`;
  }
  if (el.productImageStatus) {
    el.productImageStatus.textContent = url ? "Resim hazır" : "Resim seçilmedi";
  }
  if (el.productImageViewBtn) el.productImageViewBtn.disabled = !url;
  if (el.productImageRemoveBtn) el.productImageRemoveBtn.disabled = !url && !selectedProductImageBlob;
}

function resetProductImageState() {
  productImageRemoveRequested = false;
  selectedProductImageBlob = null;
  selectedProductImageExt = "webp";
  if (el.productImageFile) el.productImageFile.value = ""; if (el.productCameraFile) el.productCameraFile.value = "";
  if (el.productImage) el.productImage.value = "";
  updateProductImagePreview("");
}

function loadImageForCompression(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).catch(() => loadImageElementForCompression(file));
  }
  return loadImageElementForCompression(file);
}

function loadImageElementForCompression(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Resim okunamadı"));
    };
    img.src = url;
  });
}

async function compressProductImage(file) {
  const bitmap = await loadImageForCompression(file);
  const sourceWidth = bitmap.width || bitmap.naturalWidth || 1;
  const sourceHeight = bitmap.height || bitmap.naturalHeight || 1;
  const scale = Math.min(1, STOCK_IMAGE_MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", STOCK_IMAGE_QUALITY));
  if (blob) return { blob, ext: "webp" };
  const fallback = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", STOCK_IMAGE_QUALITY));
  if (!fallback) throw new Error("Resim küçültülemedi");
  return { blob: fallback, ext: "jpg" };
}

async function handleProductImageFile(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Lütfen resim dosyası seç", true);
    event.target.value = "";
    return;
  }
  try {
    if (el.productImageStatus) el.productImageStatus.textContent = "Resim küçültülüyor...";
    const optimized = await compressProductImage(file);
    selectedProductImageBlob = optimized.blob;
    selectedProductImageExt = optimized.ext;
    productImageRemoveRequested = false;
    const previewUrl = URL.createObjectURL(selectedProductImageBlob);
    updateProductImagePreview(previewUrl);
    if (el.productImageStatus) {
      const kb = Math.round(selectedProductImageBlob.size / 1024);
      el.productImageStatus.textContent = `Resim hazır (${kb} KB)`;
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || "Resim hazırlanamadı", true);
    if (event?.target) event.target.value = "";
  }
}
window.handleProductImageFile = handleProductImageFile;


let productCameraStream = null;
let productCameraFacingMode = "environment";

function stopProductCameraStream() {
  if (productCameraStream) {
    productCameraStream.getTracks().forEach(track => track.stop());
    productCameraStream = null;
  }
  if (el.productCameraVideo) el.productCameraVideo.srcObject = null;
}

async function startProductCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Bu tarayıcı doğrudan kamera açmayı desteklemiyor");
  }
  stopProductCameraStream();
  if (el.productCameraMessage) el.productCameraMessage.textContent = "Kamera hazırlanıyor...";
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: productCameraFacingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };
  productCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  if (!el.productCameraVideo) throw new Error("Kamera ekranı bulunamadı");
  el.productCameraVideo.srcObject = productCameraStream;
  await el.productCameraVideo.play();
  if (el.productCameraMessage) {
    el.productCameraMessage.textContent = productCameraFacingMode === "environment"
      ? "Arka kamera hazır"
      : "Ön kamera hazır";
  }
}

async function openProductCamera() {
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    showToast("Kamera için uygulamayı HTTPS üzerinden açmalısın", true);
    return;
  }
  if (!el.productCameraModal) return;
  el.productCameraModal.classList.remove("hidden");
  document.body.classList.add("image-modal-open");
  try {
    await startProductCamera();
  } catch (err) {
    console.error(err);
    const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
    if (el.productCameraMessage) {
      el.productCameraMessage.textContent = denied
        ? "Kamera izni verilmedi. Tarayıcı ayarlarından kamera iznini aç."
        : (err.message || "Kamera açılamadı");
    }
    showToast(denied ? "Kamera izni verilmedi" : "Kamera açılamadı", true);
  }
}

function closeProductCamera() {
  stopProductCameraStream();
  if (el.productCameraModal) el.productCameraModal.classList.add("hidden");
  document.body.classList.remove("image-modal-open");
}

async function switchProductCamera() {
  productCameraFacingMode = productCameraFacingMode === "environment" ? "user" : "environment";
  try {
    await startProductCamera();
  } catch (err) {
    console.error(err);
    showToast("Diğer kamera açılamadı", true);
  }
}

async function captureProductCameraPhoto() {
  const video = el.productCameraVideo;
  const canvas = el.productCameraCanvas;
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
    showToast("Kamera henüz hazır değil", true);
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    if (el.productImageStatus) el.productImageStatus.textContent = "Fotoğraf hazırlanıyor...";
    const rawBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!rawBlob) throw new Error("Fotoğraf oluşturulamadı");
    const cameraFile = new File([rawBlob], `kamera-${Date.now()}.jpg`, { type: "image/jpeg" });
    const optimized = await compressProductImage(cameraFile);
    selectedProductImageBlob = optimized.blob;
    selectedProductImageExt = optimized.ext;
    productImageRemoveRequested = false;
    const previewUrl = URL.createObjectURL(selectedProductImageBlob);
    updateProductImagePreview(previewUrl);
    const kb = Math.round(selectedProductImageBlob.size / 1024);
    if (el.productImageStatus) el.productImageStatus.textContent = `Kameradan fotoğraf hazır (${kb} KB)`;
    closeProductCamera();
    showToast("Fotoğraf çekildi ✅");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Fotoğraf hazırlanamadı", true);
  }
}

window.openProductCamera = openProductCamera;
window.closeProductCamera = closeProductCamera;
window.switchProductCamera = switchProductCamera;
window.captureProductCameraPhoto = captureProductCameraPhoto;

async function uploadProductImageIfNeeded(productId) {
  if (productImageRemoveRequested) return { imageUrl: "", imageThumbUrl: "" };
  if (!selectedProductImageBlob) {
    const current = String(el.productImage?.value || "").trim();
    return { imageUrl: current, imageThumbUrl: current };
  }
  const safeId = String(productId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = `${safeId}/main-${Date.now()}.${selectedProductImageExt || "webp"}`;
  if (el.productImageStatus) el.productImageStatus.textContent = "Resim yükleniyor...";
  const { error: uploadError } = await supabaseClient.storage
    .from(STOCK_IMAGE_BUCKET)
    .upload(filePath, selectedProductImageBlob, {
      cacheControl: "31536000",
      upsert: true,
      contentType: selectedProductImageBlob.type || "image/webp"
    });
  if (uploadError) throw uploadError;
  const { data } = supabaseClient.storage.from(STOCK_IMAGE_BUCKET).getPublicUrl(filePath);
  const publicUrl = data?.publicUrl || "";
  if (!publicUrl) throw new Error("Resim linki alınamadı");
  return { imageUrl: publicUrl, imageThumbUrl: publicUrl };
}

window.removeSelectedProductImage = async function() {
  productImageRemoveRequested = true;
  selectedProductImageBlob = null;
  if (el.productImageFile) el.productImageFile.value = ""; if (el.productCameraFile) el.productCameraFile.value = "";
  if (el.productImage) el.productImage.value = "";
  updateProductImagePreview("");
  if (el.productImageStatus) el.productImageStatus.textContent = "Resim silinecek";
};

function ensureProductImageModal() {
  let modal = document.getElementById("productImageModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "productImageModal";
  modal.className = "product-image-modal hidden";
  modal.innerHTML = `
    <div class="product-image-modal-backdrop" onclick="closeProductImageModal()"></div>
    <div class="product-image-modal-card" role="dialog" aria-modal="true" aria-label="Ürün resmi">
      <button type="button" class="product-image-modal-close" onclick="closeProductImageModal()">×</button>
      <img id="productImageModalImg" src="" alt="Ürün resmi" />
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

window.openProductImage = function(url) {
  const imageUrl = String(url || el.productImage?.value || "").trim();
  if (!imageUrl) return showToast("Bu üründe resim yok", true);
  const modal = ensureProductImageModal();
  const img = document.getElementById("productImageModalImg");
  if (img) img.src = imageUrl;
  modal.classList.remove("hidden");
  document.body.classList.add("image-modal-open");
  if (!history.state || !history.state.productImageModal) {
    history.pushState({ ...(history.state || {}), productImageModal: true }, "");
  }
};

window.closeProductImageModal = function(fromPopState = false) {
  const modal = document.getElementById("productImageModal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  document.body.classList.remove("image-modal-open");
  const img = document.getElementById("productImageModalImg");
  if (img) img.src = "";
  if (!fromPopState && history.state?.productImageModal) {
    history.back();
  }
};

window.addEventListener("popstate", () => {
  const modal = document.getElementById("productImageModal");
  if (modal && !modal.classList.contains("hidden")) {
    closeProductImageModal(true);
  }
});
