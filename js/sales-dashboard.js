// Satış: ortak hesaplar ve satış dashboard yardımcıları
function formatSaleMoney(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function saleAvailable(product) {
  return Number(product?.stock || 0) - Number(product?.reserved || 0);
}

function isSameTurkeyDate(value, date = new Date()) {
  if (!value) return false;
  const tr = new Date(value).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  const now = date.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  return tr === now;
}

function parseSaleMovement(m) {
  const desc = String(m.description || "");
  const movementType = String(m.movement_type || "").toLowerCase();
  const isRefund = movementType === "hizli_satis_iade" || desc.toLocaleLowerCase("tr-TR").includes("hızlı satış iade");
  const isSale = movementType === "hizli_satis" || isRefund || desc.toLocaleLowerCase("tr-TR").includes("hızlı satış");
  if (!isSale) return null;

  const paymentMatch = desc.match(/Hızlı satış \((.*?)\)/i);
  const totalMatch = desc.match(/Toplam:\s*([^\-]+)/i);
  const unitMatch = desc.match(/Birim:\s*([^\-]+)/i);
  const qty = Number(m.quantity || 0);

  const parseMoney = (txt) => {
    const cleaned = String(txt || "")
      .replace(/[^0-9,\.]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    return Number(cleaned || 0);
  };

  const total = totalMatch ? parseMoney(totalMatch[1]) : (unitMatch ? parseMoney(unitMatch[1]) * qty : 0);

  return {
    paymentType: paymentMatch ? paymentMatch[1].trim() : "Bilinmiyor",
    total: isRefund ? -Math.abs(total) : total,
    qty: isRefund ? -Math.abs(qty) : qty,
    productName: m.stock_products?.product_name || m.description || "Ürün",
    isRefund
  };
}

function todaySaleStats() {
  const todays = (state.movements || [])
    .filter(m => isSameTurkeyDate(m.created_at))
    .map(parseSaleMovement)
    .filter(Boolean);

  const stats = {
    total: 0,
    qty: 0,
    cash: 0,
    card: 0,
    partial: 0,
    none: 0,
    top: new Map()
  };

  todays.forEach(s => {
    stats.total += Number(s.total || 0);
    stats.qty += Number(s.qty || 0);
    const p = String(s.paymentType || "").toLocaleLowerCase("tr-TR");
    if (p.includes("nakit")) stats.cash += Number(s.total || 0);
    else if (p.includes("kart")) stats.card += Number(s.total || 0);
    else if (p.includes("kısmi") || p.includes("kismi")) stats.partial += Number(s.total || 0);
    else stats.none += Number(s.total || 0);

    const key = s.productName || "Ürün";
    const old = stats.top.get(key) || { name: key, qty: 0, total: 0 };
    old.qty += Number(s.qty || 0);
    old.total += Number(s.total || 0);
    stats.top.set(key, old);
  });

  return stats;
}

function renderSaleDashboard() {
  const stats = todaySaleStats();
  if (el.todaySaleTotal) el.todaySaleTotal.textContent = formatSaleMoney(stats.total);
  if (el.todaySaleQty) el.todaySaleQty.textContent = String(stats.qty || 0);
  if (el.todayCashTotal) el.todayCashTotal.textContent = formatSaleMoney(stats.cash);
  if (el.todayCardTotal) el.todayCardTotal.textContent = formatSaleMoney(stats.card);

  if (el.topSaleProducts) {
    const top = [...stats.top.values()].sort((a, b) => b.qty - a.qty || b.total - a.total).slice(0, 5);
    el.topSaleProducts.innerHTML = top.length ? top.map((item, index) => `
      <div class="top-sale-item">
        <span>${index + 1}</span>
        <div><strong>${escapeHtml(item.name)}</strong><small>${item.qty} adet · ${formatSaleMoney(item.total)}</small></div>
      </div>
    `).join("") : `<div class="empty-state">Henüz hızlı satış yok</div>`;
  }
}



