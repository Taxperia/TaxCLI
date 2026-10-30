(function () {
  const labels = { queued: "Sırada", preparing: "Hazırlanıyor", running: "Çalışıyor", approval: "Onay bekliyor", testing: "Test ediliyor", completed: "Tamamlandı", failed: "Hata", cancelled: "Durduruldu" };
  const active = new Set(["preparing", "running", "approval", "testing"]);
  window.createComparisonProgress = function ({ root, project, conversation, openConversation, openResult }) {
    let current = null;
    const rows = new Map();
    const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
    const sync = () => { root.hidden = !current || current.projectPath !== project() || current.conversationId !== conversation(); };
    const phase = (text) => { if (current) current.heading.textContent = text; sync(); };
    function update(id, patch) {
      const row = rows.get(id);
      if (!row) return;
      Object.assign(row, patch);
      if (active.has(row.status) && !row.startedAt) row.startedAt = Date.now();
      row.el.dataset.status = row.status;
      row.badge.textContent = labels[row.status] || row.status;
      row.activity.textContent = row.error || row.message || "Önceki modelin bitmesi bekleniyor.";
      row.warningText.textContent = row.warning || "";
      row.warningText.hidden = !row.warning;
      if (row.workingPath) row.el.title = row.workingPath;
      row.result.hidden = !row.runId || !["completed", "failed"].includes(row.status);
      row.chat.hidden = !row.conversationId;
      sync();
    }
    function start(projectPath, variants, conversationId) {
      rows.clear();
      root.replaceChildren();
      root.classList.remove("compact");
      root.scrollTop = 0;
      const heading = node("strong", "Karşılaştırma hazırlanıyor…");
      heading.setAttribute("role", "status");
      const header = node("header", ""); header.append(heading);
      const hide = node("button", "Daralt", "ghost-button"); hide.type = "button";
      hide.setAttribute("aria-expanded", "true");
      hide.addEventListener("click", () => {
        const collapsed = root.classList.toggle("compact");
        hide.textContent = collapsed ? "Genişlet" : "Daralt";
        hide.setAttribute("aria-expanded", String(!collapsed));
      });
      header.append(hide);
      const target = node("p", `Hedef proje: ${projectPath}`, "comparison-target");
      target.title = projectPath;
      const note = node("p", "Modeller sırayla projenin .taxcli/comparisons klasöründe çalışır. Sonucu inceleyip Uygula ile bu projeye aktarabilirsin.", "comparison-note");
      const list = node("div", "", "comparison-candidates");
      root.append(header, target, note, list);
      current = { projectPath, conversationId, heading };
      variants.forEach((v) => {
        const el = node("article", "", "comparison-candidate");
        el.dataset.variantId = v.variantId;
        el.title = v.projectPath || "";
        const name = node("strong", `${v.engineName || v.engineId} · ${v.model || "Auto"}`);
        const badge = node("span", "", "comparison-state");
        const activity = node("p", "", "comparison-activity");
        const warningText = node("p", "", "comparison-warning");
        const timing = node("small", "");
        const actions = node("div", "", "comparison-actions");
        const chat = node("button", "Canlı çıktıyı aç", "ghost-button"); chat.type = "button";
        chat.addEventListener("click", () => Promise.resolve(openConversation(projectPath, rows.get(v.variantId).conversationId, v.variantId)).catch((error) => phase(error.message)));
        const result = node("button", "Değişiklikleri incele / uygula", "ghost-button"); result.type = "button";
        result.addEventListener("click", () => Promise.resolve(openResult(rows.get(v.variantId).runId)).catch((error) => phase(error.message)));
        actions.append(chat, result);
        el.append(name, badge, activity, warningText, timing, actions); list.append(el);
        rows.set(v.variantId, { el, badge, activity, warningText, timing, result, chat, conversationId: v.conversationId, status: "queued", lastEventAt: 0 });
        update(v.variantId, {});
      });
      sync();
    }
    function event(payload, summary = "") {
      const entry = [...rows.entries()].find(([, row]) => row.runId === payload.runId);
      if (!entry) return;
      const [id, row] = entry;
      row.lastEventAt = Date.now();
      if (payload.type === "error") update(id, { error: payload.message || "Ajan hatası" });
      else if (payload.type === "approval-request") update(id, { status: "approval", message: "Devam etmek için işlem onayı gerekiyor." });
      else if (payload.type === "finished") update(id, { status: payload.code == null ? "cancelled" : payload.code === 0 && !row.error ? "completed" : "failed", message: payload.code === 0 ? "Çalışma tamamlandı; sonuç kaydediliyor." : `Ajan çıkış kodu: ${payload.code}`, endedAt: Date.now() });
      else if (payload.type === "status" || payload.type === "output" || payload.type === "started" || payload.type === "approval-resolved") update(id, { status: "running", message: String(summary || payload.message || "Ajan başlatıldı; ilk çıktı bekleniyor…").slice(-300) });
    }
    const timer = setInterval(() => {
      for (const row of rows.values()) {
        if (!row.startedAt) continue;
        const seconds = Math.max(0, Math.floor(((row.endedAt || Date.now()) - row.startedAt) / 1000));
        row.timing.textContent = `${seconds} sn${active.has(row.status) && row.lastEventAt ? ` · Son etkinlik ${Math.floor((Date.now() - row.lastEventAt) / 1000)} sn önce` : ""}`;
      }
    }, 1000);
    timer.unref?.();
    return { start, update, event, phase, sync };
  };
})();
