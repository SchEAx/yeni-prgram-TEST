// Müşteri memnuniyeti / anket yönetimi
function customerSurveyRowAverage(row) {
  const values = [1,2,3,4,5,6,7,8]
    .map(i => Number(row?.[`q${i}`] || 0))
    .filter(v => Number.isFinite(v) && v > 0);
  if (!values.length) return "0.00";
  return (values.reduce((a,b) => a+b, 0) / values.length).toFixed(2);
}

function customerSurveyAdminDeleteButton(id) {
  const liveRole = String(
    state?.currentUser?.role ||
    (typeof currentStaff === "function" ? currentStaff()?.role : "") ||
    ""
  ).trim().toLowerCase();

  if (liveRole !== "admin") {
    return `<span class="muted">-</span>`;
  }

  return `<button class="btn danger mini survey-delete-btn" type="button" onclick="deleteCustomerSurvey('${escapeHtml(String(id || ""))}')">Sil</button>`;
}

async function deleteCustomerSurvey(id) {
  if (!requireRoleAction(["admin"], "Anket silme işlemini sadece Admin yapabilir")) return;

  const surveyId = String(id || "").trim();
  if (!/^\d+$/.test(surveyId)) {
    showToast("Geçersiz anket ID", true);
    return;
  }

  const ok = await appConfirm(
    `#${surveyId} numaralı anket kaydı kalıcı olarak silinsin mi?`,
    { danger: true, okText: "Anketi Sil" }
  );
  if (!ok) return;

  try {
    if (typeof apiFetch === "function" && typeof MIGRATION_TEST_MODE !== "undefined" && MIGRATION_TEST_MODE) {
      await apiFetch(`/api/customer-surveys/${encodeURIComponent(surveyId)}`, { method: "DELETE" });
    } else {
      const { error } = await legacyDisabledClient.from("customer_surveys").delete().eq("id", surveyId);
      if (error) throw error;
    }

    showToast(`Anket #${surveyId} silindi ✅`);
    await loadCustomerSurveyStats();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Anket silinemedi", true);
  }
}
window.deleteCustomerSurvey = deleteCustomerSurvey;

async function loadCustomerSurveyStats() {
  const box = document.getElementById("customerSurveyPanel");
  if (!box) return;
  box.innerHTML = `<div class="empty-state">Anket verileri yükleniyor...</div>`;

  try {
    let rows = [];
    let totalSurveyCount = 0;

    if (typeof apiFetch === "function" && typeof MIGRATION_TEST_MODE !== "undefined" && MIGRATION_TEST_MODE) {
      const payload = await apiFetch("/api/customer-surveys?limit=500&offset=0");
      rows = Array.isArray(payload?.surveys) ? payload.surveys : [];
      totalSurveyCount = Number(payload?.count ?? rows.length);
    } else {
      const { data, error } = await legacyDisabledClient
        .from("customer_surveys")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      rows = data || [];
      totalSurveyCount = rows.length;
    }

    const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + Number(b || 0), 0) / arr.length).toFixed(2) : "0.00";
    const scoreKeys = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"];
    const allScores = rows.flatMap(r => scoreKeys.map(k => Number(r[k] || 0)).filter(Boolean));
    const problemRows = rows.filter(r => scoreKeys.some(k => Number(r[k] || 0) <= 2));
    const contactRows = rows.filter(r => r.contact_allowed && r.phone);

    const questionNames = [
      "Karşılama biçimi ve nezaket",
      "İhtiyaçların anlaşılması / bilgilendirme",
      "Montaj kalitesi ve işçilik",
      "Söz verilen zamanda teslim",
      "Teslimat anındaki temizlik",
      "Fiyat / Performans",
      "Tavsiye etme olasılığı",
      "Muhatap bulabilme"
    ];

    const averagesHtml = questionNames.map((name, i) => {
      const key = `q${i + 1}`;
      const value = avg(rows.map(r => Number(r[key] || 0)).filter(Boolean));
      return `<tr><td>${escapeHtml(name)}</td><td><strong>${value}</strong> / 5</td></tr>`;
    }).join("");

    const commentsHtml = rows
      .filter(r => r.suggestion || (r.contact_allowed && r.phone))
      .slice(0, 30)
      .map(r => {
        const low = scoreKeys.some(k => Number(r[k] || 0) <= 2);
        const scores = scoreKeys.map(k => Number(r[k] || 0)).filter(Boolean);
        return `<div class="survey-comment ${low ? "danger" : ""}">
          <strong>#${escapeHtml(String(r.id || "-"))} · ${formatDate(r.created_at)} · Ortalama: ${avg(scores)} / 5 ${low ? "⚠️" : ""}</strong>
          ${r.suggestion ? `<p>${escapeHtml(r.suggestion)}</p>` : `<p class="muted">Yorum yazılmamış.</p>`}
          ${r.contact_allowed && r.phone ? `<small>Geri dönüş izni var: ${escapeHtml(r.phone)}</small>` : `<small>Anonim değerlendirme</small>`}
        </div>`;
      }).join("") || `<div class="empty-state">Henüz yorum yok.</div>`;

    const rawRowsHtml = rows.map(r => {
      const low = scoreKeys.some(k => Number(r[k] || 0) <= 2);
      const comment = String(r.suggestion || "").trim();
      const contact = r.contact_allowed && r.phone
        ? `✅ ${escapeHtml(String(r.phone))}`
        : "Anonim";
      const scoreCells = scoreKeys.map(k => `<td>${escapeHtml(String(r[k] ?? "-"))}</td>`).join("");
      return `<tr class="${low ? "survey-row-low" : ""}">
        <td class="survey-id-cell"><strong>#${escapeHtml(String(r.id || "-"))}</strong></td>
        <td class="survey-action-cell">${customerSurveyAdminDeleteButton(r.id)}</td>
        <td>${formatDate(r.created_at)}</td>
        <td><strong>${customerSurveyRowAverage(r)}</strong></td>
        ${scoreCells}
        <td class="survey-table-comment" title="${escapeHtml(comment)}">${comment ? escapeHtml(comment) : "-"}</td>
        <td>${contact}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="14" class="empty-state">Henüz anket kaydı yok.</td></tr>`;

    box.innerHTML = `
      <div class="survey-stats">
        <div class="stat-card"><b>${totalSurveyCount}</b><span>Toplam Anket</span></div>
        <div class="stat-card"><b>${avg(allScores)}</b><span>Genel Ortalama</span></div>
        <div class="stat-card"><b>${problemRows.length}</b><span>Düşük Puanlı Kayıt</span></div>
        <div class="stat-card"><b>${contactRows.length}</b><span>Geri Dönüş İsteyen</span></div>
      </div>

      <h3>Kriter Ortalamaları</h3>
      <div class="survey-table-scroll">
        <table class="survey-table survey-average-table"><thead><tr><th>Kriter</th><th>Ortalama</th></tr></thead><tbody>${averagesHtml}</tbody></table>
      </div>

      <div class="survey-record-head">
        <div>
          <h3>Tüm Anket Kayıtları</h3>
          <p class="muted">Son ${rows.length} kayıt gösteriliyor. Silme işlemi sadece Admin hesabında görünür.</p>
        </div>
        <button class="btn secondary mini" type="button" onclick="loadCustomerSurveyStats()">Yenile</button>
      </div>
      <div class="survey-table-scroll survey-record-table-wrap">
        <table class="survey-table survey-record-table">
          <thead>
            <tr>
              <th>ID</th><th>İşlem</th><th>Tarih</th><th>Ort.</th>
              <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th><th>Q6</th><th>Q7</th><th>Q8</th>
              <th>Yorum</th><th>İletişim</th>
            </tr>
          </thead>
          <tbody>${rawRowsHtml}</tbody>
        </table>
      </div>

      <h3>Son Yorumlar</h3>
      ${commentsHtml}
    `;
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">Anket verileri alınamadı: ${escapeHtml(err.message || err)}</div>`;
  }
}
window.loadCustomerSurveyStats = loadCustomerSurveyStats;
