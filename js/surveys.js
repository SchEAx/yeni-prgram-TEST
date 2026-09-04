// Müşteri memnuniyeti / anket yönetimi
async function loadCustomerSurveyStats() {
  const box = document.getElementById("customerSurveyPanel");
  if (!box) return;
  box.innerHTML = `<div class="empty-state">Anket verileri yükleniyor...</div>`;

  try {
    const { data, error } = await supabaseClient
      .from("customer_surveys")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    const rows = data || [];
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
          <strong>${formatDate(r.created_at)} · Ortalama: ${avg(scores)} / 5 ${low ? "⚠️" : ""}</strong>
          ${r.suggestion ? `<p>${escapeHtml(r.suggestion)}</p>` : `<p class="muted">Yorum yazılmamış.</p>`}
          ${r.contact_allowed && r.phone ? `<small>Geri dönüş izni var: ${escapeHtml(r.phone)}</small>` : `<small>Anonim değerlendirme</small>`}
        </div>`;
      }).join("") || `<div class="empty-state">Henüz yorum yok.</div>`;

    box.innerHTML = `
      <div class="survey-stats">
        <div class="stat-card"><b>${rows.length}</b><span>Toplam Anket</span></div>
        <div class="stat-card"><b>${avg(allScores)}</b><span>Genel Ortalama</span></div>
        <div class="stat-card"><b>${problemRows.length}</b><span>Düşük Puanlı Kayıt</span></div>
        <div class="stat-card"><b>${contactRows.length}</b><span>Geri Dönüş İsteyen</span></div>
      </div>
      <h3>Kriter Ortalamaları</h3>
      <table class="survey-table"><thead><tr><th>Kriter</th><th>Ortalama</th></tr></thead><tbody>${averagesHtml}</tbody></table>
      <h3>Son Yorumlar</h3>
      ${commentsHtml}
    `;
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">Anket verileri alınamadı: ${escapeHtml(err.message || err)}</div>`;
  }
}
window.loadCustomerSurveyStats = loadCustomerSurveyStats;


