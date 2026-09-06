// Personel: kullanıcı listesi, roller ve personel işlemleri
const STAFF_STORE_KEY = "garage_staff_list_v1";
const CURRENT_STAFF_STORE_KEY = "garage_current_staff_v1";
const DEFAULT_STAFF_LIST = [
  { name: "Admin", role: "admin", password: "0000" },
  { name: "Kasa", role: "kasa", password: "1111" },
  { name: "Satış", role: "satis", password: "4444" },
  { name: "Depo", role: "depo", password: "2222" },
  { name: "Usta", role: "usta", password: "3333" }
];

function normalizeStaffName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeStaffPassword(value, fallback = "1234") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function roleLabel(role) {
  return ({ admin: "Admin", kasa: "Kasa", depo: "Depo", satis: "Satış", usta: "Usta" })[role] || "Personel";
}

function defaultPasswordForRole(role) {
  const found = DEFAULT_STAFF_LIST.find(s => s.role === role);
  return found?.password || "1234";
}

function normalizeStaffItem(item) {
  const role = String(item?.role || "kasa");
  const allowedCategories = Array.isArray(item?.allowedCategories)
    ? item.allowedCategories
    : (Array.isArray(item?.allowed_categories) ? item.allowed_categories : []);
  const rawPermissions = item?.permissions && typeof item.permissions === "object" ? item.permissions : {};
  const authUserId = String(item?.authUserId || item?.auth_user_id || "").trim() || null;
  const username = String(item?.username || "").trim();

  return {
    authUserId,
    username,
    name: normalizeStaffName(item?.name),
    role,
    password: normalizeStaffPassword(item?.password, defaultPasswordForRole(role)),
    isActive: item?.isActive !== undefined ? item.isActive !== false : item?.is_active !== false,
    lastSeenAt: item?.lastSeenAt || item?.last_seen_at || null,
    lastLoginAt: item?.lastLoginAt || item?.last_login_at || null,
    allowedCategories: [...new Set(allowedCategories.map(v => String(v || "").trim()).filter(Boolean))],
    permissions: {
      ...rawPermissions,
      stockIn: rawPermissions.stockIn !== false,
      stockOut: rawPermissions.stockOut !== false,
      addToOrderPool: rawPermissions.addToOrderPool !== false,
      themeSettings: rawPermissions.themeSettings === true
    }
  };
}

function readStaffList() {
  try {
    const raw = localStorage.getItem(STAFF_STORE_KEY);
    if (!raw) return DEFAULT_STAFF_LIST.map(normalizeStaffItem);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_STAFF_LIST.map(normalizeStaffItem);
    const cleaned = parsed
      .map(normalizeStaffItem)
      .filter(item => item.name)
      .slice(0, 30);
    return cleaned.length ? cleaned : DEFAULT_STAFF_LIST.map(normalizeStaffItem);
  } catch {
    return DEFAULT_STAFF_LIST.map(normalizeStaffItem);
  }
}

function cleanStaffList(list) {
  const cleaned = (list || [])
    .map(normalizeStaffItem)
    .filter(item => item.name)
    .filter((item, index, arr) => {
      if (item.authUserId) return arr.findIndex(x => x.authUserId === item.authUserId) === index;
      const key = item.name.toLocaleLowerCase("tr-TR");
      return arr.findIndex(x => x.name.toLocaleLowerCase("tr-TR") === key) === index;
    })
    .slice(0, 30);
  return cleaned.length ? cleaned : DEFAULT_STAFF_LIST.map(normalizeStaffItem);
}
function writeStaffList(list) {
  const cleaned = cleanStaffList(list);
  localStorage.setItem(STAFF_STORE_KEY, JSON.stringify(cleaned));
  return cleaned;
}
async function loadStaffListFromServer() {
  try {
    const { data, error } = await legacyDisabledClient
      .from("app_users")
      .select("auth_user_id, username, name, role, is_active, last_seen_at, last_login_at, allowed_categories, permissions")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw error;

    if (Array.isArray(data) && data.length) {
      const localStaff = readStaffList();
      const cleaned = cleanStaffList(data.map((row) => {
        const localItem = localStaff.find((item) => item.authUserId === row.auth_user_id) || localStaff.find((item) => normalizeText(item.name) === normalizeText(row.name));
        return normalizeStaffItem({ ...row, password: localItem?.password || defaultPasswordForRole(row.role) });
      }));
      localStorage.setItem(STAFF_STORE_KEY, JSON.stringify(cleaned));

      if (state.currentUser?.authUserId) {
        const freshCurrent = cleaned.find(item => item.authUserId === state.currentUser.authUserId);
        if (freshCurrent) state.currentUser = { ...state.currentUser, ...freshCurrent };
      }
      return cleaned;
    }
    return readStaffList();
  } catch (err) {
    console.warn("Personel eski veri katmanı'den alınamadı, local devam:", err?.message || err);
    return readStaffList();
  }
}
function setStaffEditorMessage(message = "", type = "") {
  const box = document.getElementById("staffEditorMessage");
  if (!box) return;
  box.textContent = message;
  box.className = `staff-editor-message${type ? ` ${type}` : ""}${message ? "" : " hidden"}`;
}

async function saveStaffListToServer(list, pendingPasswords = new Map()) {
  try {
    const incoming = cleanStaffList(list);
    const { data: sessionData } = await legacyDisabledClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error("Oturum süresi dolmuş. Tekrar giriş yap.");

    const response = await fetch("/api/staff-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        staff: incoming.map((item) => ({
          authUserId: item.authUserId,
          username: item.username,
          name: item.name,
          role: item.role,
          password: pendingPasswords.get(item.authUserId || normalizeText(item.name)) || "",
          allowedCategories: item.allowedCategories || [],
          permissions: item.permissions || {}
        }))
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || `Personel servisi hata verdi (${response.status})`);

    const synced = (payload.staff || []).map((row) => {
      const oldItem = incoming.find((item) => item.authUserId === row.auth_user_id) || incoming.find((item) => normalizeText(item.name) === normalizeText(row.name));
      const changedPassword = pendingPasswords.get(oldItem?.authUserId || normalizeText(oldItem?.name));
      return normalizeStaffItem({ ...oldItem, ...row, password: changedPassword || oldItem?.password || defaultPasswordForRole(row.role) });
    });
    localStorage.setItem(STAFF_STORE_KEY, JSON.stringify(cleanStaffList(synced)));

    if (state.currentUser?.authUserId) {
      const freshCurrent = synced.find((item) => item.authUserId === state.currentUser.authUserId);
      if (freshCurrent) state.currentUser = { ...state.currentUser, ...freshCurrent };
    }
    return true;
  } catch (err) {
    console.warn("Personel eski veri katmanı'e yazılamadı:", err?.message || err);
    const message = "Personel kaydedilemedi: " + (err?.message || err);
    setStaffEditorMessage(message, "error");
    showToast(message, true);
    return false;
  }
}

function currentStaffName() {
  const saved = localStorage.getItem(CURRENT_STAFF_STORE_KEY);
  const staff = readStaffList();
  if (saved && staff.some(s => s.name === saved)) return saved;

  const cashier = staff.find(s => s.role === "kasa");
  return cashier?.name || staff[0]?.name || "Kasa";
}

function currentStaff() {
  const name = currentStaffName();
  const fromList = readStaffList().find(s => s.name === name || (state.currentUser?.authUserId && s.authUserId === state.currentUser.authUserId));
  if (state.currentUser?.authUserId) {
    return normalizeStaffItem({ ...(fromList || {}), ...state.currentUser });
  }
  return fromList || normalizeStaffItem({ name, role: "kasa", password: "1111" });
}

function adminStaff() {
  return readStaffList().find(s => s.role === "admin") || DEFAULT_STAFF_LIST[0];
}

async function verifyStaffPassword(targetName) {
  const staff = readStaffList();
  const target = staff.find(s => s.name === targetName);
  if (!target) {
    showToast("Personel bulunamadı", true);
    return false;
  }

  const admin = adminStaff();
  const entered = await appPrompt(`${target.name} hesabına geçmek için şifre gir:\n(Admin şifresi de geçerlidir.)`, "", { title: "Personel şifresi", type: "password", okText: "Giriş" });

  if (entered === null) return false;

  const pass = String(entered || "").trim();
  const targetPass = normalizeStaffPassword(target.password, defaultPasswordForRole(target.role));
  const adminPass = normalizeStaffPassword(admin.password, "0000");

  if (pass === targetPass || pass === adminPass) return true;

  showToast("Personel şifresi hatalı", true);
  return false;
}

async function verifyAdminPassword() {
  const admin = adminStaff();
  const entered = await appPrompt("Bu işlem için Admin şifresi gerekli:", "", { title: "Admin onayı", type: "password", okText: "Onayla" });
  if (entered === null) return false;

  if (String(entered || "").trim() === normalizeStaffPassword(admin.password, "0000")) return true;

  showToast("Admin şifresi hatalı", true);
  return false;
}

function renderStaffSelector() {
  if (!el.currentStaffSelect) return;
  const staff = readStaffList();
  const current = currentStaffName();
  el.currentStaffSelect.innerHTML = staff.map(s => `<option value="${escapeHtml(s.name)}" ${s.name === current ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  const active = currentStaff();
  if (el.staffRoleBadge) el.staffRoleBadge.textContent = roleLabel(active.role);
  updateUserPill();
  applyRoleVisibility();
  renderUsersList();
}

window.setCurrentStaff = async function(name) {
  if (!name) return;

  const current = currentStaffName();
  if (name === current) {
    renderStaffSelector();
    return;
  }

  if (!(await verifyStaffPassword(name))) {
    renderStaffSelector();
    return;
  }

  localStorage.setItem(CURRENT_STAFF_STORE_KEY, name);
  renderStaffSelector();
  showToast(`Aktif personel: ${name} ✅`);
};

function staffEditorRow(item = { name: "", role: "kasa", password: "" }) {
  const normalized = normalizeStaffItem(item);
  const isExistingAccount = Boolean(normalized.authUserId);
  return `
    <div class="staff-editor-row" data-staff-row
      data-staff-auth-id="${escapeHtml(normalized.authUserId || "")}"
      data-staff-username="${escapeHtml(normalized.username || "")}"
      data-staff-original-name="${escapeHtml(normalized.name || "")}">
      <input data-staff-name value="${escapeHtml(normalized.name || "")}" placeholder="Personel adı" />
      <select data-staff-role>
        <option value="admin" ${normalized.role === "admin" ? "selected" : ""}>Admin</option>
        <option value="kasa" ${normalized.role === "kasa" ? "selected" : ""}>Kasa</option>
        <option value="satis" ${normalized.role === "satis" ? "selected" : ""}>Satış</option>
        <option value="depo" ${normalized.role === "depo" ? "selected" : ""}>Depo</option>
        <option value="usta" ${normalized.role === "usta" ? "selected" : ""}>Usta</option>
      </select>
      <input data-staff-password type="password" value="" placeholder="${isExistingAccount ? "Değiştirmek için yeni şifre" : "Yeni personel şifresi"}" autocomplete="new-password" />
      <button type="button" class="btn danger" onclick="this.closest('[data-staff-row]').remove()">Sil</button>
    </div>`;
}

window.openStaffEditor = async function() {
  if (!requireRoleAction(["admin"], "Personel yönetimi sadece Admin")) return;
  if (!el.staffEditor || !el.staffEditorBody) return;
  if (!(await verifyAdminPassword())) return;

  el.staffEditorBody.innerHTML = readStaffList().map(staffEditorRow).join("");
  setStaffEditorMessage("");
  el.staffEditor.classList.remove("hidden");
};

window.closeStaffEditor = function() {
  if (el.staffEditor) el.staffEditor.classList.add("hidden");
};

window.addStaffEditorRow = function() {
  if (!el.staffEditorBody) return;
  el.staffEditorBody.insertAdjacentHTML("beforeend", staffEditorRow({ name: "", role: "kasa", password: "" }));
  setStaffEditorMessage("Yeni personelin adını, rolünü ve şifresini doldur.", "info");
};

window.saveStaffEditor = async function() {
  if (!el.staffEditorBody) return;
  const saveButton = document.getElementById("saveStaffEditorBtn");
  if (saveButton?.disabled) return;
  setStaffEditorMessage("");
  const previous = readStaffList();
  const rows = [...el.staffEditorBody.querySelectorAll("[data-staff-row]")];
  const unnamedRow = rows.find((row) => !normalizeStaffName(row.querySelector("[data-staff-name]")?.value));
  if (unnamedRow) {
    setStaffEditorMessage("Personel adı boş bırakılamaz.", "error");
    return;
  }
  const staff = rows.map(row => {
    const role = row.querySelector("[data-staff-role]")?.value || "kasa";
    const authUserId = String(row.dataset.staffAuthId || "").trim() || null;
    const originalName = normalizeStaffName(row.dataset.staffOriginalName || "");
    const username = String(row.dataset.staffUsername || "").trim();
    const oldItem =
      (authUserId ? previous.find(item => item.authUserId === authUserId) : null) ||
      previous.find(item => normalizeText(item.name) === normalizeText(originalName));

    const enteredPassword = String(row.querySelector("[data-staff-password]")?.value || "").trim();
    return {
      ...normalizeStaffItem({
        ...(oldItem || {}),
        authUserId: authUserId || oldItem?.authUserId || null,
        username: username || oldItem?.username || "",
        name: normalizeStaffName(row.querySelector("[data-staff-name]")?.value),
        role,
        password: oldItem?.password || defaultPasswordForRole(role),
        allowedCategories: oldItem?.allowedCategories || [],
        permissions: oldItem?.permissions || {}
      }),
      pendingPassword: enteredPassword
    };
  }).filter(x => x.name);

  const missingNewPassword = staff.find((item) => !item.authUserId && item.pendingPassword.length < 4);
  if (missingNewPassword) {
    setStaffEditorMessage(`${missingNewPassword.name} için en az 4 karakterli şifre gir.`, "error");
    return;
  }
  const duplicateName = staff.find((item, index, list) => list.findIndex((other) => normalizeText(other.name) === normalizeText(item.name)) !== index);
  if (duplicateName) {
    setStaffEditorMessage(`${duplicateName.name} adı listede iki kez kullanılmış.`, "error");
    return;
  }

  const cleaned = cleanStaffList(staff);
  const pendingPasswords = new Map(staff.map((item) => [item.authUserId || normalizeText(item.name), item.pendingPassword]));
  if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Kaydediliyor…"; }
  setStaffEditorMessage("Personel hesapları kaydediliyor…", "info");
  const syncOk = await saveStaffListToServer(cleaned, pendingPasswords);
  if (saveButton) { saveButton.disabled = false; saveButton.textContent = "Kaydet"; }
  if (!syncOk) return;

  const saved = readStaffList();
  if (!saved.some(s => s.name === currentStaffName())) {
    localStorage.setItem(CURRENT_STAFF_STORE_KEY, saved.find(s => s.role === "kasa")?.name || saved[0]?.name || "Kasa");
  }
  renderStaffSelector();
  renderUserCategoryPermissions();
  closeStaffEditor();
  showToast("Personel listesi ve giriş hesapları kaydedildi ✅");
};

window.resetStaffEditor = async function() {
  if (!(await appConfirm("Personel listesi ve şifreler varsayılana dönsün mü?", { danger: true }))) return;
  localStorage.removeItem(STAFF_STORE_KEY);
  localStorage.removeItem(CURRENT_STAFF_STORE_KEY);
  const syncOk = await saveStaffListToServer(DEFAULT_STAFF_LIST);
  if (!syncOk) return;
  if (el.staffEditorBody) el.staffEditorBody.innerHTML = readStaffList().map(staffEditorRow).join("");
  renderStaffSelector();
  showToast("Personel listesi ve şifreler varsayılana döndü ✅");
};
