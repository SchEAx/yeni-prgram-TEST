// Satın alma / verilen siparişler
// ==================== SATIN ALMA / SİPARİŞ HAVUZU ====================
let purchaseDraftRealtimeChannel = null;
function purchaseProductById(id) {
  return [...(state.operationResults || []), ...(state.products || [])].find(p => String(p.id) === String(id));
}
async function loadSharedPurchaseOrderDraft() {
  try {
    const { data, error } = await supabaseClient
      .from("purchase_order_draft_items")
      .select("product_id,quantity,supplier_hint,note,updated_at,stock_products(product_name,product_brand,category,vehicle_brand,vehicle_model,vehicle_type,vehicle_year)")
      .order("updated_at", { ascending: true });
    if (error) throw error;
    state.purchaseOrderDraft = (data || []).map(row => {
      const p = row.stock_products || {};
      return {
        productId: row.product_id,
        name: p.product_name || p.category || "Ürün",
        productBrand: p.product_brand || "",
        category: p.category || "",
        detail: [p.product_brand, p.category, p.vehicle_brand, p.vehicle_model, p.vehicle_type, p.vehicle_year].filter(Boolean).join(" · "),
        quantity: Number(row.quantity || 1),
        supplierHint: row.supplier_hint || p.product_brand || "",
        note: row.note || ""
      };
    });
    renderPurchaseOrderDraft();
  } catch (err) {
    console.error(err);
    showToast("Sipariş havuzu alınamadı. v3.7 SQL dosyasını çalıştır.", true);
  }
}
function subscribeSharedPurchaseOrderDraft() {
  if (purchaseDraftRealtimeChannel || !supabaseClient?.channel) return;
  purchaseDraftRealtimeChannel = supabaseClient
    .channel("shared-purchase-order-draft")
    .on("postgres_changes", { event: "*", schema: "public", table: "purchase_order_draft_items" }, () => loadSharedPurchaseOrderDraft().catch(() => {}))
    .subscribe();
}
function renderPurchaseOrderDraft() {
  if (!el.purchaseDraftList) return;
  const rows = state.purchaseOrderDraft || [];
  if (!rows.length) {
    el.purchaseDraftList.innerHTML = `<div class="empty-state">Sipariş havuzunda ürün yok</div>`;
    if (el.purchaseDraftTotal) el.purchaseDraftTotal.textContent = "0";
    return;
  }
  el.purchaseDraftList.innerHTML = rows.map(item => `<div class="purchase-draft-item">
    <div><strong>${escapeHtml(item.name)}</strong><div class="muted">${escapeHtml(item.detail || "-")}</div></div>
    <input type="number" min="1" value="${Number(item.quantity || 1)}" onchange="setPurchaseOrderItemQty('${item.productId}', this.value)" aria-label="Sipariş miktarı"/>
    <input class="draft-supplier" type="text" value="${escapeHtml(item.supplierHint || "")}" placeholder="Tedarikçi / marka" onchange="setPurchaseDraftSupplier('${item.productId}', this.value)"/>
    <button class="btn success mini create-order-item" type="button" onclick="openPurchaseOrderGroupModal('${item.productId}')">Sipariş Oluştur</button>
    <button class="btn danger mini remove-order-item" type="button" onclick="removePurchaseOrderItem('${item.productId}')">Kaldır</button>
  </div>`).join("");
  if (el.purchaseDraftTotal) el.purchaseDraftTotal.textContent = rows.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
}
window.addProductToPurchaseOrder = async function(productId) {
  if (!requireUserAction("addToOrderPool", "Sipariş havuzuna ekleme yetkin yok")) return;
  const p = purchaseProductById(productId);
  if (!p) return showToast("Ürün bulunamadı", true);
  if (!canAccessCategory(p.category)) return showToast("Bu ürün kategorisine yetkin yok", true);
  const qty = getOperationQty(productId);
  try {
    const { error } = await supabaseClient.rpc("add_purchase_order_draft_item", { p_product_id: productId, p_quantity: qty, p_actor: currentStaff().name });
    if (error) throw error;
    await loadSharedPurchaseOrderDraft();
    showToast(`${p.name || p.category || "Ürün"} sipariş havuzuna eklendi ✅`);
  } catch (err) { console.error(err); showToast(err.message || "Ürün havuza eklenemedi", true); }
};
window.setPurchaseOrderItemQty = async function(productId, value) {
  const qty = Math.max(1, Number(value || 1));
  const { error } = await supabaseClient.from("purchase_order_draft_items").update({ quantity: qty, updated_at: new Date().toISOString(), added_by: currentStaff().name }).eq("product_id", productId);
  if (error) return showToast(error.message, true);
  await loadSharedPurchaseOrderDraft();
};
window.setPurchaseDraftSupplier = async function(productId, value) {
  const { error } = await supabaseClient.from("purchase_order_draft_items").update({ supplier_hint: String(value || "").trim() || null, updated_at: new Date().toISOString() }).eq("product_id", productId);
  if (error) return showToast(error.message, true);
  const row = state.purchaseOrderDraft.find(x => String(x.productId) === String(productId));
  if (row) row.supplierHint = String(value || "").trim();
};
window.removePurchaseOrderItem = async function(productId) {
  const { error } = await supabaseClient.from("purchase_order_draft_items").delete().eq("product_id", productId);
  if (error) return showToast(error.message, true);
  await loadSharedPurchaseOrderDraft();
};
window.clearPurchaseOrderDraft = async function() {
  if (!state.purchaseOrderDraft.length) return;
  if (!(await appConfirm("Sipariş havuzu bütün cihazlarda temizlensin mi?", { danger: true, okText: "Temizle" }))) return;
  const { error } = await supabaseClient.from("purchase_order_draft_items").delete().not("product_id", "is", null);
  if (error) return showToast(error.message, true);
  await loadSharedPurchaseOrderDraft();
};
function purchaseOrderNo() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `TS${yy}${mm}${String(Date.now()).slice(-6)}`;
}
function selectedPurchaseGroupIds() {
  return [...document.querySelectorAll('[data-purchase-group-item]:checked')].map(x => x.value);
}
function updatePurchaseGroupSelectedCount() {
  if (el.purchaseGroupSelectedCount) el.purchaseGroupSelectedCount.textContent = String(selectedPurchaseGroupIds().length);
}
window.selectAllPurchaseItems = function(checked = true) {
  document.querySelectorAll('[data-purchase-group-item]').forEach(x => { x.checked = !!checked; });
  updatePurchaseGroupSelectedCount();
};
window.selectSameSupplierPurchaseItems = function() {
  const supplier = String(el.purchaseGroupSupplier?.value || "").trim().toLocaleLowerCase("tr-TR");
  const seed = state.purchaseOrderDraft.find(x => String(x.productId) === String(state.purchaseGroupSeedProductId));
  document.querySelectorAll('[data-purchase-group-item]').forEach(box => {
    const row = state.purchaseOrderDraft.find(x => String(x.productId) === String(box.value));
    const hint = String(row?.supplierHint || row?.productBrand || "").trim().toLocaleLowerCase("tr-TR");
    box.checked = !!supplier && hint === supplier;
  });
  if (seed) {
    const seedBox = document.querySelector(`[data-purchase-group-item][value="${seed.productId}"]`);
    if (seedBox) seedBox.checked = true;
  }
  updatePurchaseGroupSelectedCount();
};
window.openPurchaseOrderGroupModal = async function(seedProductId = null) {
  await loadSharedPurchaseOrderDraft();
  if (!state.purchaseOrderDraft.length) return showToast("Sipariş havuzunda ürün yok", true);
  state.purchaseGroupSeedProductId = seedProductId || null;
  const seed = state.purchaseOrderDraft.find(x => String(x.productId) === String(seedProductId));
  const suggestedSupplier = seed?.supplierHint || seed?.productBrand || "";
  if (el.purchaseGroupSupplier) el.purchaseGroupSupplier.value = suggestedSupplier;
  if (el.purchaseGroupExpectedDate) el.purchaseGroupExpectedDate.value = el.purchaseExpectedDate?.value || "";
  if (el.purchaseGroupNote) el.purchaseGroupNote.value = el.purchaseOrderNote?.value || "";
  if (el.purchaseGroupItemList) {
    el.purchaseGroupItemList.innerHTML = state.purchaseOrderDraft.map(item => {
      const sameSupplier = suggestedSupplier && String(item.supplierHint || item.productBrand || "").toLocaleLowerCase("tr-TR") === String(suggestedSupplier).toLocaleLowerCase("tr-TR");
      const checked = !seedProductId || String(item.productId) === String(seedProductId) || sameSupplier;
      return `<label class="purchase-group-row"><input data-purchase-group-item type="checkbox" value="${item.productId}" ${checked ? "checked" : ""} onchange="updatePurchaseGroupSelectedCount()"/><div><strong>${escapeHtml(item.name)}</strong><div class="muted">${escapeHtml(item.detail || "-")}</div></div><strong>${Number(item.quantity)} adet</strong></label>`;
    }).join("");
  }
  updatePurchaseGroupSelectedCount();
  el.purchaseGroupModal?.classList.remove("hidden");
};
window.closePurchaseOrderGroupModal = function() { el.purchaseGroupModal?.classList.add("hidden"); };
window.updatePurchaseGroupSelectedCount = updatePurchaseGroupSelectedCount;
window.createGroupedPurchaseOrder = async function() {
  const ids = selectedPurchaseGroupIds();
  if (!ids.length) return showToast("En az bir ürün seç", true);
  const supplier = String(el.purchaseGroupSupplier?.value || "").trim();
  if (!supplier) return showToast("Tedarikçi adını yaz", true);
  const selected = state.purchaseOrderDraft.filter(x => ids.includes(String(x.productId)));
  if (!(await appConfirm(`${supplier} için ${selected.length} kalem sipariş oluşturulsun mu?`, { okText: "Sipariş Oluştur" }))) return;
  try {
    setLoading(true);
    const orderNo = purchaseOrderNo();
    const { data: order, error: orderError } = await supabaseClient.from("purchase_orders").insert({ order_no: orderNo, supplier, expected_date: el.purchaseGroupExpectedDate?.value || null, note: String(el.purchaseGroupNote?.value || "").trim() || null, status: "bekleniyor", created_by: currentStaff().name }).select("id").single();
    if (orderError) throw orderError;
    const items = selected.map(i => ({ order_id: order.id, product_id: i.productId, ordered_quantity: Number(i.quantity), received_quantity: 0 }));
    const { error: itemError } = await supabaseClient.from("purchase_order_items").insert(items);
    if (itemError) throw itemError;
    const { error: clearError } = await supabaseClient.from("purchase_order_draft_items").delete().in("product_id", ids);
    if (clearError) throw clearError;
    await logActivity("purchase_order_create", `${orderNo} - ${supplier} - ${items.length} kalem`, "purchase_orders", order.id);
    closePurchaseOrderGroupModal();
    await Promise.all([loadSharedPurchaseOrderDraft(), loadPurchaseOrders()]);
    showToast(`Sipariş oluşturuldu: ${orderNo} ✅`);
  } catch (err) { console.error(err); showToast(err.message || "Sipariş oluşturulamadı", true); }
  finally { setLoading(false); }
};
window.savePurchaseOrder = window.createGroupedPurchaseOrder;
function purchaseOrderStatusLabel(status) {
  return status === "tamamlandi" ? "Tamamlandı" : status === "kismi" ? "Kısmi Geldi" : status === "iptal" ? "İptal" : "Sipariş Verildi";
}
function renderPurchaseOrders() {
  if (!el.purchaseOrderList) return;
  const rows = state.purchaseOrders || [];
  const waiting = rows.filter(o => ["bekleniyor", "kismi"].includes(o.status));
  if (el.purchaseOrderBadge) { el.purchaseOrderBadge.textContent = String(waiting.length); el.purchaseOrderBadge.classList.toggle("hidden", waiting.length === 0); }
  if (!rows.length) { el.purchaseOrderList.innerHTML = `<div class="empty-state">Henüz oluşturulmuş sipariş yok</div>`; return; }
  el.purchaseOrderList.innerHTML = rows.map(o => {
    const items = o.purchase_order_items || [];
    const active = ["bekleniyor", "kismi"].includes(o.status);
    return `<div class="purchase-order-card">
      <div class="movement-top"><div><strong>${escapeHtml(o.order_no || "Sipariş")}</strong><div class="muted">${escapeHtml(o.supplier || "-")} · ${formatDate(o.created_at)}</div></div><span class="badge ${o.status === "tamamlandi" ? "giris" : "status-bekliyor"}">${purchaseOrderStatusLabel(o.status)}</span></div>
      ${o.expected_date ? `<div>Tahmini geliş: <strong>${escapeHtml(o.expected_date)}</strong></div>` : ""}
      ${o.note ? `<div>Not: <strong>${escapeHtml(o.note)}</strong></div>` : ""}
      <div class="partial-receive-grid">${items.map(i => { const ordered=Number(i.ordered_quantity||0), received=Number(i.received_quantity||0), remaining=Math.max(ordered-received,0); return `<div class="partial-receive-row"><span>${escapeHtml(i.stock_products?.product_name || "Ürün")}<div class="order-progress">Sipariş: ${ordered} · Gelen: ${received} · Kalan: ${remaining}</div></span>${active && remaining>0 ? `<div class="partial-input-wrap"><input type="number" min="0" max="${remaining}" value="0" data-receive-order="${o.id}" data-receive-item="${i.id}" aria-label="Gelen adet"/><button class="btn ghost mini" type="button" onclick="fillPurchaseReceiveRemaining('${o.id}','${i.id}',${remaining})">Kalanı Yaz</button></div>` : ""}<strong>${remaining} kalan</strong></div>`; }).join("")}</div>
      ${active ? `<div class="purchase-order-actions"><button class="btn success" onclick="receivePurchaseOrderPartial('${o.id}')">Gelenleri Stoğa İşle</button><button class="btn primary" onclick="receivePurchaseOrderAll('${o.id}')">📦 Tamamını Al</button><button class="btn danger" onclick="cancelPurchaseOrder('${o.id}')">İptal Et</button></div>` : ""}
    </div>`;
  }).join("");
}
window.loadPurchaseOrders = async function() {
  if (!el.purchaseOrderList) return;
  try {
    const { data, error } = await supabaseClient.from("purchase_orders")
      .select("id,order_no,supplier,expected_date,note,status,created_at,completed_at,purchase_order_items(id,product_id,ordered_quantity,received_quantity,stock_products(product_name,category,vehicle_brand,vehicle_model))")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    state.purchaseOrders = data || [];
    renderPurchaseOrders();
  } catch (err) { console.error(err); el.purchaseOrderList.innerHTML = `<div class="empty-state">Siparişler alınamadı. v3.7 SQL dosyasını çalıştır.</div>`; }
};
window.fillPurchaseReceiveRemaining = function(orderId, itemId, remaining) {
  const input = document.querySelector(`[data-receive-order="${orderId}"][data-receive-item="${itemId}"]`);
  if (input) input.value = Math.max(0, Number(remaining || 0));
};
window.receivePurchaseOrderPartial = async function(orderId) {
  const inputs = [...document.querySelectorAll(`[data-receive-order="${orderId}"]`)];
  const lines = inputs.map(x => ({ item_id: x.dataset.receiveItem, quantity: Number(x.value || 0) })).filter(x => x.quantity > 0);
  if (!lines.length) return showToast("Gelen adetleri yaz", true);
  if (!(await appConfirm(`${lines.length} kalem için girilen miktarlar stoğa işlensin mi?`, { okText: "Stoğa İşle" }))) return;
  try {
    setLoading(true);
    const { error } = await supabaseClient.rpc("receive_purchase_order_partial", { p_order_id: orderId, p_lines: lines, p_actor: currentStaff().name });
    if (error) throw error;
    await logActivity("purchase_receive_partial", `${lines.length} kalem / ${lines.reduce((s,x)=>s+Number(x.quantity||0),0)} adet sipariş stoğa işlendi`, "purchase_orders", orderId);
    await Promise.all([loadPurchaseOrders(), loadDashboardStats(), loadMovements()]);
    showToast("Gelen ürünler stoğa işlendi ✅");
  } catch (err) { console.error(err); showToast(err.message || "Kısmi giriş yapılamadı", true); }
  finally { setLoading(false); }
};
window.receivePurchaseOrderAll = async function(orderId) {
  const order = state.purchaseOrders.find(o => String(o.id) === String(orderId));
  if (!order) return;
  const lines = (order.purchase_order_items || []).map(i => ({ item_id: i.id, quantity: Math.max(Number(i.ordered_quantity||0)-Number(i.received_quantity||0),0) })).filter(x => x.quantity>0);
  if (!lines.length) return showToast("Bu siparişte bekleyen ürün yok", true);
  if (!(await appConfirm(`Siparişte kalan toplam ${lines.reduce((s,x)=>s+x.quantity,0)} ürün stoğa işlensin mi?`, { okText: "Tamamını Al" }))) return;
  try {
    setLoading(true);
    const { error } = await supabaseClient.rpc("receive_purchase_order_partial", { p_order_id: orderId, p_lines: lines, p_actor: currentStaff().name });
    if (error) throw error;
    await logActivity("purchase_receive_all", `${lines.length} kalem / ${lines.reduce((s,x)=>s+Number(x.quantity||0),0)} adet siparişin kalanı stoğa işlendi`, "purchase_orders", orderId);
    await Promise.all([loadPurchaseOrders(), loadDashboardStats(), loadMovements()]);
    showToast("Siparişin kalanının tamamı stoğa işlendi ✅");
  } catch (err) { console.error(err); showToast(err.message || "Sipariş stoğa işlenemedi", true); }
  finally { setLoading(false); }
};
window.receivePurchaseOrder = window.receivePurchaseOrderAll;
window.cancelPurchaseOrder = async function(orderId) {
  const order = state.purchaseOrders.find(o => String(o.id) === String(orderId));
  if (!order || !(await appConfirm(`${order.order_no} iptal edilsin mi? Stok değişmeyecek.`, { danger: true, okText: "İptal Et" }))) return;
  const { error } = await supabaseClient.from("purchase_orders").update({ status: "iptal" }).eq("id", orderId).in("status", ["bekleniyor", "kismi"]);
  if (error) return showToast(error.message, true);
  await logActivity("purchase_order_cancel", `${order.order_no || "Sipariş"} iptal edildi`, "purchase_orders", orderId);
  await loadPurchaseOrders(); showToast("Sipariş iptal edildi");
};

