// Talepler: rezervasyon ve talep için ürün arama
function softText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchProductsForRequest(query = "", autoSuggest = false) {
  const selectedReq = state.stockRequests.find(
    r => String(r.id) === String(state.selectedStockRequestId)
  );

  const rawQuery = String(query || "").trim();
  const q = softText(rawQuery);

  if (!state.products.length) {
    el.productMatchBox.innerHTML = `<div class="empty-state">Stok listesi yükleniyor...</div>`;
    try {
      await loadProducts();
    } catch (err) {
      console.error("Rezerve ürün arama için stoklar yüklenemedi:", err);
      el.productMatchBox.innerHTML = `<div class="empty-state">Stok listesi alınamadı: ${escapeHtml(err.message || err)}</div>`;
      return;
    }
  }

  const reqBrand = softText(selectedReq?.vehicle_brand);
  const reqModel = softText(selectedReq?.vehicle_model);
  const reqType = softText(selectedReq?.vehicle_type);
  const reqYear = softText(selectedReq?.vehicle_year);
  const reqText = softText(selectedReq?.requested_text);

  const searchSource = autoSuggest
    ? softText([reqText, reqBrand, reqModel, reqType, reqYear].filter(Boolean).join(" "))
    : q;

  if (!searchSource) {
    el.productMatchBox.innerHTML = `<div class="empty-state">Ürün aramak için yazmaya başla</div>`;
    return;
  }

  const words = searchSource
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => w.replace(/ligi$|liği$|lik$|lık$|luk$|lük$/g, ""));

  const results = state.products
    .map((p) => {
      const text = softText([
        p.name,
        p.productBrand,
        p.category,
        p.carBrand,
        p.carModel,
        p.carType,
        p.vehicleYear,
        p.location,
        p.note,
        p.barcode
      ].join(" "));

      const manualMatch = !autoSuggest && rawQuery
        ? (productSmartSearch(p, rawQuery) || barcodeSmartSearch(p, rawQuery))
        : false;

      let score = manualMatch ? 80 : 0;

      words.forEach(w => {
        if (text.includes(w)) score += 6;
      });

      if (q && text.includes(q)) score += 20;

      // Araç kabulden gelen araç bilgisi sonuç sıralamasını güçlendirir,
      // ama manuel aramada tek başına alakasız ürünleri öne çıkarmaz.
      if (reqBrand && softText(p.carBrand).includes(reqBrand)) score += 12;
      if (reqModel && softText(p.carModel).includes(reqModel)) score += 18;
      if (reqType && softText(p.carType).includes(reqType)) score += 8;
      if (reqYear && softText(p.vehicleYear).includes(reqYear)) score += 4;

      return { p, score, manualMatch };
    })
    .filter(x => autoSuggest ? x.score > 0 : x.manualMatch)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(x => x.p);

  if (!results.length) {
    el.productMatchBox.innerHTML = `<div class="empty-state">Eşleşen ürün bulunamadı</div>`;
    return;
  }

  el.productMatchBox.innerHTML = results.map((p) => {
    const available = Number(p.stock || 0) - Number(p.reserved || 0);

    return `
      <div class="movement-search-item">
        <div class="movement-search-info">
          <strong>${escapeHtml(p.category || p.name || "-")}</strong>
          <div class="muted">
            ${escapeHtml(p.productBrand || "-")} /
            ${escapeHtml(p.carBrand || "-")}
            ${escapeHtml(p.carModel || "-")}
            ${escapeHtml(p.carType || "-")}
            ${escapeHtml(p.vehicleYear || "")}
          </div>
          <div class="muted">
            Stok: ${p.stock} | Rezerve: ${p.reserved} | Kullanılabilir:
            <strong class="${available <= 0 ? "stock-warning" : ""}">${available}</strong>
          </div>
        </div>

        <div class="movement-search-actions">
          <input id="qty_${p.id}" type="number" value="1" min="1" style="max-width:90px" />
          <button
            class="btn primary"
            onclick="reserveProductForRequest('${p.id}')"
            ${available <= 0 ? "disabled" : ""}
          >
            ${available <= 0 ? "Stok Yok" : "Rezerve Et"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}


window.reserveProductForRequest = async function(productId) {
  if (!requireRoleAction(["admin", "depo"], "Rezervasyon yetkisi sadece Admin/Depo")) return;
  if (!state.selectedStockRequestId) return showToast("Talep seçilmedi", true);
  const quantity = Number(document.getElementById("qty_" + productId)?.value || 1);
  if (!quantity || quantity <= 0) return showToast("Geçerli adet gir", true);
  try {
    setLoading(true);
    const requestId = state.selectedStockRequestId;
    const product = (state.products || []).find(p => String(p.id) === String(productId));
    const { error } = await legacyDisabledClient.rpc("reserve_stock_for_request", { p_request_id: requestId, p_product_id: productId, p_quantity: quantity, p_delivered_to: "" });
    if (error) throw error;
    await logActivity("stock_reserve", `${product?.name || product?.category || "Ürün"} için ${quantity} adet rezerve edildi`, "stock_requests", requestId);
    showToast("Stok rezerve edildi ✅ Yeni ürün ekleyebilirsin.");
    await loadAll();
    const stillSelected = state.stockRequests.find(r => String(r.id) === String(requestId));
    if (stillSelected) {
      state.selectedStockRequestId = requestId;
      el.reservationPanel.classList.remove("hidden");
      renderSelectedRequestDetail(stillSelected);
      searchProductsForRequest(el.productSearchInput.value);
    }
  } catch (err) { console.error(err); showToast(err.message || "Rezerve edilemedi", true); }
  finally { setLoading(false); }
};
window.cancelReservation = async function(requestId) {
  if (!requireRoleAction(["admin", "depo"], "Rezerv iptali yetkisi sadece Admin/Depo")) return;
  if (!(await appConfirm("Bu rezervi iptal etmek istediğine emin misin?", { danger: true, okText: "Rezervi İptal Et" }))) return;
  try {
    setLoading(true);
    const { error } = await legacyDisabledClient.rpc("cancel_stock_reservation", { p_request_id: requestId });
    if (error) throw error;
    await logActivity("stock_reservation_cancel", `Rezervasyon iptal edildi`, "stock_requests", requestId);
    showToast("Rezerv iptal edildi ✅");
    await loadAll();
  } catch (err) { console.error(err); showToast(err.message || "Rezerv iptal edilemedi", true); }
  finally { setLoading(false); }
};

