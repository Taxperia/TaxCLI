(function () {
  "use strict";
  const api = window.agentHub;
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const request = (action, payload = {}) => api.workbenchRequest(action, { projectPath: host.project(), ...payload });
  const tabs = [["review", "fa-code-compare", "İnceleme"], ["arena", "fa-trophy", "Model Arena"], ["runs", "fa-clock-rotate-left", "Çalışma kaydı"], ["recipes", "fa-list-check", "Görev tarifleri"], ["health", "fa-heart-pulse", "Proje sağlığı"], ["branches", "fa-code-branch", "Dallar"], ["knowledge", "fa-book", "Bilgi kasası"], ["doctor", "fa-stethoscope", "Sağlayıcı doktoru"], ["sessions", "fa-file-import", "Oturum aktar"]];
  const statuses = { running: "Çalışıyor", completed: "Tamamlandı", failed: "Başarısız", cancelled: "Durduruldu", interrupted: "Kesintiye uğradı", judged: "Hakem değerlendirdi", "needs-attention": "İlgi gerekiyor", pending: "Bekliyor" };
  let host, tab = "review", data = {}, detail = null, selectedRun = "", sessions = [], diagnostics = {}, refreshToken = 0, branchDiff = null, loadedProject = "";
  const date = (value) => value ? new Date(value).toLocaleString("tr-TR") : "—";
  const duration = (ms) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} sn` : "—";
  const button = (action, label, attrs = "", primary = false) => `<button type="button" class="${primary ? "primary-button" : "ghost-button"}" data-wb-action="${action}" ${attrs}>${label}</button>`;
  const empty = (text) => `<div class="wb-empty"><i class="fa-regular fa-folder-open"></i><p>${esc(text)}</p></div>`;
  const badge = (status) => `<span class="wb-badge wb-${esc(status)}">${esc(statuses[status] || status)}</span>`;
  const runLabel = (run) => `${run.engineId} · ${run.model} · ${run.effort}`;
  const costLabel = (billing) => billing ? `${Number(billing.amount).toFixed(4)} ${esc(billing.unit)}${billing.quality === "estimated" ? " (tahmini)" : ""}` : "Bildirilmedi";
  function alert(text, error = false) { host.toast(text, error ? "error" : ""); }
  function heading(title, description, actions = "") { return `<header class="wb-section-head"><div><h3>${title}</h3><p>${description}</p></div><div class="wb-actions">${actions}</div></header>`; }
  function runList(review = false) {
    const runs = data.runs || [];
    return heading(review ? "Değişiklik inceleme" : "Çalışma kayıtları", review ? "Bir çalışmayı aç; dosyaları ve değişiklik bloklarını incele, kabul et veya geri al." : "Model, efor, araçlar, komutlar, izinler, süre ve kullanım tek zaman çizelgesinde.") + (runs.length ? `<div class="wb-run-list">${runs.map((run) => `<button type="button" class="wb-run-row ${selectedRun === run.id ? "selected" : ""}" data-wb-action="open-run" data-id="${esc(run.id)}"><span class="wb-run-icon"><i class="fa-solid ${run.role === "judge" ? "fa-scale-balanced" : "fa-code"}"></i></span><span><strong>${esc(run.prompt.slice(0, 100))}</strong><small>${esc(runLabel(run))} · ${date(run.startedAt)}</small></span><span>${badge(run.status)}<small>${duration(run.durationMs)} · ${run.changedFiles || 0} dosya</small></span></button>`).join("")}</div>` : empty("İlk ajan çalışmasından sonra inceleme ve zaman çizelgesi burada görünür."));
  }
  function renderDiff(changes, selectable = true) {
    if (!changes?.length) return empty("Dosya değişikliği yok.");
    return `<div class="wb-diff-list">${changes.map((change, index) => `<details class="wb-file-diff" open><summary>${selectable ? `<input type="checkbox" data-wb-file="${index}" aria-label="${esc(change.path)} dosyasını seç" />` : ""}<code>${esc(change.path)}</code><span>${esc(change.kind)}${change.binary ? " · ikili dosya" : ""}</span></summary>${change.binary ? `<p>İkili dosya; tüm dosya olarak kabul edilebilir veya geri alınabilir.</p>` : change.hunks.map((hunk) => `<section class="wb-hunk"><header>${selectable ? `<label><input type="checkbox" data-wb-hunk="${index}" data-hunk="${esc(hunk.id)}" ${change.decisions?.[hunk.id] === "rejected" ? "disabled" : ""} /> Blok</label>` : ""}<code>@@ −${hunk.oldStart + 1},${hunk.oldLines.length} +${hunk.newStart + 1},${hunk.newLines.length} @@</code><span>${esc(({ accepted: "Kabul edildi", rejected: "Geri alındı" })[change.decisions?.[hunk.id]] || "İncelenmedi")}</span></header><pre>${hunk.oldLines.map((line) => `<span class="wb-line-removed">− ${esc(line.replace(/\r?\n$/, ""))}\n</span>`).join("")}${hunk.newLines.map((line) => `<span class="wb-line-added">+ ${esc(line.replace(/\r?\n$/, ""))}\n</span>`).join("")}</pre></section>`).join("") || "<p>Boş dosya oluşturma / silme.</p>"}</details>`).join("")}</div>`;
  }
  function selectedChanges() {
    if (!detail) return [];
    const selection = new Map();
    document.querySelectorAll("[data-wb-file]:checked").forEach((el) => { const c = detail.changes[Number(el.dataset.wbFile)]; if (c) selection.set(c.path, { path: c.path }); });
    document.querySelectorAll("[data-wb-hunk]:checked").forEach((el) => { const c = detail.changes[Number(el.dataset.wbHunk)]; if (!c || selection.has(c.path) && !selection.get(c.path).hunkIds) return; if (!selection.has(c.path)) selection.set(c.path, { path: c.path, hunkIds: [] }); selection.get(c.path).hunkIds.push(el.dataset.hunk); });
    return [...selection.values()];
  }
  function renderRunDetail() {
    if (!detail) return "";
    const isolated = detail.workingPath !== detail.projectPath;
    const checks = detail.tests?.checks || [];
    return `<section class="wb-detail">${heading("Çalışma ayrıntısı", esc(runLabel(detail)), button("close-run", "Kapat"))}<p class="wb-prompt">${esc(detail.prompt)}</p><div class="wb-metrics"><span>Durum<strong>${statuses[detail.status] || detail.status}</strong></span><span>Süre<strong>${duration(detail.durationMs)}</strong></span><span>Token<strong>${Number(detail.tokens?.total || 0).toLocaleString("tr-TR")}${detail.tokens?.source === "estimated" ? " ≈" : ""}</strong></span><span>Maliyet<strong>${costLabel(detail.billing)}</strong></span></div>${detail.error ? `<p class="wb-error">${esc(detail.error)}</p>` : ""}<div class="wb-actions">${button("replay", "Aynı ayarlarla yeniden çalıştır")}${button("explain", "Değişikliği açıkla")}${button("run-tests", "Testleri çalıştır")}${button("export-run", "Raporu dışa aktar")}</div>${checks.length ? `<p>${checks.map((c) => `${esc(c.label)}: ${c.code === 0 ? "Geçti" : "Başarısız"}`).join(" · ")}</p>` : ""}${isolated ? '<p class="wb-note">Bu sonuç projenin ayrı çalışma kopyasında üretildi. Seçili değişiklikleri aşağıdaki hedefe uygulayabilirsin.</p>' : '<p class="wb-note">Bu değişiklikler projede zaten mevcut. Kabul incelemeyi işaretler; reddet seçili blokları geri alır.</p>'}<div class="wb-actions">${button("select-all", "Tümünü seç")}${isolated ? button("apply", "Seçileni ana projeye uygula", "", true) : button("accept", "Seçileni kabul et", "", true) + button("reject", "Seçileni geri al")}${!isolated ? button("undo-run", "Bu çalışmayı geri al") : ""}</div><p class="wb-note">Hedef proje: <code>${esc(detail.projectPath)}</code></p>${renderDiff(detail.changes)}<h4>Yanıt</h4><pre class="wb-response">${esc(detail.response || "Yanıt metni sağlayıcı tarafından bildirilmedi.")}</pre><h4>Çalışma zaman çizelgesi</h4><p class="wb-note">Dosya ve araç bilgileri sağlayıcının bildirdiği olaylardan alınır; işletim sistemi düzeyinde eksiksiz erişim günlüğü değildir.</p><ol class="wb-timeline">${(detail.timeline || []).map((event) => `<li><time>+${duration(event.elapsedMs)}</time><strong>${esc(({ command: "Komut", "file-read": "Dosya okuma", "file-edit": "Düzenleme", tool: "Araç", "approval-request": "İzin istendi", error: "Hata", status: "Durum", started: "Başladı", finished: "Bitti" })[event.kind] || event.kind)}</strong><pre>${esc(event.detail)}</pre></li>`).join("")}</ol></section>`;
  }
  function renderArena() {
    const arenas = data.arenas || [];
    return heading("Model Arena", "Aynı başlangıç dosyaları, sırayla izole koşular, otomatik test ve bağımsız hakem.", button("new-arena", "Yeni karşılaştırma", "", true)) + '<p class="wb-note">Puan: test %35, hakem kod kalitesi %40, hız %15, maliyet %10. Bildirilmeyen ölçütler hesap dışı kalır; eksik test veya hakem puanı varsa sonuç geçicidir. Maliyet ancak sağlayıcı bildirirse ve para birimleri eşleşirse karşılaştırılır.</p>' + (arenas.length ? arenas.map((arena) => `<article class="wb-card"><header><strong>${esc(arena.prompt.slice(0, 130))}</strong>${badge(arena.status)}</header><small>${date(arena.createdAt)} · Hakem: ${esc(arena.judge?.engineId || "Seçilmedi")} / ${esc(arena.judge?.model || "Auto")}</small>${arena.error ? `<p class="wb-error">${esc(arena.error)}</p>` : ""}<div class="wb-table-wrap"><table class="wb-table"><thead><tr><th>Çözüm / model</th><th>Süre</th><th>Maliyet</th><th>Test</th><th>Kalite</th><th>Toplam</th><th></th></tr></thead><tbody>${arena.variants.map((v) => `<tr><td><strong>${esc(v.alias)}${v.variantId === arena.winner ? " 🏆" : ""}</strong><small>${esc(v.engineId)} · ${esc(v.model || "Auto")} · ${statuses[v.status] || esc(v.status)}</small></td><td>${duration(v.durationMs)}<small>${v.scores?.speed ?? "—"}/100</small></td><td>${costLabel(v.billing)}</td><td>${v.scores?.tests == null ? "Test yok" : `${v.scores.tests}/100`}</td><td>${v.scores?.quality ?? "—"}</td><td>${v.scores?.total ?? "—"}${v.scores?.provisional ? " *" : ""}</td><td>${v.runId ? button("open-run", "İncele", `data-id="${esc(v.runId)}"`) : ""}</td></tr>${v.error ? `<tr><td colspan="7" class="wb-error">${esc(v.error)}</td></tr>` : ""}${v.reason ? `<tr><td colspan="7" class="wb-judge-reason">${esc(v.reason)}</td></tr>` : ""}`).join("")}</tbody></table></div><div class="wb-actions">${button("judge-arena", "Hakemle değerlendir", `data-id="${esc(arena.id)}"`)}${arena.winner ? button("winner", "Kazananı incele ve uygula", `data-id="${esc(arena.id)}"`, true) : ""}</div></article>`).join("") : empty("Composer’daki + → Çoklu AI karşılaştır ile modelleri seçip ilk arenayı başlat."));
  }
  function renderRecipes() {
    return heading("Görev tarifleri", "Hazır bir tarifi uygula veya kendi adımlarını kaydet.") + `<div class="wb-grid">${(data.recipes || []).map((recipe) => `<article class="wb-card"><h4>${esc(recipe.name)}</h4><ol>${recipe.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol><label>Görev<textarea data-recipe-task="${esc(recipe.id)}" rows="3" placeholder="Bu tarif hangi işi çözsün?"></textarea></label><div class="wb-actions">${button("run-recipe", "Tarifi çalıştır", `data-id="${esc(recipe.id)}"`, true)}${button("edit-recipe", "Düzenle / kopyala", `data-id="${esc(recipe.id)}"`)}${!["bug-fix", "tests", "review", "release"].includes(recipe.id) ? button("delete-recipe", "Sil", `data-id="${esc(recipe.id)}"`) : ""}</div></article>`).join("")}</div><form id="wbRecipeForm" class="wb-card"><h4>Yeni tarif</h4><input name="name" placeholder="Tarif adı" maxlength="80" required /><textarea name="steps" rows="6" placeholder="Her adımı ayrı satıra yaz" required></textarea><button class="primary-button" type="submit">Tarifi kaydet</button></form>`;
  }
  function renderHealth() {
    const report = data.health?.[0];
    return heading("Proje sağlığı", "Projenin tanımladığı test, lint, tür ve sözdizimi kontrollerini çalıştır.", button("health-plan", "Kontrolleri göster") + button("health-run", "Kontrolleri çalıştır", "", true)) + '<label class="wb-inline-label"><input type="checkbox" id="wbNetworkChecks" /> Bağımlılık güvenlik denetimi için npm kayıt sunucusuna bağlan</label><div id="wbCheckPlan"></div>' + (report ? `<p>Son kontrol: ${date(report.at)} · ${report.fileCount} kaynak dosya</p>${report.noTests ? '<p class="wb-note">Çalıştırılabilir test komutu bulunamadı; test başarısı doğrulanmadı.</p>' : ""}${report.checks.map((check) => `<details class="wb-card"><summary>${check.code === 0 ? "✓" : "✕"} ${esc(check.label)} · ${duration(check.durationMs)}</summary><pre>${esc(check.output || "Çıktı yok")}</pre><div class="wb-actions">${check.code !== 0 ? button("fix-check", "AI ile düzelt", `data-id="${esc(check.id)}"`) : ""}</div></details>`).join("")}<article class="wb-card"><h4>Dokümantasyon</h4><p>${report.missingDocs ? "README bulunamadı." : "README mevcut."}</p>${report.missingDocs ? button("fix-docs", "Dokümantasyon hazırla") : ""}<h4>TODO / FIXME (${report.todos.length})</h4>${report.todos.map((item) => `<p><code>${esc(item.path)}:${item.line}</code> ${esc(item.text)}</p>`).join("") || "İşaret bulunamadı."}</article>` : empty("Henüz sağlık kontrolü yapılmadı. Kontroller projedeki komutları çalıştırır; sonuçlar burada saklanır."));
  }
  function renderHealthIndicators() {
    const items = data.health?.[0]?.complexity;
    if (!items?.length) return "";
    return `<article class="wb-card"><h4>Kaynak dosya göstergeleri</h4><p>Satır ve dallanma işareti sayıları yaklaşık bir bakım göstergesidir; AST tabanlı kesin karmaşıklık ölçümü değildir.</p><div class="wb-table-wrap"><table class="wb-table"><thead><tr><th>Dosya</th><th>Satır</th><th>Dallanma işareti</th></tr></thead><tbody>${items.map((item) => `<tr><td><code>${esc(item.path)}</code></td><td>${item.lines}</td><td>${item.branches}</td></tr>`).join("")}</tbody></table></div></article>`;
  }
  function renderBranches() {
    const branches = data.branches || [];
    return heading("Konuşma dalları", "Sohbetteki herhangi bir mesajdan yeni bir dal aç. Her dal kendi proje kopyasında çalışır.", button("fork-latest", "Mevcut sohbetten dal aç", "", true)) + (branches.length ? `<div class="wb-grid">${branches.map((branch) => `<article class="wb-card"><h4>${esc(branch.title)}</h4><p>${branch.forkAt}. mesajdan ayrıldı · ${esc(branch.engineId || "Mevcut sağlayıcı")}</p><small>${date(branch.createdAt)}</small><div class="wb-actions">${button("open-branch", "Sohbeti aç", `data-id="${esc(branch.id)}"`)}${button("branch-diff", "Dosya farklarını incele", `data-id="${esc(branch.id)}"`)}${button("branch-apply", "Ana projeye uygula", `data-id="${esc(branch.id)}"`)}</div></article>`).join("")}</div><div class="wb-card"><h4>İki dalı karşılaştır</h4><div class="wb-actions"><select id="wbBranchLeft">${branches.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join("")}</select><select id="wbBranchRight">${branches.map((b, i) => `<option value="${esc(b.id)}" ${i === 1 ? "selected" : ""}>${esc(b.title)}</option>`).join("")}</select>${button("compare-branches", "Karşılaştır")}</div></div><div id="wbBranchDiff">${branchDiff ? renderDiff(branchDiff, false) : ""}</div>` : empty("Sohbetteki “Buradan dallandır” düğmesiyle bir alternatif oluştur."));
  }
  function renderKnowledge() {
    return heading("Yerel bilgi kasası", "Markdown, metin, JSON, YAML, CSV, HTML ve metin içeren PDF belgelerini referans bağlamı olarak ekle.", button("knowledge-add", "Belge ekle", "", true)) + '<label class="wb-inline-label"><input type="checkbox" id="wbKnowledgeGlobal" /> Eklenecek belgeyi bütün projelerde kullan</label><p class="wb-note">İşaretli belgeler yeni koşulara eklenir. Her koşunun toplam bilgi bağlamı 24.000 karakterle sınırlıdır. Taranmış PDF’ler için OCR gerekebilir. Belgeler yerelde Windows kasasıyla şifrelenir; kullanıldığında seçilen AI sağlayıcısına gönderilir.</p>' + ((data.knowledge || []).length ? `<div class="wb-run-list">${data.knowledge.map((item) => `<div class="wb-run-row"><input type="checkbox" data-wb-knowledge="${esc(item.id)}" ${item.enabled ? "checked" : ""} aria-label="${esc(item.name)} kullan" /><span><strong>${esc(item.name)}</strong><small>${item.characters.toLocaleString("tr-TR")} karakter · ${item.projectPath ? "Bu proje" : "Tüm projeler"}</small></span>${button("knowledge-delete", "Kaldır", `data-id="${esc(item.id)}"`)}</div>`).join("")}</div>` : empty("Kod standartları, API belgeleri veya tasarım sistemini ekleyerek modellerin ortak referans kullanmasını sağla."));
  }
  function renderDoctor() {
    return heading("Sağlayıcı doktoru", "Kurulum, sürüm, oturum ve model listesini kontrol et. Giriş işlemleri resmî CLI üzerinden açılır.") + `<div class="wb-grid">${host.engines().map((engine) => { const report = diagnostics[engine.id]; return `<article class="wb-card"><h4>${esc(engine.name)}</h4>${report ? report.checks.map((check) => `<div class="wb-doctor-check"><strong>${check.ok ? "✓" : "✕"} ${esc(check.name)}</strong><p>${esc(check.detail)}</p>${check.action ? button(`doctor-${check.action}`, check.action === "install" ? "Resmî CLI’ı kur" : "Giriş yap", `data-id="${esc(engine.id)}"`) : ""}</div>`).join("") : "<p>Henüz kontrol edilmedi.</p>"}<div class="wb-actions">${button("doctor-run", "Teşhis et", `data-id="${esc(engine.id)}"`, true)}${report ? button("doctor-export", "Raporu kaydet", `data-id="${esc(engine.id)}"`) : ""}</div></article>`; }).join("")}</div>`;
  }
  function renderSessions() {
    return heading("CLI ve terminal oturumlarını içe aktar", "Codex / Claude / Gemini konuşma dosyalarını keşfet veya başka bir terminalden dışa aktardığın kaydı seç.", button("sessions-scan", "Yerel oturumları tara") + button("session-file", "Dosyadan içe aktar", "", true)) + '<p class="wb-note">Konuşma mesajları TaxCLI geçmişine aktarılır; çalışan terminal süreci, araç belleği ve sağlayıcının gizli oturum durumu taşınmaz. Cursor/Copilot gibi farklı depolama biçimleri için JSON, JSONL veya metin dışa aktarımı kullan.</p>' + (sessions.length ? `<div class="wb-run-list">${sessions.map((item) => `<div class="wb-run-row"><span><strong>${esc(item.provider)} · ${esc(item.name)}</strong><small>${date(item.updatedAt)} · ${(item.bytes / 1024).toFixed(1)} KB${item.projectMatch ? " · Bu projeyle eşleşiyor" : ""}</small></span>${button("session-import", "İçe aktar", `data-id="${esc(item.id)}"`)}</div>`).join("")}</div>` : empty("Tarama yalnızca desteklenen CLI konuşma klasörlerini inceler. Dosyadan aktar seçeneği terminal kayıtlarını da kabul eder."));
  }
  function render() {
    const nav = $("#workbenchTabs"), content = $("#workbenchContent");
    if (!nav || !content) return;
    nav.innerHTML = tabs.map(([key, icon, label]) => `<button type="button" role="tab" aria-selected="${key === tab}" class="${tab === key ? "active" : ""}" data-wb-tab="${key}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join("");
    if (!host.project()) { content.innerHTML = empty("Geliştirme merkezini kullanmak için bir proje seç."); return; }
    const renderers = { review: () => runList(true), runs: () => runList(false), arena: renderArena, recipes: renderRecipes, health: renderHealth, branches: renderBranches, knowledge: renderKnowledge, doctor: renderDoctor, sessions: renderSessions };
    const warning = detail?.reviewWarning ? `<p class="wb-note" role="status">${esc(detail.reviewWarning)}</p>` : "";
    content.innerHTML = renderers[tab]() + (tab === "health" ? renderHealthIndicators() : "") + warning + renderRunDetail();
  }
  async function refresh() {
    const token = ++refreshToken;
    if (!host.project()) return render();
    if (loadedProject !== host.project()) { detail = null; selectedRun = ""; branchDiff = null; sessions = []; loadedProject = host.project(); }
    const result = await request("list");
    if (token !== refreshToken) return;
    data = result;
    for (const report of data.diagnostics || []) diagnostics[report.engineId] = report;
    render();
  }
  async function openRun(runId) {
    selectedRun = runId; detail = await request("run", { runId }); render();
    const view = $("#workbenchView"), panel = $(".wb-detail");
    // Keep scrolling inside this view; scrollIntoView can move the whole app.
    if (view && panel) view.scrollTo({ top: Math.max(0, view.scrollTop + panel.getBoundingClientRect().top - view.getBoundingClientRect().top - 12), behavior: "smooth" });
  }
  async function judgeArena(arenaId, { conversationId = "" } = {}) {
    const arena = (await request("list")).arenas.find((a) => a.id === arenaId);
    if (!arena?.judge?.engineId) throw new Error("Bu arenada hakem seçilmedi.");
    conversationId ||= arena.conversationId || "";
    const prompt = await request("arena-judge-prompt", { arenaId });
    const workspace = await request("arena-judge-workspace", { arenaId });
    const result = await host.run({ prompt, title: "Arena hakemi", conversationId, engineId: arena.judge.engineId, model: arena.judge.model || "", projectPath: workspace.projectPath, displayProjectPath: arena.projectPath, arenaId, role: "judge", approvalMode: "plan", agentId: "analyst", background: true });
    if (result.code !== 0) throw new Error("Hakem çalışması tamamlanamadı. Sağlayıcı doktorundan oturumu kontrol edin.");
    const judged = await request("arena-judgment", { arenaId, text: result.text });
    alert(`Hakem ${judged.variants.find((v) => v.variantId === judged.winner)?.alias || "kazananı"} seçti.`);
    return judged;
  }
  async function act(action, target) {
    const key = target.dataset.id;
    if (action === "refresh") return refresh();
    if (action === "close-run") { detail = null; selectedRun = ""; return render(); }
    if (action === "open-run") return openRun(key);
    if (action === "select-all") { document.querySelectorAll("[data-wb-file]").forEach((el) => { el.checked = true; }); return; }
    if (["accept", "reject", "apply", "undo-run"].includes(action)) {
      const selection = action === "undo-run" ? detail.changes.map((c) => ({ path: c.path })) : selectedChanges();
      if (!selection.length) throw new Error("Önce dosya veya değişiklik bloğu seç.");
      await request("review", { runId: detail.id, action: action === "undo-run" ? "reject" : action, selection });
      alert(action === "accept" ? "İnceleme kaydedildi." : "Dosyalar güncellendi; işlem öncesi snapshot kaydedildi."); return openRun(detail.id);
    }
    if (action === "replay") {
      const replay = await request("run-replay", { runId: detail.id });
      try { return await host.run({ ...replay, title: "Yeniden çalıştır" }); }
      finally { if (replay.replayId) await request("replay-cleanup", { replayId: replay.replayId }); }
    }
    if (action === "explain") return host.run({ prompt: `Şu görevin değişikliklerinin gerekçesini dosya ve değişiklik bloğu bazında açıkla. Dosyaları değiştirme.\nGörev: ${detail.prompt}\nFarklar: ${JSON.stringify(detail.changes.map(({ path, hunks }) => ({ path, hunks }))).slice(0, 45000)}`, title: "Değişiklik açıklaması", approvalMode: "plan", agentId: "analyst", role: "analysis" });
    if (action === "run-tests") { const runId = detail.id; await request("run-tests", { runId }); alert("Test sonucu ve Arena puanları güncellendi."); await refresh(); return openRun(runId); }
    if (action === "export-run") return request("run-export", { runId: detail.id });
    if (action === "new-arena") return host.openArena();
    if (action === "judge-arena") { await judgeArena(key); return refresh(); }
    if (action === "winner") { const arena = data.arenas.find((a) => a.id === key); return openRun(arena.variants.find((v) => v.variantId === arena.winner).runId); }
    if (action === "run-recipe") { const task = document.querySelector(`[data-recipe-task="${key}"]`).value.trim(); if (!task) throw new Error("Tarif için görev yaz."); const prompt = await request("recipe-prompt", { recipeId: key, task }); return host.run({ prompt, title: data.recipes.find((r) => r.id === key).name, recipeId: key }); }
    if (action === "edit-recipe") { const recipe = data.recipes.find((r) => r.id === key), form = $("#wbRecipeForm"); form.elements.name.value = recipe.name; form.elements.steps.value = recipe.steps.join("\n"); form.dataset.recipeId = key; form.scrollIntoView({ behavior: "smooth" }); return; }
    if (action === "delete-recipe") { await request("recipe-delete", { recipeId: key }); return refresh(); }
    if (action === "health-plan") { const plan = await request("checks-plan"); $("#wbCheckPlan").innerHTML = `<ul>${plan.map((c) => `<li>${esc(c.label)}</li>`).join("") || "Çalıştırılabilir kontrol bulunamadı."}</ul>`; return; }
    if (action === "health-run") { const includeNetwork = $("#wbNetworkChecks").checked; $("#workbenchStatus").textContent = "Proje kontrolleri çalışıyor…"; await request("checks", { includeNetwork }); return refresh(); }
    if (action === "fix-check") { const c = data.health[0].checks.find((c) => c.id === key); return host.run({ prompt: `Şu proje kontrolünü düzelt; kök nedeni bul ve aynı kontrolü yeniden çalıştır.\nKomut: ${c.label}\nÇıktı:\n${c.output}`, title: "Proje kontrolünü düzelt" }); }
    if (action === "fix-docs") return host.run({ prompt: "Projeyi okuyup kurulumu, kullanımını, test komutlarını ve mimarisini anlatan doğru bir README hazırla.", title: "Dokümantasyon" });
    if (action === "fork-latest") return host.fork();
    if (action === "open-branch") return host.openConversation(key);
    if (action === "branch-diff") { branchDiff = await request("branch-diff", { branchId: key }); render(); return; }
    if (action === "branch-apply") { branchDiff = await request("branch-diff", { branchId: key }); if (!branchDiff.length) throw new Error("Bu dalda uygulanacak fark yok."); if (!await host.confirm("Dal değişikliklerini uygula", `${branchDiff.length} dosya ana projeye uygulanacak. Önce geri dönüş snapshot’ı alınacak.`, "Uygula")) return; await request("branch-apply", { branchId: key }); alert("Dal ana projeye uygulandı."); return refresh(); }
    if (action === "compare-branches") { const result = await request("branches-compare", { leftId: $("#wbBranchLeft").value, rightId: $("#wbBranchRight").value }); branchDiff = result.changes; render(); return; }
    if (action === "knowledge-add") { await request("knowledge-import", { global: $("#wbKnowledgeGlobal").checked }); return refresh(); }
    if (action === "knowledge-delete") { await request("knowledge-delete", { id: key }); return refresh(); }
    if (action === "doctor-run") { $("#workbenchStatus").textContent = `${key} kontrol ediliyor…`; diagnostics[key] = await request("doctor", { engineId: key }); return render(); }
    if (action === "doctor-install") { const result = await api.installEngine(key); return alert(result.message || "Kurulum açıldı."); }
    if (action === "doctor-login") { const result = await api.loginEngine(key); return alert(result.message || "Giriş açıldı."); }
    if (action === "doctor-export") return request("doctor-export", { engineId: key });
    if (action === "sessions-scan") { sessions = await request("sessions-scan"); return render(); }
    if (action === "session-file" || action === "session-import") { const result = await request("session-import", { sessionId: key }); if (result) { await host.reloadConversations(); await host.openConversation(result.conversationId); alert(`${result.messageCount} mesaj aktarıldı.`); } }
  }
  function init(callbacks) {
    host = callbacks;
    $("#workbenchView").addEventListener("click", async (event) => {
      const tabButton = event.target.closest("[data-wb-tab]");
      if (tabButton) { tab = tabButton.dataset.wbTab; detail = null; render(); return; }
      const target = event.target.closest("[data-wb-action]");
      if (!target || target.disabled) return;
      target.disabled = true;
      try { await act(target.dataset.wbAction, target); }
      catch (error) { alert(error.message, true); }
      finally { target.disabled = false; $("#workbenchStatus").textContent = ""; }
    });
    $("#workbenchView").addEventListener("change", (event) => {
      const value = event.target;
      if (value.dataset.wbKnowledge) request("knowledge-toggle", { id: value.dataset.wbKnowledge, enabled: value.checked }).catch((error) => { value.checked = !value.checked; alert(error.message, true); });
    });
    $("#workbenchView").addEventListener("submit", async (event) => {
      if (event.target.id !== "wbRecipeForm") return;
      event.preventDefault();
      const form = event.target;
      try { await request("recipe-save", { id: form.dataset.recipeId, name: form.elements.name.value, steps: form.elements.steps.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) }); await refresh(); alert("Tarif kaydedildi."); }
      catch (error) { alert(error.message, true); }
    });
    render();
  }
  window.TaxCliWorkbench = { init, refresh, judgeArena, openRun, show: async (nextTab = tab) => { tab = nextTab; detail = null; await refresh(); }, request };
})();
