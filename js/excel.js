// Excel indirme/yükleme ve toplu stok raporu
async function fetchProductsForExcel() {
  const filters = getExcelFilterValues();
  let allRows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const to = from + pageSize - 1;
    let query = supabaseClient
      .from("stock_products")
      .select(STOCK_PRODUCT_SELECT)
      .order("product_name", { ascending: true })
      .range(from, to);

    if (filters.productBrand) query = query.eq("product_brand", filters.productBrand);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.carBrand) query = query.eq("vehicle_brand", filters.carBrand);

    const { data, error } = await query;
    if (error) throw error;
    allRows = allRows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return allRows.map(mapProduct);
}

async function downloadStockExcel() {
  try {
    const selectedProducts = await fetchProductsForExcel();
    if (!selectedProducts.length) {
      showToast("Bu filtrede indirilecek ürün yok", true);
      return;
    }

    showToast(`${selectedProducts.length} ürün için Excel hazırlanıyor...`);

    const rows = selectedProducts.map(p => ({
      id: p.id,
      barkod: String(p.barcode || ""),
      urun_markasi: p.productBrand || "",
      kategori: p.category || "",
      arac_markasi: p.carBrand || "",
      arac_modeli: p.carModel || "",
      arac_tipi: p.carType || "",
      model_yili: p.vehicleYear || "",
      mevcut_stok: p.stock || 0,
      minimum_stok: p.minStock || 0,
      alis_fiyati: p.purchasePrice || 0,
      ortalama_satis_fiyati: p.averageSalePrice || 0,
      raf_konum: p.location || "",
      aciklama: p.note || "",
      resim_url: p.imageUrl || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 38 }, { wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 18 },
      { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 32 }, { wch: 42 }
    ];

    // Barkodları metin olarak tut; baştaki sıfırlar Excel'de kaybolmasın.
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex++) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: 1 });
      if (!ws[address]) ws[address] = { t: "s", v: "", z: "@" };
      else {
        ws[address].t = "s";
        ws[address].v = String(ws[address].v ?? "");
        ws[address].z = "@";
      }
    }
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Stok");

    const filters = getExcelFilterValues();
    const fileSuffix = Object.values(filters).filter(Boolean).join("-")
      .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "tum-stok";

    const fileName = `stok-listesi-${fileSuffix}.xlsx`;
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);

    showToast(`Excel indirildi ✅ (${selectedProducts.length} ürün)`);

  } catch (err) {
    console.error(err);
    showToast("Excel indirilemedi", true);
  }
}


function buildGroupedStockRows(products) {
  return buildGroupedStockProductGroups(products)
    .map(group => {
      const p = group.first;
      const locationDetails = group.members
        .slice()
        .sort((a, b) => String(a.location || "").localeCompare(String(b.location || ""), "tr"))
        .map(item => {
          const location = String(item.location || "Konum yok").trim() || "Konum yok";
          const stock = Number(item.stock || 0);
          const reserved = Number(item.reserved || 0);
          const barcode = String(item.barcode || "").trim();
          return `${location}: ${stock} stok / ${reserved} rezerve${barcode ? ` / ${barcode}` : ""}`;
        })
        .join(" | ");

      return {
        barkodlar: [...group.barcodes].join(" / "),
        urun_markasi: p.productBrand || "",
        kategori: p.category || "",
        arac_markasi: p.carBrand || "",
        arac_modeli: p.carModel || "",
        arac_tipi: p.carType || "",
        model_yili: p.vehicleYear || "",
        toplam_stok: group.totalStock,
        toplam_rezerve: group.totalReserved,
        kullanilabilir_stok: group.totalStock - group.totalReserved,
        minimum_stok_toplami: group.minStockTotal,
        raf_konumlari: locationDetails,
        birlesen_kayit_sayisi: group.members.length
      };
    })
    .sort((a, b) => {
      const left = `${a.kategori} ${a.arac_markasi} ${a.arac_modeli} ${a.arac_tipi}`;
      const right = `${b.kategori} ${b.arac_markasi} ${b.arac_modeli} ${b.arac_tipi}`;
      return left.localeCompare(right, "tr");
    });
}

async function downloadGroupedStockExcel() {
  try {
    if (!window.XLSX) return showToast("Excel modülü yüklenemedi", true);

    const selectedProducts = await fetchProductsForExcel();
    if (!selectedProducts.length) return showToast("Bu filtrede indirilecek ürün yok", true);

    const rows = buildGroupedStockRows(selectedProducts);
    showToast(`${selectedProducts.length} kayıt ${rows.length} toplu üründe birleştiriliyor...`);

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 28 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 24 },
      { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
      { wch: 20 }, { wch: 35 }, { wch: 18 }
    ];

    // Barkodları metin tut; baştaki sıfırlar kaybolmasın.
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex++) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
      if (ws[address]) {
        ws[address].t = "s";
        ws[address].v = String(ws[address].v ?? "");
        ws[address].z = "@";
      }
    }

    const infoRows = [
      ["Garage İstanbul - Toplu Stok Raporu"],
      ["Açıklama", "Aynı ürün kartları; ürün markası, kategori ve araç marka/model/tip/yıl bilgilerine göre tek satırda birleştirilir."],
      ["Toplam Stok", "Birleşen tüm ürün kartlarının mevcut stok toplamıdır."],
      ["Raf Konumları", "Aynı ürünün bulunduğu tüm raf/konumlar listelenir."],
      ["Barkodlar", "Birleşen kartlarda birden fazla barkod varsa hepsi gösterilir."],
      ["Not", "Bu dosya rapor amaçlıdır. Toplu veri güncellemek için Barkodlu Excel İndir dosyasını kullan."]
    ];
    const infoWs = XLSX.utils.aoa_to_sheet(infoRows);
    infoWs["!cols"] = [{ wch: 24 }, { wch: 100 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Toplu Stok");
    XLSX.utils.book_append_sheet(wb, infoWs, "Bilgi");

    const filters = getExcelFilterValues();
    const fileSuffix = Object.values(filters).filter(Boolean).join("-")
      .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "tum-stok";

    XLSX.writeFile(wb, `toplu-stok-${fileSuffix}.xlsx`);
    showToast(`Toplu stok Excel indirildi ✅ (${selectedProducts.length} kayıt → ${rows.length} ürün)`);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Toplu stok Excel indirilemedi", true);
  }
}
window.downloadGroupedStockExcel = downloadGroupedStockExcel;

function normalizeExcelCell(value) {
  return String(value ?? "").trim();
}
function excelNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const normalized = String(value).replace(",", ".").trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

async function uploadStockExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  let progressOpened = false;

  try {
    const activeFilters = getExcelFilterValues();
    const activeFilterText = Object.values(activeFilters).filter(Boolean).join(" / ");
    const confirmed = await appConfirm(
      activeFilterText
        ? `Excel yüklenecek. Aktif filtre: ${activeFilterText}\n\nID olan satırlar güncellenecek, ID boş olan satırlar yeni ürün olarak eklenecek. Barkodlar toplu ve hızlı işlenecek. Devam edilsin mi?`
        : "Excel yüklenecek. ID olan satırlar güncellenecek, ID boş olan satırlar yeni ürün olarak eklenecek. Barkodlar toplu ve hızlı işlenecek. Devam edilsin mi?",
      { title: "Excel yükleme onayı", okText: "Yükle", cancelText: "Vazgeç" }
    );
    if (!confirmed) {
      event.target.value = "";
      return;
    }

    showToast("Excel okunuyor...");

    const buffer = await file.arrayBuffer();

    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const preparedRows = [];

    for (const r of rows) {
      const payload = {
        barcode: normalizeExcelCell(r.barkod) || null,
        product_brand: normalizeExcelCell(r.urun_markasi) || null,
        category: normalizeExcelCell(r.kategori) || null,
        vehicle_brand: normalizeExcelCell(r.arac_markasi) || null,
        vehicle_model: normalizeExcelCell(r.arac_modeli) || null,
        vehicle_type: normalizeExcelCell(r.arac_tipi) || null,
        vehicle_year: normalizeExcelCell(r.model_yili) || null,
        quantity: excelNumber(r.mevcut_stok, 0),
        min_stock: excelNumber(r.minimum_stok, 0),
        purchase_price: excelNumber(r.alis_fiyati ?? r.purchase_price, 0),
        average_sale_price: excelNumber(r.ortalama_satis_fiyati ?? r.average_sale_price, 0),
        location: normalizeExcelCell(r.raf_konum) || null,
        note: normalizeExcelCell(r.aciklama) || null,
        image_url: normalizeExcelCell(r.resim_url || r.image_url || r.gorsel_url) || null,
        image_thumb_url: normalizeExcelCell(r.resim_url || r.image_url || r.gorsel_url) || null
      };

      payload.product_name = [
        payload.product_brand,
        payload.category,
        payload.vehicle_brand,
        payload.vehicle_model,
        payload.vehicle_type,
        payload.vehicle_year
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || payload.category || "Ürün";

      if (!payload.category && !payload.vehicle_brand && !payload.vehicle_model) {
        skipped++;
        continue;
      }

      preparedRows.push({
        id: normalizeExcelCell(r.id),
        payload,
        suggestion: {
          productBrand: payload.product_brand,
          category: payload.category,
          carBrand: payload.vehicle_brand,
          carModel: payload.vehicle_model,
          carType: payload.vehicle_type,
          vehicleYear: payload.vehicle_year,
          location: payload.location
        }
      });
    }

    // Aynı ürün farklı konumlarda aynı barkodu kullanabilir.
    // Sadece aynı barkod farklı ürün kimliklerine verilmişse yüklemeyi durdur.
    const barcodeIdentityMap = new Map();
    for (const row of preparedRows) {
      const barcode = normalizeExcelCell(row.payload.barcode);
      if (!barcode) continue;
      const identity = groupedStockIdentityKey(row.payload);
      if (!barcodeIdentityMap.has(barcode)) barcodeIdentityMap.set(barcode, new Set());
      barcodeIdentityMap.get(barcode).add(identity);
    }
    const conflictingBarcodes = [...barcodeIdentityMap.entries()]
      .filter(([, identities]) => identities.size > 1)
      .map(([barcode]) => barcode);
    if (conflictingBarcodes.length) {
      const sample = conflictingBarcodes.slice(0, 8).join(", ");
      throw new Error(`Excel'de aynı barkod farklı ürünlere verilmiş: ${sample}${conflictingBarcodes.length > 8 ? "..." : ""}`);
    }

    // Güncellenen kartlarda stok farkını Hareketler'e yazabilmek için eski adetleri tek seferde al.
    const existingById = new Map();
    const updateIds = preparedRows.map(row => row.id).filter(Boolean);
    for (let i = 0; i < updateIds.length; i += 300) {
      const { data, error } = await supabaseClient
        .from("stock_products")
        .select("id,quantity,product_name")
        .in("id", updateIds.slice(i, i + 300));
      if (error) throw error;
      (data || []).forEach(item => existingById.set(String(item.id), item));
    }

    createExcelProgress();
    progressOpened = true;
    updateExcelProgress(skipped, rows.length, success, failed);

    // 12.000+ satırı tek tek beklemek yerine kontrollü gruplar halinde paralel işler.
    const concurrentBatchSize = 20;
    let movementAuditCount = 0;
    let movementAuditFailed = 0;
    let insertedCount = 0;
    let updatedCount = 0;

    for (let start = 0; start < preparedRows.length; start += concurrentBatchSize) {
      const batch = preparedRows.slice(start, start + concurrentBatchSize);
      const outcomes = await Promise.all(batch.map(async row => {
        try {
          rememberProductSuggestions(row.suggestion);
          const oldRow = row.id ? existingById.get(String(row.id)) : null;
          const beforeQty = Number(oldRow?.quantity || 0);
          const afterQty = Number(row.payload.quantity || 0);

          if (row.id) {
            const result = await supabaseClient.from("stock_products").update(row.payload).eq("id", row.id);
            if (result.error) throw result.error;
            return { ok: true, row, productId: row.id, beforeQty, afterQty, isNew: false };
          }

          const result = await supabaseClient.from("stock_products").insert(row.payload).select("id").single();
          if (result.error) throw result.error;
          return { ok: true, row, productId: result.data?.id, beforeQty: 0, afterQty, isNew: true };
        } catch (error) {
          console.error(error);
          return { ok: false, row };
        }
      }));

      const movementRows = [];
      for (const outcome of outcomes) {
        if (!outcome.ok) {
          failed++;
          continue;
        }

        success++;
        if (outcome.isNew) insertedCount++; else updatedCount++;
        const delta = Number(outcome.afterQty || 0) - Number(outcome.beforeQty || 0);
        if (delta && outcome.productId) {
          const direction = delta > 0 ? "giris" : "cikis";
          movementRows.push({
            product_id: outcome.productId,
            movement_type: outcome.isNew ? "excel_ilk_stok_giris" : `excel_stok_duzeltme_${direction}`,
            quantity: Math.abs(delta),
            description: `${outcome.isNew ? "Excel yeni ürün ilk stok" : "Excel stok güncelleme"}: ${outcome.beforeQty} → ${outcome.afterQty} (${delta > 0 ? "+" : ""}${delta})${actorSuffix()}`
          });
        }
      }

      if (movementRows.length) {
        const { error: movementError } = await supabaseClient.from("stock_movements").insert(movementRows);
        if (movementError) {
          console.error("Excel stok hareketleri kaydedilemedi:", movementError);
          movementAuditFailed += movementRows.length;
        } else {
          movementAuditCount += movementRows.length;
        }
      }

      updateExcelProgress(success + failed + skipped, rows.length, success, failed);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    closeExcelProgress();
    progressOpened = false;
    await logActivity(
      "excel_stock_upload",
      `Excel yükleme tamamlandı: ${success} başarılı (${insertedCount} yeni / ${updatedCount} güncelleme), ${failed} hatalı, ${skipped} atlanan; ${movementAuditCount} stok farkı Hareketler'e yazıldı${movementAuditFailed ? `, ${movementAuditFailed} hareket yazılamadı` : ""}`,
      "stock_products",
      null
    );
    await Promise.all([loadProducts(), loadMovements().catch(() => {})]);

    showToast(`Yükleme tamamlandı ✅ Başarılı: ${success} Hatalı: ${failed} Atlanan: ${skipped}${movementAuditFailed ? ` · Hareket uyarısı: ${movementAuditFailed}` : ""}`);
    event.target.value = "";

  } catch (err) {
    console.error(err);
    if (progressOpened) closeExcelProgress();
    showToast(err.message || "Excel yüklenemedi", true);
    event.target.value = "";
  }
}

