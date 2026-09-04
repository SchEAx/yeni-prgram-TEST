// Raporlar, kritik stok ve plaka geçmişi
// ====================== MEGA PAKET: RAPOR / KRİTİK STOK / PLAKA GEÇMİŞİ ======================
function dateInputValue(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
function parseReportDate(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value + (endOfDay ? "T23:59:59" : "T00:00:00"));
  return Number.isNaN(d.getTime()) ? null : d;
}
function saleMovementRowsForReport() {
  const start = parseReportDate(document.getElementById("reportStartDate")?.value, false);
  const end = parseReportDate(document.getElementById("reportEndDate")?.value, true);
  const q = normalizeText(document.getElementById("reportSearchInput")?.value || "");
  return (state.movements || [])
    .map(m => ({ raw: m, parsed: parseSaleMovement(m) }))
    .filter(x => x.parsed)
    .filter(x => {
      const d = new Date(x.raw.created_at || "");
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (!q) return true;
      return normalizeText([x.parsed.productName, x.parsed.paymentType, x.raw.description, x.raw.movement_type].join(" ")).includes(q);
    });
}
function aggregateBy(rows, keyFn) {
  const map = new Map();
  rows.forEach(({ parsed }) => {
    const key = keyFn(parsed) || "-";
    const old = map.get(key) || { name: key, qty: 0, total: 0, count: 0 };
    old.qty += Number(parsed.qty || 0);
    old.total += Number(parsed.total || 0);
    old.count += 1;
    map.set(key, old);
  });
  return [...map.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}
function reportListHtml(items) {
  return items.length ? items.slice(0, 15).map((item, index) => `
    <div class="top-sale-item">
      <span>${index + 1}</span>
      <div><strong>${escapeHtml(item.name)}</strong><small>${item.qty} adet · ${formatSaleMoney(item.total)} · ${item.count} hareket</small></div>
    </div>`).join("") : `<div class="empty-state">Bu aralıkta veri yok</div>`;
}
function extractStaffFromDescription(desc = "") {
  const m = String(desc || "").match(/Personel:\s*([^\-]+)/i);
  return m ? m[1].trim() : "Personel Yok";
}
window.renderReports = function() {
  if (!document.getElementById("page-reports")) return;
  if (el.reportStartDate && !el.reportStartDate.value) el.reportStartDate.value = dateInputValue(new Date());
  if (el.reportEndDate && !el.reportEndDate.value) el.reportEndDate.value = dateInputValue(new Date());
  const rows = saleMovementRowsForReport();
  const total = rows.reduce((s, r) => s + Number(r.parsed.total || 0), 0);
  const qty = rows.reduce((s, r) => s + Number(r.parsed.qty || 0), 0);
  const refunds = rows.filter(r => r.parsed.isRefund).reduce((s, r) => s + Math.abs(Number(r.parsed.total || 0)), 0);
  const setText = (id, val) => { const node = document.getElementById(id); if (node) node.textContent = val; };
  setText("reportTotalSales", formatSaleMoney(total));
  setText("reportTotalQty", String(qty));
  setText("reportRefundTotal", formatSaleMoney(refunds));
  setText("reportMoveCount", String(rows.length));
  const products = aggregateBy(rows, p => p.productName);
  const staff = aggregateBy(rows, p => extractStaffFromDescription(rows.find(r => r.parsed === p)?.raw?.description || ""));
  const payments = aggregateBy(rows, p => p.paymentType);
  const productBox = document.getElementById("reportProductList"); if (productBox) productBox.innerHTML = reportListHtml(products);
  const staffBox = document.getElementById("reportStaffList"); if (staffBox) staffBox.innerHTML = reportListHtml(staff);
  const paymentBox = document.getElementById("reportPaymentList"); if (paymentBox) paymentBox.innerHTML = reportListHtml(payments);
};
window.exportReportCsv = function() {
  const rows = saleMovementRowsForReport();
  const lines = [["Tarih", "Ürün", "Adet", "Tutar", "Ödeme", "Açıklama"]];
  rows.forEach(({ raw, parsed }) => lines.push([formatDate(raw.created_at), parsed.productName, parsed.qty, parsed.total, parsed.paymentType, raw.description || ""]));
  const csv = lines.map(row => row.map(v => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `satis-raporu-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast("Rapor CSV olarak indirildi ✅");
};
window.renderCriticalStock = function() {
  const box = document.getElementById("criticalStockList");
  if (!box) return;
  refreshStockCategoryFilters();
  const q = normalizeText(document.getElementById("criticalSearchInput")?.value || "");
  const selectedCategory = state.criticalCategoryFilter || "all";
  const selectedProductBrand = state.criticalProductBrandFilter || "all";
  const selectedCarBrand = state.criticalCarBrandFilter || "all";
  let items = (state.products || []).filter(p => (Number(p.stock || 0) - Number(p.reserved || 0)) <= Number(p.minStock || 0));
  if (selectedCategory !== "all") items = items.filter(p => String(p.category || "Kategorisiz") === selectedCategory);
  if (selectedProductBrand !== "all") items = items.filter(p => String(p.productBrand || "Markasız") === selectedProductBrand);
  if (selectedCarBrand !== "all") items = items.filter(p => String(p.carBrand || "Araç Markası Yok") === selectedCarBrand);
  if (q) items = items.filter(p => productSmartSearch(p, q));
  items.sort((a, b) => (saleAvailable(a) - Number(a.minStock || 0)) - (saleAvailable(b) - Number(b.minStock || 0)));
  box.innerHTML = items.length ? items.map(p => {
    const available = saleAvailable(p);
    return `<div class="sale-product-item critical-card"><div><div class="sale-product-title">${escapeHtml(p.category || p.name || "-")}</div><div class="sale-product-meta">${escapeHtml(p.productBrand || "-")} / ${escapeHtml(p.carBrand || "-")} ${escapeHtml(p.carModel || "")} ${escapeHtml(p.carType || "")}<br>Mevcut: ${p.stock} · Rezerve: ${p.reserved} · Kullanılabilir: <strong class="stock-warning">${available}</strong> · Min: ${p.minStock} · Raf: ${escapeHtml(p.location || "-")}</div></div><button class="btn primary" onclick="editProduct('${p.id}')">Düzenle</button></div>`;
  }).join("") : `<div class="empty-state">Kritik stokta ürün yok 🎉</div>`;
};
function matchesHistoryQuery(text, q) {
  return normalizeText(text).includes(q) || normalizeText(String(text).replace(/\s+/g, "")).includes(normalizeText(q).replace(/\s+/g, ""));
}
window.renderPlateHistory = function() {
  const q = normalizeText(document.getElementById("historySearchInput")?.value || "");
  const requestBox = document.getElementById("historyRequestList");
  const moveBox = document.getElementById("historyMovementList");
  if (!requestBox || !moveBox) return;
  if (!q) {
    requestBox.innerHTML = `<div class="empty-state">Plaka veya müşteri adı yaz</div>`;
    moveBox.innerHTML = `<div class="empty-state">Plaka veya müşteri adı yaz</div>`;
    return;
  }
  const reqs = (state.stockRequests || []).filter(r => matchesHistoryQuery([r.plate, r.customer_name, r.record_no, r.requested_text, r.vehicle_brand, r.vehicle_model].join(" "), q));
  const moves = (state.movements || []).filter(m => matchesHistoryQuery([m.plate, m.record_no, m.description, m.stock_products?.product_name, m.movement_type].join(" "), q));
  const allDates = [...reqs.map(r => r.created_at), ...moves.map(m => m.created_at)].filter(Boolean).sort().reverse();
  const setText = (id, val) => { const node = document.getElementById(id); if (node) node.textContent = val; };
  setText("historyRequestCount", String(reqs.length));
  setText("historyMovementCount", String(moves.length));
  setText("historySaleCount", String(moves.filter(m => String(m.movement_type || "").includes("satis") || String(m.description || "").toLocaleLowerCase("tr-TR").includes("satış")).length));
  setText("historyLastDate", allDates[0] ? formatDate(allDates[0]) : "-");
  requestBox.innerHTML = reqs.length ? reqs.map(r => `<div class="movement-item"><div class="movement-top"><div><strong>${escapeHtml(r.plate || "Plaka yok")}</strong><div class="muted">${escapeHtml(r.customer_name || "-")}</div></div><span class="badge status-${escapeHtml(r.status || "bos")}">${formatRequestStatus(r.status)}</span></div><div>İstenen: <strong>${escapeHtml(r.requested_text || "-")}</strong></div><div>Araç: ${escapeHtml([r.vehicle_brand, r.vehicle_model, r.vehicle_type, r.vehicle_year].filter(Boolean).join(" ") || "-")}</div><div>Tarih: ${formatDate(r.created_at)}</div></div>`).join("") : `<div class="empty-state">Talep bulunamadı</div>`;
  moveBox.innerHTML = moves.length ? moves.map(m => `<div class="movement-item"><div class="movement-top"><div><strong>${escapeHtml(m.stock_products?.product_name || m.description || "-")}</strong><div class="muted">${escapeHtml(m.description || "-")}</div></div><span class="badge ${String(m.movement_type || "").includes("iade") ? "giris" : "cikis"}">${escapeHtml(m.movement_type || "-")}</span></div><div>Miktar: <strong>${Number(m.quantity || 0)}</strong></div><div>Plaka: <strong>${escapeHtml(m.plate || "-")}</strong></div><div>Kayıt No: <strong>${escapeHtml(m.record_no || "-")}</strong></div><div>Tarih: <strong>${formatDate(m.created_at)}</strong></div></div>`).join("") : `<div class="empty-state">Hareket bulunamadı</div>`;
};

