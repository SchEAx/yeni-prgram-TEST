// Garage İstanbul - Migration Test Excel API bridge v12.0
// Bu dosya eski Supabase Excel fonksiyonlarını PostgreSQL API ile override eder.

state.migrationExcelFilterOptions = state.migrationExcelFilterOptions || {
  product_brands: [],
  categories: [],
  vehicle_brands: [],
  total_products: 0
};

function migrationExcelQueryString(filters = getExcelFilterValues()) {
  const params = new URLSearchParams();
  if (filters.productBrand) params.set("product_brand", filters.productBrand);
  if (filters.category) params.set("category", filters.category);
  if (filters.carBrand) params.set("vehicle_brand", filters.carBrand);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function loadMigrationExcelFilterOptions(force = false) {
  if (
    !force
    && Number(state.migrationExcelFilterOptions?.total_products || 0) > 0
    && Array.isArray(state.migrationExcelFilterOptions?.categories)
  ) {
    refreshMigrationExcelFilters();
    return state.migrationExcelFilterOptions;
  }

  const payload = await apiFetch("/api/excel/filter-options");
  state.migrationExcelFilterOptions = {
    product_brands: Array.isArray(payload.product_brands) ? payload.product_brands : [],
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    vehicle_brands: Array.isArray(payload.vehicle_brands) ? payload.vehicle_brands : [],
    total_products: Number(payload.total_products || 0)
  };

  refreshMigrationExcelFilters();
  return state.migrationExcelFilterOptions;
}
window.loadMigrationExcelFilterOptions = loadMigrationExcelFilterOptions;

function refreshMigrationExcelFilters() {
  const opts = state.migrationExcelFilterOptions || {};
  setSelectOptions(
    el.excelProductBrandFilter,
    opts.product_brands || [],
    "Tüm ürün markaları"
  );
  setSelectOptions(
    el.excelCategoryFilter,
    opts.categories || [],
    "Tüm kategoriler"
  );
  setSelectOptions(
    el.excelCarBrandFilter,
    opts.vehicle_brands || [],
    "Tüm araç markaları"
  );
  updateMigrationExcelFilterSummary();
}

function updateMigrationExcelFilterSummary() {
  if (!el.excelFilterSummary) return;
  const filters = getExcelFilterValues();
  const active = Object.values(filters).filter(Boolean);
  const total = Number(state.migrationExcelFilterOptions?.total_products || 0);

  el.excelFilterSummary.textContent = active.length
    ? `Aktif filtre: ${active.join(" / ")} · İndirilecek gerçek kayıt sayısı PostgreSQL'den alınacak.`
    : `${total.toLocaleString("tr-TR")} ürün seçili. Tüm stok listesi.`;
}

// Eski state.products tabanlı filtre fonksiyonlarını override et.
refreshExcelFilters = function() {
  refreshMigrationExcelFilters();
};
window.refreshExcelFilters = refreshExcelFilters;

updateExcelFilterSummary = function() {
  updateMigrationExcelFilterSummary();
};
window.updateExcelFilterSummary = updateExcelFilterSummary;

window.clearExcelFilters = function() {
  [el.excelProductBrandFilter, el.excelCategoryFilter, el.excelCarBrandFilter]
    .filter(Boolean)
    .forEach(select => { select.value = ""; });
  updateMigrationExcelFilterSummary();
};

// İndirmeler artık tek seferde PostgreSQL API'den gelir.
fetchProductsForExcel = async function() {
  const filters = getExcelFilterValues();
  const payload = await apiFetch(
    "/api/excel/products" + migrationExcelQueryString(filters)
  );
  const rows = Array.isArray(payload.products) ? payload.products : [];
  return rows.map(mapProduct);
};
window.fetchProductsForExcel = fetchProductsForExcel;

function migrationExcelCell(value) {
  return String(value ?? "").trim();
}

function migrationExcelNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const normalized = String(value).replace(",", ".").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function migrationExcelRowsFromSheet(sheet) {
  const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows = [];
  let skipped = 0;

  for (const r of sourceRows) {
    const row = {
      id: migrationExcelCell(r.id),
      barcode: migrationExcelCell(r.barkod ?? r.barcode) || null,
      product_brand: migrationExcelCell(r.urun_markasi ?? r.product_brand) || null,
      category: migrationExcelCell(r.kategori ?? r.category) || null,
      vehicle_brand: migrationExcelCell(r.arac_markasi ?? r.vehicle_brand) || null,
      vehicle_model: migrationExcelCell(r.arac_modeli ?? r.vehicle_model) || null,
      vehicle_type: migrationExcelCell(r.arac_tipi ?? r.vehicle_type) || null,
      vehicle_year: migrationExcelCell(r.model_yili ?? r.vehicle_year) || null,
      quantity: migrationExcelNumber(r.mevcut_stok ?? r.quantity, 0),
      min_stock: migrationExcelNumber(r.minimum_stok ?? r.min_stock, 0),
      purchase_price: migrationExcelNumber(r.alis_fiyati ?? r.purchase_price, 0),
      average_sale_price: migrationExcelNumber(
        r.ortalama_satis_fiyati ?? r.average_sale_price,
        0
      ),
      location: migrationExcelCell(r.raf_konum ?? r.location) || null,
      note: migrationExcelCell(r.aciklama ?? r.note) || null,
      image_url: migrationExcelCell(
        r.resim_url ?? r.image_url ?? r.gorsel_url
      ) || null
    };

    // Tamamen boş satırları API'ye göndermeyelim.
    const meaningful = [
      row.id,
      row.barcode,
      row.product_brand,
      row.category,
      row.vehicle_brand,
      row.vehicle_model,
      row.location,
      row.note
    ].some(Boolean)
      || Number(row.quantity || 0) !== 0
      || Number(row.purchase_price || 0) !== 0
      || Number(row.average_sale_price || 0) !== 0;

    if (!meaningful) {
      skipped++;
      continue;
    }

    rows.push(row);
  }

  return { rows, skipped, source_count: sourceRows.length };
}

function migrationExcelErrorText(errors = []) {
  const safe = Array.isArray(errors) ? errors : [];
  if (!safe.length) return "";
  const lines = safe.slice(0, 12).map(err => {
    const row = Number(err?.row || 0);
    const prefix = row > 0 ? `Satır ${row}` : "Genel";
    return `• ${prefix}: ${err?.message || "Bilinmeyen hata"}`;
  });
  if (safe.length > 12) lines.push(`• ... ve ${safe.length - 12} hata daha`);
  return lines.join("\n");
}

function migrationExcelPreviewText(preview = {}, skipped = 0) {
  return [
    `Toplam işlenecek satır: ${Number(preview.row_count || 0)}`,
    `Yeni ürün: ${Number(preview.inserted_count || 0)}`,
    `Güncellenecek ürün: ${Number(preview.updated_count || 0)}`,
    `Stok hareketi oluşacak: ${Number(preview.stock_movement_count || 0)}`,
    `Toplam stok girişi: +${Number(preview.stock_in_quantity || 0)}`,
    `Toplam stok çıkışı: -${Number(preview.stock_out_quantity || 0)}`,
    `Stoku değişmeyen: ${Number(preview.unchanged_stock_count || 0)}`,
    skipped ? `Boş olduğu için atlanan satır: ${skipped}` : ""
  ].filter(Boolean).join("\n");
}

uploadStockExcel = async function(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  let progressOpened = false;

  try {
    if (!window.XLSX) throw new Error("Excel modülü yüklenemedi");

    const firstConfirm = await appConfirm(
      "Excel dosyası önce PostgreSQL üzerinde önizlenecek.\n\nID olan satırlar güncellenecek, ID boş satırlar yeni ürün olacak. Stok farkları Hareketler'e giriş/çıkış olarak yazılacak.\n\nDevam edilsin mi?",
      {
        title: "Excel yükleme",
        okText: "Dosyayı Kontrol Et",
        cancelText: "Vazgeç"
      }
    );

    if (!firstConfirm) {
      input.value = "";
      return;
    }

    showToast("Excel okunuyor...");
    createExcelProgress();
    progressOpened = true;
    updateExcelProgress(10, 100, 0, 0);

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel dosyasında sayfa bulunamadı");

    const parsed = migrationExcelRowsFromSheet(workbook.Sheets[sheetName]);
    const rows = parsed.rows;

    if (!rows.length) throw new Error("Excel dosyasında işlenecek satır yok");
    if (rows.length > 15000) {
      throw new Error(`Tek yüklemede en fazla 15.000 satır destekleniyor. Bu dosya: ${rows.length}`);
    }

    updateExcelProgress(30, 100, 0, 0);

    const previewPayload = await apiFetch("/api/excel/import/preview", {
      method: "POST",
      body: { rows }
    });

    const preview = previewPayload.preview || {};
    const errors = Array.isArray(previewPayload.errors) ? previewPayload.errors : [];

    updateExcelProgress(45, 100, 0, errors.length);

    if (previewPayload.can_apply !== true) {
      closeExcelProgress(0);
      progressOpened = false;

      await appConfirm(
        `Excel uygulanamadı.\n\n${migrationExcelErrorText(errors) || "Satırlarda doğrulama hatası var."}`,
        {
          title: "Excel Hataları",
          okText: "Tamam",
          cancelText: "Kapat",
          danger: true
        }
      );
      input.value = "";
      return;
    }

    const finalConfirm = await appConfirm(
      `${migrationExcelPreviewText(preview, parsed.skipped)}\n\nBu işlem tek transaction içinde uygulanacak. Devam edilsin mi?`,
      {
        title: "Excel Önizleme",
        okText: "Uygula",
        cancelText: "Vazgeç",
        danger: true
      }
    );

    if (!finalConfirm) {
      closeExcelProgress(0);
      progressOpened = false;
      input.value = "";
      return;
    }

    updateExcelProgress(65, 100, 0, 0);

    const applyPayload = await apiFetch("/api/excel/import/apply", {
      method: "POST",
      body: {
        rows,
        confirm_count: Number(preview.row_count || rows.length)
      }
    });

    const result = applyPayload.result || {};

    updateExcelProgress(
      100,
      100,
      Number(result.processed_rows || rows.length),
      0
    );

    closeExcelProgress();
    progressOpened = false;

    // Backend zaten excel_stock_upload logunu yazıyor. Çift log oluşturma.
    state.operationFilterOptionsLoaded = false;
    state.operationCacheKey = "";
    state.migrationExcelFilterOptions = {
      product_brands: [],
      categories: [],
      vehicle_brands: [],
      total_products: 0
    };

    await Promise.allSettled([
      loadDashboardStats(),
      loadMovements(),
      loadOperationFilterOptions(),
      loadMigrationExcelFilterOptions(true),
      typeof loadCategoryValues === "function" ? loadCategoryValues() : Promise.resolve()
    ]);

    showToast(
      `Excel tamamlandı ✅ ${Number(result.inserted_products || 0)} yeni · ${Number(result.updated_products || 0)} güncelleme · ${Number(result.stock_movements || 0)} stok hareketi`
    );

    input.value = "";

  } catch (err) {
    console.error(err);
    if (progressOpened) closeExcelProgress(0);
    showToast(err?.message || "Excel yüklenemedi", true);
    if (input) input.value = "";
  }
};
window.uploadStockExcel = uploadStockExcel;

// Events.js eski fonksiyon referansını listener'a bağladığı için kendi listener'ımızı da ekliyoruz.
[el.excelProductBrandFilter, el.excelCategoryFilter, el.excelCarBrandFilter]
  .filter(Boolean)
  .forEach(select => {
    if (select.dataset.migrationExcelListener === "1") return;
    select.dataset.migrationExcelListener = "1";
    select.addEventListener("change", () => updateMigrationExcelFilterSummary());
  });

// Sayfa açıldığında filtreleri API'den doldur.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    loadMigrationExcelFilterOptions().catch(err =>
      console.warn("Excel filtreleri alınamadı:", err?.message || err)
    );
  }, { once: true });
} else {
  loadMigrationExcelFilterOptions().catch(err =>
    console.warn("Excel filtreleri alınamadı:", err?.message || err)
  );
}
