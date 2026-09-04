// Yönetim: fiyatlar, kategori değerleri, sipariş önerileri ve toplu temizleme
function formatTL(value) {
  return Number(value || 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });
}
function normalizeCategoryKey(value) {
  return normalizeText(value || "");
}
function categoryValueMap() {
  const map = new Map();
  (state.categoryValues || []).forEach(v => map.set(normalizeCategoryKey(v.category), v));
  return map;
}
async function loadCategoryValues() {
  if (!state.products.length) {
    try { await loadProducts(); } catch (err) { console.warn("Ürünler alınamadı:", err?.message || err); }
  }
  // Yeni sistem: fiyatlar kategori tablosundan değil ürün kartlarındaki
  // alış_fiyati / ortalama_satis_fiyati alanlarından hesaplanır.
  state.categoryValues = [];
  renderCategoryValues();
}

function updateBulkPricePreview() {
  if (!el.bulkPricePreview) return;
  const category = el.bulkPriceCategory?.value || "";
  const field = el.bulkPriceField?.value || "average_sale_price";
  const mode = el.bulkPriceMode?.value || "percent";
  const amount = Number(el.bulkPriceAmount?.value || 0);
  if (!category || !Number.isFinite(amount) || (mode === "fixed" ? amount === 0 : amount <= 0)) {
    el.bulkPricePreview.textContent = "Kategori ve tutar seçildiğinde işlem özeti burada görünür.";
    return;
  }
  const count = (state.products || []).filter(p => normalizeText(p.category) === normalizeText(category)).length;
  const fieldLabel = field === "purchase_price" ? "alış fiyatı" : field === "both" ? "alış ve satış fiyatları" : "ortalama satış fiyatı";
  el.bulkPricePreview.textContent = `${count} ürünün ${fieldLabel} ${mode === "percent" ? `%${amount} artırılacak` : amount < 0 ? `${formatTL(Math.abs(amount))} düşürülecek` : `${formatTL(amount)} artırılacak`}.`;
}

async function applyCategoryPriceUpdate() {
  const category = String(el.bulkPriceCategory?.value || "").trim();
  const field = el.bulkPriceField?.value || "average_sale_price";
  const mode = el.bulkPriceMode?.value || "percent";
  const amount = Number(el.bulkPriceAmount?.value || 0);
  if (!category) return showToast("Önce kategori seç", true);
  if (!Number.isFinite(amount) || (mode === "fixed" ? amount === 0 : amount <= 0)) {
    return showToast(
      mode === "fixed"
        ? "Sabit değişim 0 olamaz. Düşürmek için örn. -5000 yazabilirsin."
        : "Yüzde artış 0'dan büyük olmalı",
      true
    );
  }

  const { data, error } = await supabaseClient
    .from("stock_products")
    .select("id,product_name,category,purchase_price,average_sale_price")
    .eq("category", category);
  if (error) return showToast(error.message || "Kategori ürünleri alınamadı", true);
  if (!data?.length) return showToast("Bu kategoride ürün bulunamadı", true);

  const fieldLabel = field === "purchase_price" ? "alış fiyatı" : field === "both" ? "alış ve satış fiyatları" : "ortalama satış fiyatı";
  const increaseLabel = mode === "percent" ? `%${amount} artırma` : amount < 0 ? `${formatTL(Math.abs(amount))} düşürme` : `${formatTL(amount)} artırma`;
  const zeroCount = data.filter(row => {
    const values = field === "both" ? [row.purchase_price, row.average_sale_price] : [row[field]];
    return values.some(v => Number(v || 0) <= 0);
  }).length;
  const warning = mode === "fixed" && amount < 0 ? `\n\n0 TL altına düşecek fiyatlar 0 TL olarak kalır.` : zeroCount ? `\n\n${zeroCount} üründe mevcut fiyat 0. Yüzde artışta 0 kalır; pozitif sabit tutarda girilen tutar eklenir.` : "";
  const ok = await appConfirm(`${category} kategorisindeki ${data.length} ürünün ${fieldLabel} için ${increaseLabel} uygulanacak.${warning}\n\nDevam edilsin mi?`, { title: "Toplu fiyat güncelleme", okText: "Güncelle" });
  if (!ok) return;

  const calc = (oldValue) => {
    const old = Number(oldValue || 0);
    const next = mode === "percent" ? old * (1 + amount / 100) : old + amount;
    return Math.max(0, Math.round((next + Number.EPSILON) * 100) / 100);
  };
  const updates = data.map(row => {
    const out = { id: row.id };
    if (field === "purchase_price" || field === "both") out.purchase_price = calc(row.purchase_price);
    if (field === "average_sale_price" || field === "both") out.average_sale_price = calc(row.average_sale_price);
    return out;
  });

  const chunkSize = 200;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const { error: updateError } = await supabaseClient.from("stock_products").upsert(chunk, { onConflict: "id" });
    if (updateError) return showToast(`Fiyat güncelleme yarıda kaldı: ${updateError.message}`, true);
  }

  await logActivity(
    "bulk_price_update",
    `${category} kategorisinde ${updates.length} ürünün ${fieldLabel} ${increaseLabel} artırıldı`,
    "stock_products",
    null
  );
  showToast(`${updates.length} ürünün fiyatı güncellendi`);
  if (el.bulkPriceAmount) el.bulkPriceAmount.value = "";
  await loadProducts();
  await loadCategoryValues();
  updateBulkPricePreview();
}
window.applyCategoryPriceUpdate = applyCategoryPriceUpdate;

window.loadCategoryValues = loadCategoryValues;
function computeCategoryValueRows() {
  const grouped = new Map();
  (state.products || []).forEach(p => {
    const category = String(p.category || "Kategorisiz").trim() || "Kategorisiz";
    const key = normalizeCategoryKey(category);
    const old = grouped.get(key) || { category, qty: 0, totalPurchase: 0, totalSale: 0, pricedProductCount: 0 };
    const qty = Number(p.stock || 0);
    const purchase = Number(p.purchasePrice || 0);
    const sale = Number(p.averageSalePrice || 0);
    old.qty += qty;
    old.totalPurchase += qty * purchase;
    old.totalSale += qty * sale;
    if (purchase > 0 || sale > 0) old.pricedProductCount += 1;
    grouped.set(key, old);
  });
  return [...grouped.values()]
    .map(row => ({
      ...row,
      purchase: row.qty ? row.totalPurchase / row.qty : 0,
      sale: row.qty ? row.totalSale / row.qty : 0,
      estimatedDiff: row.totalSale - row.totalPurchase,
      hasPrice: row.pricedProductCount > 0
    }))
    .sort((a,b) => a.category.localeCompare(b.category, "tr"));
}
function renderCategoryValues() {
  const rows = computeCategoryValueRows();
  state.categoryValueRows = rows;
  if (el.bulkPriceCategory) {
    const current = el.bulkPriceCategory.value;
    el.bulkPriceCategory.innerHTML = `<option value="">Kategori seç</option>` + rows
      .filter(r => r.category && r.category !== "Kategorisiz")
      .map(r => `<option value="${escapeHtml(r.category)}">${escapeHtml(r.category)}</option>`).join("");
    if ([...el.bulkPriceCategory.options].some(o => o.value === current)) el.bulkPriceCategory.value = current;
  }
  const totalPurchase = rows.reduce((s,r) => s + r.totalPurchase, 0);
  const totalSale = rows.reduce((s,r) => s + r.totalSale, 0);
  const totalDiff = totalSale - totalPurchase;
  const missing = rows.filter(r => !r.hasPrice).length;
  if (el.categoryValueSummary) {
    el.categoryValueSummary.innerHTML = `
      <div class="value-stat"><span>Toplam Alış Değeri</span><strong>${formatTL(totalPurchase)}</strong></div>
      <div class="value-stat"><span>Ort. Satış Değeri</span><strong>${formatTL(totalSale)}</strong></div>
      <div class="value-stat"><span>Tahmini Brüt Fark</span><strong>${formatTL(totalDiff)}</strong></div>
      <div class="value-stat ${missing ? "warning" : ""}"><span>Fiyat Girilmeyen Kategori</span><strong>${missing}</strong></div>
    `;
  }
  if (el.categoryValueList) {
    el.categoryValueList.innerHTML = `<div class="empty-state">Fiyatlar artık ürün kartından giriliyor. Kategori toplamları aşağıda otomatik hesaplanıyor.</div>`;
  }
  if (el.categoryValueDetail) {
    el.categoryValueDetail.innerHTML = rows.length ? `
      <div class="table-wrap"><table class="category-value-table">
        <thead><tr><th>Kategori</th><th>Stok</th><th>Ort. Alış</th><th>Ort. Satış</th><th>Alış Toplam</th><th>Satış Toplam</th><th>Fark</th><th>Fiyat</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.hasPrice ? "" : "missing-price"}"><td>${escapeHtml(r.category)}${r.hasPrice ? "" : " <span class='muted'>(fiyat yok)</span>"}</td><td>${r.qty}</td><td>${formatTL(r.purchase)}</td><td>${formatTL(r.sale)}</td><td>${formatTL(r.totalPurchase)}</td><td>${formatTL(r.totalSale)}</td><td>${formatTL(r.estimatedDiff)}</td><td><button class="action-btn edit category-price-edit-btn" type="button" data-category="${escapeHtml(r.category)}" onclick="openCategoryPriceEditorFromButton(this)">Ürünleri Düzenle</button></td></tr>`).join("")}</tbody>
      </table></div>
    ` : `<div class="empty-state">Hesaplanacak stok bulunamadı.</div>`;
  }
}
window.renderCategoryValues = renderCategoryValues;
window.editCategoryValue = function(id) {
  const row = (state.categoryValues || []).find(v => String(v.id) === String(id));
  if (!row) return;
  if (el.categoryValueId) el.categoryValueId.value = row.id;
  if (el.categoryValueCategory) el.categoryValueCategory.value = row.category || "";
  if (el.categoryValuePurchase) el.categoryValuePurchase.value = row.purchase_price || 0;
  if (el.categoryValueSale) el.categoryValueSale.value = row.average_sale_price || 0;
  el.categoryValueCategory?.focus();
};
window.clearCategoryValueForm = function() {
  if (el.categoryValueId) el.categoryValueId.value = "";
  if (el.categoryValueCategory) el.categoryValueCategory.value = "";
  if (el.categoryValuePurchase) el.categoryValuePurchase.value = "";
  if (el.categoryValueSale) el.categoryValueSale.value = "";
};
async function saveCategoryValueFromForm(e) {
  e?.preventDefault?.();
  const category = String(el.categoryValueCategory?.value || "").trim();
  if (!category) return showToast("Kategori adı boş olamaz", true);
  const payload = {
    category,
    purchase_price: Number(el.categoryValuePurchase?.value || 0),
    average_sale_price: Number(el.categoryValueSale?.value || 0)
  };
  const id = el.categoryValueId?.value || "";
  let error;
  if (id) {
    ({ error } = await supabaseClient.from("category_values").update(payload).eq("id", id));
  } else {
    ({ error } = await supabaseClient.from("category_values").upsert(payload, { onConflict: "category" }));
  }
  if (error) return showToast(error.message || "Kategori değeri kaydedilemedi", true);
  clearCategoryValueForm();
  await loadCategoryValues();
  showToast("Kategori değeri kaydedildi ✅");
}
window.saveCategoryValueFromForm = saveCategoryValueFromForm;
window.deleteCategoryValue = async function(id) {
  if (!(await appConfirm("Bu kategori fiyat kaydı silinsin mi? Stok ürünleri silinmez, sadece fiyat tanımı gider.", { danger: true }))) return;
  const { error } = await supabaseClient.from("category_values").delete().eq("id", id);
  if (error) return showToast(error.message || "Silinemedi", true);
  await loadCategoryValues();
  showToast("Kategori fiyatı silindi");
};



function uniqueProductFieldValues(field, fallbackLabel) {
  return [...new Set((state.products || [])
    .map(p => String(p?.[field] || fallbackLabel).trim() || fallbackLabel))]
    .sort((a, b) => a.localeCompare(b, "tr"));
}
function fillStockFilterSelect(selectId, values, selectedValue = "all", allLabel = "Tümü") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const safeSelected = values.includes(selectedValue) ? selectedValue : "all";
  select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map(value =>
    `<option value="${escapeHtml(value)}" ${value === safeSelected ? "selected" : ""}>${escapeHtml(value)}</option>`
  ).join("");
}
function refreshStockCategoryFilters() {
  const categories = uniqueProductFieldValues("category", "Kategorisiz");
  const productBrands = uniqueProductFieldValues("productBrand", "Markasız");
  const carBrands = uniqueProductFieldValues("carBrand", "Araç Markası Yok");
  fillStockFilterSelect("criticalCategoryFilter", categories, state.criticalCategoryFilter || "all", "Tüm Kategoriler");
  fillStockFilterSelect("criticalProductBrandFilter", productBrands, state.criticalProductBrandFilter || "all", "Tüm Ürün Markaları");
  fillStockFilterSelect("criticalCarBrandFilter", carBrands, state.criticalCarBrandFilter || "all", "Tüm Araç Markaları");
  fillStockFilterSelect("orderSuggestionCategoryFilter", categories, state.orderSuggestionCategoryFilter || "all", "Tüm Kategoriler");
  fillStockFilterSelect("orderSuggestionProductBrandFilter", productBrands, state.orderSuggestionProductBrandFilter || "all", "Tüm Ürün Markaları");
  fillStockFilterSelect("orderSuggestionCarBrandFilter", carBrands, state.orderSuggestionCarBrandFilter || "all", "Tüm Araç Markaları");
}
window.setCriticalCategoryFilter = function(value) { state.criticalCategoryFilter = value || "all"; renderCriticalStock(); };
window.setCriticalProductBrandFilter = function(value) { state.criticalProductBrandFilter = value || "all"; renderCriticalStock(); };
window.setCriticalCarBrandFilter = function(value) { state.criticalCarBrandFilter = value || "all"; renderCriticalStock(); };
window.setOrderSuggestionCategoryFilter = function(value) { state.orderSuggestionCategoryFilter = value || "all"; renderOrderSuggestionRows(); };
window.setOrderSuggestionProductBrandFilter = function(value) { state.orderSuggestionProductBrandFilter = value || "all"; renderOrderSuggestionRows(); };
window.setOrderSuggestionCarBrandFilter = function(value) { state.orderSuggestionCarBrandFilter = value || "all"; renderOrderSuggestionRows(); };

function isOutgoingMovementType(type) {
  const t = normalizeText(type || "");
  if (!t) return false;
  if (t.includes("iade") || t.includes("giris") || t.includes("rezerv")) return false;
  return t.includes("cikis") || t.includes("satis") || t.includes("satıs") || t.includes("montaj") || t === "cikis";
}
function orderProductLabel(p = {}) {
  return [p.productBrand, p.category, p.carBrand, p.carModel, p.carType, p.vehicleYear]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || p.name || "-";
}
async function fetchRecentOutgoingMovements(days = 7) {
  const start = new Date();
  start.setDate(start.getDate() - Number(days || 7));
  let rows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseClient
      .from("stock_movements")
      .select("product_id,quantity,movement_type,created_at,description,stock_products(product_name,product_brand,category,vehicle_brand,vehicle_model,vehicle_type,vehicle_year,quantity,location)")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows.filter(m => isOutgoingMovementType(m.movement_type));
}
function buildOrderSuggestionRows(movements) {
  const productMap = new Map((state.products || []).map(p => [String(p.id), p]));
  const grouped = new Map();
  (movements || []).forEach(m => {
    const productId = String(m.product_id || "");
    if (!productId) return;
    const qty = Number(m.quantity || 0);
    if (qty <= 0) return;
    const current = grouped.get(productId) || { productId, outQty: 0, lastDate: "", movementCount: 0 };
    current.outQty += qty;
    current.movementCount += 1;
    if (!current.lastDate || String(m.created_at || "") > String(current.lastDate || "")) current.lastDate = m.created_at || "";
    const localProduct = productMap.get(productId);
    const joined = m.stock_products || {};
    current.product = localProduct || {
      id: productId,
      name: joined.product_name || "-",
      productBrand: joined.product_brand || "",
      category: joined.category || "",
      carBrand: joined.vehicle_brand || "",
      carModel: joined.vehicle_model || "",
      carType: joined.vehicle_type || "",
      vehicleYear: joined.vehicle_year || "",
      stock: Number(joined.quantity || 0),
      location: joined.location || ""
    };
    grouped.set(productId, current);
  });
  return [...grouped.values()].map(row => {
    const p = row.product || {};
    const currentStock = Number(p.stock || 0);
    const suggestedQty = Math.max(0, Number(row.outQty || 0) - currentStock);
    return {
      productId: row.productId,
      productName: orderProductLabel(p),
      productBrand: p.productBrand || "",
      category: p.category || "",
      carBrand: p.carBrand || "",
      carModel: p.carModel || "",
      carType: p.carType || "",
      vehicleYear: p.vehicleYear || "",
      location: p.location || "",
      outQty: Number(row.outQty || 0),
      currentStock,
      suggestedQty,
      lastDate: row.lastDate || "",
      movementCount: row.movementCount || 0
    };
  }).sort((a, b) => (b.suggestedQty - a.suggestedQty) || (b.outQty - a.outQty) || a.productName.localeCompare(b.productName, "tr"));
}
function renderOrderSuggestionRows() {
  const box = document.getElementById("orderSuggestionList");
  const summary = document.getElementById("orderSuggestionSummary");
  if (!box) return;
  refreshStockCategoryFilters();
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
  const totalOut = rows.reduce((s, r) => s + Number(r.outQty || 0), 0);
  const totalSuggested = needRows.reduce((s, r) => s + Number(r.suggestedQty || 0), 0);
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
    const old = categoryMap.get(key) || { category: key, outQty: 0, currentStock: 0, suggestedQty: 0, productCount: 0 };
    old.outQty += Number(r.outQty || 0);
    old.currentStock += Number(r.currentStock || 0);
    old.suggestedQty += Number(r.suggestedQty || 0);
    old.productCount += 1;
    categoryMap.set(key, old);
  });
  const categoryRows = [...categoryMap.values()].sort((a,b) => (b.suggestedQty-a.suggestedQty) || (b.outQty-a.outQty));
  const categoryHtml = categoryRows.length ? `
    <div class="category-order-grid">${categoryRows.map(c => `
      <button type="button" class="category-order-card ${c.suggestedQty > 0 ? "need" : "ok"}" onclick="document.getElementById('orderSuggestionCategoryFilter').value='${escapeHtml(c.category)}'; setOrderSuggestionCategoryFilter('${escapeHtml(c.category)}')">
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
}
async function loadOrderSuggestions() {
  const box = document.getElementById("orderSuggestionList");
  if (box) box.innerHTML = `<div class="empty-state">Son 7 günlük çıkışlar hesaplanıyor...</div>`;
  if (!state.products.length) {
    try { await loadProducts(); } catch (err) { console.warn("Ürünler alınamadı:", err?.message || err); }
  }
  const movements = await fetchRecentOutgoingMovements(7);
  state.orderSuggestionRows = buildOrderSuggestionRows(movements);
  renderOrderSuggestionRows();
}
window.loadOrderSuggestions = loadOrderSuggestions;
window.downloadOrderSuggestionExcel = function() {
  const selectedCategory = state.orderSuggestionCategoryFilter || "all";
  const selectedProductBrand = state.orderSuggestionProductBrandFilter || "all";
  const selectedCarBrand = state.orderSuggestionCarBrandFilter || "all";
  const rows = (state.orderSuggestionRows || []).filter(r =>
    Number(r.suggestedQty || 0) > 0 &&
    (selectedCategory === "all" || String(r.category || "Kategorisiz") === selectedCategory) &&
    (selectedProductBrand === "all" || String(r.productBrand || "Markasız") === selectedProductBrand) &&
    (selectedCarBrand === "all" || String(r.carBrand || "Araç Markası Yok") === selectedCarBrand)
  );
  if (!rows.length) return showToast("Excel'e aktarılacak sipariş önerisi yok", true);
  const sheetRows = rows.map(r => ({
    "Ürün": r.productName,
    "Ürün Markası": r.productBrand,
    "Kategori": r.category,
    "Araç Markası": r.carBrand,
    "Araç Modeli": r.carModel,
    "Araç Tipi": r.carType,
    "Model Yılı": r.vehicleYear,
    "Son 7 Gün Çıkış": r.outQty,
    "Mevcut Stok": r.currentStock,
    "Önerilen Sipariş": r.suggestedQty,
    "Raf/Konum": r.location,
    "Son Çıkış": r.lastDate ? formatDate(r.lastDate) : ""
  }));
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sipariş Önerisi");
  const d = new Date().toLocaleDateString("tr-TR").replaceAll(".", "-");
  XLSX.writeFile(wb, `Siparis_Onerisi_${d}.xlsx`);
};


function computeCategoryBrandRows() {
  const grouped = new Map();
  (state.products || []).forEach(p => {
    const category = String(p.category || "Kategorisiz").trim() || "Kategorisiz";
    const productBrand = String(p.productBrand || "Markasız").trim() || "Markasız";
    const key = `${normalizeCategoryKey(category)}||${normalizeCategoryKey(productBrand)}`;
    const old = grouped.get(key) || { category, productBrand, productCount: 0, stockQty: 0, totalPurchase: 0, totalSale: 0 };
    const qty = Number(p.stock || 0);
    old.productCount += 1;
    old.stockQty += qty;
    old.totalPurchase += qty * Number(p.purchasePrice || 0);
    old.totalSale += qty * Number(p.averageSalePrice || 0);
    grouped.set(key, old);
  });
  return [...grouped.values()].sort((a,b) =>
    a.category.localeCompare(b.category, "tr") || a.productBrand.localeCompare(b.productBrand, "tr")
  );
}
function renderCategoryBrandManagement() {
  const rows = computeCategoryBrandRows();
  const totalProductCards = rows.reduce((s,r) => s + Number(r.productCount || 0), 0);
  const totalStockQty = rows.reduce((s,r) => s + Number(r.stockQty || 0), 0);
  const totalPurchase = rows.reduce((s,r) => s + Number(r.totalPurchase || 0), 0);
  const totalSale = rows.reduce((s,r) => s + Number(r.totalSale || 0), 0);
  if (el.managementCategoryBrandSummary) {
    el.managementCategoryBrandSummary.innerHTML = `
      <div class="value-stat"><span>Kategori/Marka Satırı</span><strong>${rows.length}</strong></div>
      <div class="value-stat"><span>Ürün Kartı</span><strong>${totalProductCards}</strong></div>
      <div class="value-stat"><span>Toplam Stok</span><strong>${totalStockQty}</strong></div>
      <div class="value-stat"><span>Ort. Satış Değeri</span><strong>${formatTL(totalSale)}</strong></div>
    `;
  }
  if (el.managementCategoryBrandList) {
    el.managementCategoryBrandList.innerHTML = rows.length ? `
      <div class="table-wrap"><table class="category-value-table">
        <thead><tr><th>Kategori</th><th>Ürün Markası</th><th>Ürün Kartı</th><th>Stok Adedi</th><th>Alış Toplam</th><th>Satış Toplam</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.productBrand)}</td><td>${Number(r.productCount || 0)}</td><td><strong>${Number(r.stockQty || 0)}</strong></td><td>${formatTL(r.totalPurchase)}</td><td>${formatTL(r.totalSale)}</td></tr>`).join("")}</tbody>
      </table></div>
    ` : `<div class="empty-state">Liste için stok ürünü bulunamadı.</div>`;
  }
}
window.renderCategoryBrandManagement = renderCategoryBrandManagement;

const DELETE_MARK_TEXT = "SİLİNECEK";
const DELETE_MARK_VARIANTS = ["SİLİNECEK", "SILINECEK", "Silinecek", "silinecek"];

async function loadDeleteMarkedCount() {
  const countEl = document.getElementById("deleteMarkedCount");
  const infoEl = document.getElementById("deleteMarkedInfo");
  const deleteBtn = document.getElementById("deleteMarkedProductsBtn");
  if (countEl) countEl.textContent = "...";
  if (infoEl) infoEl.textContent = "Sayı kontrol ediliyor...";
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    const { count, error } = await supabaseClient
      .from("stock_products")
      .select("id", { count: "exact", head: true })
      .in("vehicle_brand", DELETE_MARK_VARIANTS);

    if (error) throw error;

    const total = Number(count || 0);
    if (countEl) countEl.textContent = String(total);
    if (infoEl) infoEl.textContent = total
      ? `${total} ürün kalıcı silmeye hazır. Araç Markası alanı "${DELETE_MARK_TEXT}" olanlar silinecek.`
      : `Araç Markası alanı "${DELETE_MARK_TEXT}" olan ürün bulunamadı.`;
    if (deleteBtn) deleteBtn.disabled = total <= 0;
    return total;
  } catch (err) {
    console.error(err);
    if (countEl) countEl.textContent = "!";
    if (infoEl) infoEl.textContent = err.message || "Silinecek ürün sayısı alınamadı.";
    showToast(err.message || "Silinecek ürün sayısı alınamadı", true);
    return 0;
  }
}
window.loadDeleteMarkedCount = loadDeleteMarkedCount;

async function fetchDeleteMarkedProductIds() {
  const ids = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseClient
      .from("stock_products")
      .select("id")
      .in("vehicle_brand", DELETE_MARK_VARIANTS)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const batch = data || [];
    ids.push(...batch.map(row => row.id).filter(Boolean));
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return ids;
}

async function deleteMarkedProducts() {
  if (!requireRoleAction(["admin"], "Toplu silme işlemini sadece Admin yapabilir")) return;

  const count = await loadDeleteMarkedCount();
  if (!count) return;

  const ok = await appConfirm(
    `${count} ürün kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`,
    { title: "Toplu Ürün Silme", okText: "Kalıcı Olarak Sil", cancelText: "Vazgeç", danger: true }
  );
  if (!ok) return;

  const secondOk = await appConfirm(
    `Son kontrol knk: Araç Markası "${DELETE_MARK_TEXT}" olan ${count} ürün tamamen silinsin mi?`,
    { title: "Son Onay", okText: "Evet, Sil", cancelText: "İptal", danger: true }
  );
  if (!secondOk) return;

  const deleteBtn = document.getElementById("deleteMarkedProductsBtn");
  const infoEl = document.getElementById("deleteMarkedInfo");
  try {
    if (deleteBtn) deleteBtn.disabled = true;
    if (infoEl) infoEl.textContent = "Silinecek ürünler hazırlanıyor...";

    const ids = await fetchDeleteMarkedProductIds();
    if (!ids.length) {
      showToast("Silinecek ürün bulunamadı");
      await loadDeleteMarkedCount();
      return;
    }

    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      if (infoEl) infoEl.textContent = `Hareket kayıtları temizleniyor: ${Math.min(i + chunk.length, ids.length)} / ${ids.length}`;
      await supabaseClient.from("stock_movements").delete().in("product_id", chunk);
    }

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      if (infoEl) infoEl.textContent = `Ürünler siliniyor: ${Math.min(i + chunk.length, ids.length)} / ${ids.length}`;
      const { error } = await supabaseClient.from("stock_products").delete().in("id", chunk);
      if (error) throw error;
    }

    state.products = state.products.filter(p => !ids.includes(p.id));
    state.operationFilterOptionsLoaded = false;
    await Promise.all([
      loadDashboardStats().catch(() => {}),
      loadMovements().catch(() => {}),
      loadOperationFilterOptions().catch(() => {})
    ]);
    updateStats();
    refreshProductQuickLists();
    refreshOperationFilters();
    renderOperationResults();
    await loadDeleteMarkedCount();

    logActivity("bulk_delete", `${ids.length} ürün Araç Markası ${DELETE_MARK_TEXT} olduğu için kalıcı silindi`, "stock_products", DELETE_MARK_TEXT);
    showToast(`${ids.length} ürün kalıcı olarak silindi ✅`);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Toplu silme başarısız oldu", true);
    await loadDeleteMarkedCount();
  } finally {
    if (deleteBtn) deleteBtn.disabled = false;
  }
}
window.deleteMarkedProducts = deleteMarkedProducts;


