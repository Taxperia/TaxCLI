const $ = (selector) => document.querySelector(selector);
let sending = false, loading = true, ready = false, selection = null, lastSignature = "", approvalSignature = "", modelRevision = 0;
let selectionSave = Promise.resolve();
const fragmentSession = new URLSearchParams(location.hash.slice(1)).get("session") || "";
if (/^[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{20,}$/.test(fragmentSession)) {
  sessionStorage.setItem("taxcli_mobile_session", fragmentSession);
  history.replaceState(null, "", location.pathname + location.search);
}
function authHeaders(extra = {}) {
  const token = sessionStorage.getItem("taxcli_mobile_session") || "";
  return token ? { ...extra, Authorization: "Bearer " + token } : extra;
}
let toastTimer;
function showToast(message) {
  $("#mobileToast").textContent = message;
  $("#mobileToast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#mobileToast").classList.remove("show"), 5000);
}
async function api(url, body) {
  const res = await fetch(url, { cache: "no-store", method: body ? "POST" : "GET", headers: authHeaders(body ? { "Content-Type": "application/json" } : {}), ...(body ? { body: JSON.stringify(body) } : {}) });
  if (res.status === 401) { sessionStorage.removeItem("taxcli_mobile_session"); location.replace("/paired-out"); throw new Error("Oturum kapalı"); }
  const data = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(data.error || "İşlem tamamlanamadı.");
  return data;
}
function updateSend() { $("#send").disabled = sending || loading || !ready || !$("#prompt").value.trim() || (selection && (!selection.projectId || !selection.engineId)); }
function fillSelect(selector, rows, selected, placeholder) {
  const node = $(selector); node.replaceChildren();
  if (!rows.length) rows = [{ id: "", label: placeholder, disabled: true }];
  for (const row of rows) { const option = document.createElement("option"); option.value = row.id; option.textContent = row.label; option.disabled = !!row.disabled; node.append(option); }
  if ([...node.options].some((o) => o.value === selected && !o.disabled)) node.value = selected;
  else node.selectedIndex = [...node.options].findIndex((o) => !o.disabled);
}
function readSelection() { return { projectId: $("#mobileProject").value, engineId: $("#mobileEngine").value, model: $("#mobileModel").value, approvalMode: $("#mobileApproval").value }; }
async function loadModels(selected = "") {
  const revision = ++modelRevision, engine = $("#mobileEngine").value;
  loading = true; updateSend(); $("#mobileModel").disabled = true;
  try {
    const { models } = engine ? await api("/api/models?engineId=" + encodeURIComponent(engine)) : { models: [] };
    if (revision !== modelRevision) return;
    fillSelect("#mobileModel", [{ id: "", label: "Otomatik / sağlayıcı varsayılanı" }, ...models], selected, "Model bulunamadı");
    $("#mobileModel").disabled = !engine;
    ready = true;
  } catch (error) { if (revision === modelRevision) { ready = false; $("#mobileModel").replaceChildren(); showToast(error.message); throw error; } }
  finally { if (revision === modelRevision) { loading = false; updateSend(); } }
}
async function loadOptions() {
  loading = true; ready = false; updateSend();
  try {
    const data = await api("/api/options");
    if (!data.projects.length && !data.engines.length) { selection = null; ready = true; return; }
    selection = data.selection;
    fillSelect("#mobileProject", data.projects.map((p) => ({ id: p.id, label: p.name + (p.trusted ? "" : " · Masaüstünde güven verin"), disabled: !p.trusted })), selection.projectId, "Güvenilen proje yok");
    fillSelect("#mobileEngine", data.engines.map((e) => ({ id: e.id, label: e.name + (!e.installed ? " · Kurulu değil" : !e.authenticated ? " · Giriş gerekli" : ""), disabled: !e.installed || !e.authenticated })), selection.engineId, "Hazır sağlayıcı yok");
    $("#mobileApproval").value = ["ask", "auto_edit", "plan"].includes(selection.approvalMode) ? selection.approvalMode : "ask";
    await loadModels(selection.model);
    selection = readSelection(); updateContext();
  } catch (error) { showToast(error.message); }
  finally { loading = false; updateSend(); }
}
function updateContext() {
  if (!selection) return;
  const project = $("#mobileProject").selectedOptions[0]?.textContent || "Proje seç";
  const engine = $("#mobileEngine").selectedOptions[0]?.textContent || "TaxCLI";
  const model = $("#mobileModel").selectedOptions[0]?.textContent || "Model seç";
  const approval = $("#mobileApproval").selectedOptions[0]?.textContent || "Her işlemde sor";
  $("#project").textContent = project;
  $("#engine").textContent = "TaxCLI · " + engine;
  $("#modelLabel").textContent = selection.model ? model : engine + " · Otomatik";
  $("#modelPicker").title = engine + " · " + model;
  $("#modelPicker").setAttribute("aria-label", "Model: " + model);
  $("#approvalPicker").dataset.mode = selection.approvalMode;
  $("#approvalPicker").title = approval;
  $("#approvalPicker").setAttribute("aria-label", "Onay modu: " + approval);
  $("#approvalSymbol").setAttribute("d", selection.approvalMode === "plan" ? "M9 10h6M9 14h6" : selection.approvalMode === "auto_edit" ? "m13 8-4 5h4l-2 4" : "m8 12 3 3 5-6");
  $("#prompt").placeholder = selection.projectId ? project + " üzerinde çalış" : "Bir görev ver…";
}
async function saveSelection() {
  selection = readSelection(); updateContext();
  if (!selection.projectId || !selection.engineId) { updateSend(); return; }
  const snapshot = { ...selection };
  selectionSave = selectionSave.catch(() => {}).then(() => api("/api/selection", snapshot));
  try { await selectionSave; } catch (error) { showToast(error.message); }
  updateSend();
}
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function render(state) {
  if (!selection) { $("#project").textContent = state.context?.projectName || "Proje seç"; $("#engine").textContent = state.context?.engineName || "TaxCLI · Bağlı"; }
  const running = [...(state.messages || [])].reverse().find((item) => !item.finished);
  $("#runIndicator").hidden = !running;
  $("#runLabel").textContent = running?.error || running?.status || "Çalışıyor";
  const pending = state.approvals || [], key = JSON.stringify(pending);
  if (key !== approvalSignature) {
    approvalSignature = key; $("#approvals").replaceChildren();
    for (const item of pending) {
      const card = element("section", "", "message approval"); card.append(element("strong", item.title), element("p", item.reason));
      if (item.command) card.append(element("pre", item.command));
      if (item.cwd) card.append(element("small", item.cwd));
      for (const change of item.changes || []) card.append(element("pre", (change.path || "Dosya") + " · " + (change.kind || "Değişiklik")));
      const actions = element("div", "", "approval-actions");
      for (const [decision, label] of [["accept", "Bir kez izin ver"], ["decline", "Reddet"]]) {
        const button = element("button", label); button.type = "button";
        button.onclick = async () => { actions.querySelectorAll("button").forEach((b) => b.disabled = true); try { await api("/api/approvals/" + encodeURIComponent(item.id), { decision }); } catch (error) { showToast(error.message); } finally { approvalSignature = ""; await refresh(false); } };
        actions.append(button);
      }
      card.append(actions); $("#approvals").append(card);
    }
  }
  const rows = state.messages || [], signature = JSON.stringify(rows);
  if (signature === lastSignature) return; lastSignature = signature;
  const follow = document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 140;
  const host = $("#messages"); host.replaceChildren();
  if (!rows.length) { const empty = element("div", "", "empty"); empty.append(element("h1", "Ne üzerinde çalışalım?"), element("p", "Üstten projeni, alttan modelini seç. Bilgisayarındaki ajan burada çalışmaya hazır.")); host.append(empty); return; }
  for (const item of rows) {
    const card = element("article", "", "message"), head = element("header", "");
    head.append(element("strong", item.target ? item.target.projectName + " · " + (item.target.model || item.target.engineId) : "Sen"), element("time", new Date(item.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })));
    const tools = element("div", "", "response-tools");
    if (item.answer) {
      const copy = element("button", "", "copy-response"); copy.type = "button"; copy.setAttribute("aria-label", "Yanıtı kopyala");
      copy.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="3" width="12" height="14" rx="3"/><path d="M16 17v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2"/></svg>';
      copy.onclick = async () => { try { await navigator.clipboard.writeText(item.answer); copy.setAttribute("aria-label", "Kopyalandı"); setTimeout(() => copy.setAttribute("aria-label", "Yanıtı kopyala"), 2000); } catch { showToast("Yanıt kopyalanamadı. Metne basılı tutarak kopyalayabilirsin."); } };
      tools.append(copy);
    }
    tools.append(element("span", item.error || item.status || "Gönderildi", "state" + (item.error ? " error" : "")));
    card.append(head, element("div", item.prompt, "prompt"), element("div", item.answer || "", "answer"), tools); host.append(card);
  }
  if (follow) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
}
async function refresh(schedule = true) {
  try { render(await api("/api/state")); $("#connectionDot").classList.add("connected"); $("#projectPicker").title = "Bağlı · Proje seç"; }
  catch { $("#connectionDot").classList.remove("connected"); $("#projectPicker").title = "Bağlantı bekleniyor · Proje seç"; }
  finally { if (schedule) setTimeout(refresh, 1400); }
}
async function send() {
  const box = $("#prompt"), prompt = box.value.trim(); if (!prompt || sending || loading || !ready) return;
  sending = true; updateSend();
  try { await api("/api/messages", { prompt, ...(selection ? { selection: readSelection() } : {}) }); box.value = ""; resizeComposer(); await refresh(false); window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }); }
  catch (error) { showToast(error.message); } finally { sending = false; updateSend(); }
}
$("#mobileEngine").onchange = async () => { try { await loadModels(); await saveSelection(); } catch {} };
for (const id of ["#mobileProject", "#mobileModel", "#mobileApproval"]) $(id).onchange = saveSelection;
function openPanel(opener, focus) {
  closeConnectionMenu();
  const panel = document.getElementById(opener.getAttribute("aria-controls"));
  if (!panel.open) panel.showModal();
  panel.querySelector(focus).focus();
}
$("#projectPicker").onclick = (event) => openPanel(event.currentTarget, "select");
$("#modelPicker").onclick = (event) => openPanel(event.currentTarget, "#mobileModel");
$("#approvalPicker").onclick = (event) => openPanel(event.currentTarget, "select");
$("#taskSettings").onclick = (event) => openPanel(event.currentTarget, "[data-task-prompt]");
document.querySelectorAll("[data-close-panel]").forEach((button) => {
  button.onclick = () => button.closest("dialog").close();
});
document.querySelectorAll("dialog.settings-sheet").forEach((panel) => {
  panel.addEventListener("click", (event) => {
    const rect = panel.getBoundingClientRect();
    if (event.target === panel && (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right || event.clientY > rect.bottom)) panel.close();
  });
});
document.querySelectorAll("[data-task-prompt]").forEach((button) => {
  button.onclick = () => {
    const box = $("#prompt"), addition = button.dataset.taskPrompt;
    const next = box.value ? box.value.trimEnd() + "\n\n" + addition : addition;
    if (next.length > box.maxLength) return showToast("Mesaj uzunluk sınırına ulaştı. Kısayol eklemeden önce mesajı kısalt.");
    box.value = next; button.closest("dialog").close();
    box.focus(); resizeComposer(); updateSend();
  };
});
function closeConnectionMenu() { $("#connectionMenu").hidden = true; $("#moreButton").setAttribute("aria-expanded", "false"); }
$("#moreButton").onclick = () => {
  const open = $("#connectionMenu").hidden;
  $("#connectionMenu").hidden = !open; $("#moreButton").setAttribute("aria-expanded", String(open));
  if (open) $("#refreshOptions").focus();
};
document.addEventListener("click", (event) => { if (!event.target.closest("#connectionMenu, #moreButton")) closeConnectionMenu(); });
document.addEventListener("keydown", (event) => {
  if ($("#connectionMenu").hidden) return;
  if (event.key === "Escape") { closeConnectionMenu(); $("#moreButton").focus(); }
  const buttons = [...$("#connectionMenu").querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length].focus();
  }
});
$("#refreshOptions").onclick = async () => { closeConnectionMenu(); await loadOptions(); };
$("#send").onclick = send;
$("#prompt").onkeydown = (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } };
function resizeComposer() {
  const box = $("#prompt"); box.style.height = "auto"; box.style.height = Math.min(180, Math.max(57, box.scrollHeight)) + "px";
  document.documentElement.style.setProperty("--composer-height", $(".composer").getBoundingClientRect().height + "px");
}
$("#prompt").oninput = () => { updateSend(); resizeComposer(); };
function resizeViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty("--keyboard-inset", (viewport && viewport.scale === 1 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0) + "px");
  resizeComposer();
}
window.visualViewport?.addEventListener("resize", resizeViewport);
window.visualViewport?.addEventListener("scroll", resizeViewport);
window.addEventListener("resize", resizeViewport);
new ResizeObserver(resizeComposer).observe($("#runIndicator"));
$("#logout").onclick = async () => { try { await api("/api/logout", {}); } catch {} sessionStorage.removeItem("taxcli_mobile_session"); location.replace("/paired-out"); };
resizeViewport(); loadOptions(); refresh();
