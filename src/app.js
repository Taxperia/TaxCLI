const engines = [
  { id: "codex", name: "Codex", initial: "C", logo: "assets/engines/codex.svg", logoClass: "invert-dark", login: "ChatGPT ile giriş" },
  { id: "opencode", name: "OpenCode", initial: "O", logo: "assets/engines/opencode.svg", logoClass: "mono-light", login: "OpenCode'u aç" },
  { id: "cursor", name: "Cursor Agent", initial: "Cu", logo: "assets/engines/cursor.svg", logoClass: "mono-light", login: "Cursor ile giriş" },
  { id: "copilot", name: "Copilot", initial: "Co", logo: "assets/engines/copilot.svg", logoClass: "mono-light", login: "GitHub ile giriş" },
  { id: "claude", name: "Claude Code", initial: "Cl", logo: "assets/engines/claude.svg", login: "Claude ile giriş" },
  { id: "gemini", name: "Gemini", initial: "G", logo: "assets/engines/gemini.svg", login: "Kurumsal Google girişi" },
  { id: "nvidia", name: "NVIDIA", initial: "NV", logo: "assets/engines/nvidia.svg", login: "NVIDIA API bağla" }
];

const agentRegistry = window.TaxCliAgents;
if (!agentRegistry?.profiles?.length) throw new Error("Agent profilleri yüklenemedi.");
const agentProfiles = agentRegistry.profiles;
const modelRouter = window.TaxCliModelRouter;
if (!modelRouter?.policies?.length) throw new Error("Model yönlendiricisi yüklenemedi.");
const officeRegistry = window.TaxCliOffice;
if (!officeRegistry?.defaultTeam?.length) throw new Error("AI Ofisi modülü yüklenemedi.");
const mcpMarketplace = window.TaxCliMcpMarketplace;
if (!mcpMarketplace?.catalog?.length) throw new Error("MCP mağazası yüklenemedi.");

function renderEngineLogo(engine) {
  return `<img class="engine-logo ${engine.logoClass || ""}" src="${engine.logo}" alt="" aria-hidden="true">`;
}

function renderMessageAvatar(role, engineId = activeEngine) {
  if (role === "user") return '<i class="fa-solid fa-user" aria-hidden="true"></i>';
  const engine = engines.find((item) => item.id === engineId);
  return engine ? renderEngineLogo(engine) : '<i class="fa-solid fa-robot" aria-hidden="true"></i>';
}

const plugins = [
  { id:"browser", name:"Tarayıcı", icon:"fa-solid fa-globe", auth:"local", ready:true, description:"Tüm modeller için güvenli web tarayıcısı" },
  { id:"github", name:"GitHub", icon:"fa-brands fa-github", auth:"github-cli", ready:true, description:"Kod, issue ve pull request'ler" },
  { id:"nvidia", name:"NVIDIA API", icon:"fa-solid fa-microchip", auth:"opencode-provider", ready:true, description:"Ücretsiz NVIDIA modellerini OpenCode ajanında kullan" },
  { id:"canva", name:"Canva", icon:"fa-solid fa-palette", auth:"browser", ready:true, url:"https://www.canva.com/login/", description:"Canva hesabına varsayılan tarayıcında giriş yap" },
  { id:"figma", name:"Figma", icon:"fa-brands fa-figma", auth:"config", ready:false, description:"Tasarım dosyaları ve prototipler" },
  { id:"notion", name:"Notion", icon:"fa-solid fa-n", auth:"config", ready:false, description:"Belgeler ve proje bilgisi" },
  { id:"drive", name:"Google Drive", icon:"fa-brands fa-google-drive", auth:"browser", ready:true, url:"https://drive.google.com/drive/my-drive", description:"Drive dosyalarını güvenli tarayıcıda kullan" },
  { id:"slack", name:"Slack", icon:"fa-brands fa-slack", auth:"config", ready:false, description:"Kanallar ve ekip iletişimi" },
  { id:"supabase", name:"Supabase", icon:"fa-solid fa-database", auth:"config", ready:false, description:"Veritabanı ve backend araçları" },
  { id:"cloudflare", name:"Cloudflare", icon:"fa-brands fa-cloudflare", auth:"cloudflare-token", ready:true, description:"Hesap, alan adı, plan ve nameserver durumunu güvenle izle" },
  { id:"vercel", name:"Vercel", icon:"fa-solid fa-caret-up", auth:"config", ready:false, description:"Önizleme ve production dağıtımları" }
];

let activeEngine = "codex";
let selectedAgentId = agentRegistry.normalizeAgentId(localStorage.getItem("agenthub:agent") || "auto");
let routingScope = modelRouter.normalizeScope(localStorage.getItem("agenthub:routing-scope") || "engine");
let routingPolicy = modelRouter.normalizePolicy(localStorage.getItem("agenthub:routing-policy") || "balanced");
let detected = [];
let activeRun = null;
let activeAssistant = null;
let isRunning = false;
const modelByEngine = {};
let approvalMode = localStorage.getItem("agenthub:approval") || "ask";
let effortLevel = localStorage.getItem("agenthub:effort") || "medium";
let effortMode = localStorage.getItem("agenthub:effort-mode") === "manual" ? "manual" : "auto";
/** @type {{ plan: boolean, browser: boolean, multiAi: boolean, office: boolean, subagents: boolean }} */
const contextFlags = { plan: false, browser: false, multiAi: false, office: false, subagents: false };
const MAX_MULTI_AI_VARIANTS = 64;
let multiAiSelection = [];
try {
  const savedMultiAi = JSON.parse(localStorage.getItem("agenthub:multi-ai-selection") || "[]");
  multiAiSelection = normalizeMultiAiSelection(savedMultiAi);
} catch { multiAiSelection = []; }
let officeTeams = [];
let activeOfficeTeamId = localStorage.getItem("agenthub:active-office-team") || "";
try {
  const savedTeams = JSON.parse(localStorage.getItem("agenthub:office-teams") || "null");
  const legacyMembers = JSON.parse(localStorage.getItem("agenthub:office-team") || "null");
  officeTeams = normalizeOfficeTeams(savedTeams, legacyMembers);
} catch { officeTeams = normalizeOfficeTeams(null, null); }
if (!officeTeams.some((team) => team.id === activeOfficeTeamId)) activeOfficeTeamId = officeTeams[0].id;
let officeTeam = officeRegistry.normalizeTeam(officeTeams.find((team) => team.id === activeOfficeTeamId)?.members);
let editingOfficeTeamId = activeOfficeTeamId;
let officeTeamDraft = null;
let officePageTab = "teams";
let chatGptAccounts = [];
let selectedPlugin = null;
let activeBrowserPluginId = "";
const ONBOARDING_VERSION = "1";
let onboardingStep = 0;
const approvedBrowserOrigins = new Set();
const browserPluginHosts = Object.freeze({
  canva: ["canva.com", "accounts.google.com", "appleid.apple.com", "facebook.com"],
  drive: ["google.com", "googleusercontent.com", "gstatic.com"]
});
let storedPluginIds = [];
try { storedPluginIds = JSON.parse(localStorage.getItem("agenthub:plugins") || "[]"); } catch { storedPluginIds = []; }
// Browser-based services are never considered connected from local UI state.
// Only provider/CLI status checks may produce a connected badge.
const connectedPlugins = new Set(storedPluginIds.filter((id) => ["browser", "github", "nvidia", "cloudflare"].includes(id)));
const availableModels = {};
let unavailableModels = {};
try { unavailableModels = JSON.parse(localStorage.getItem("agenthub:unavailable-models") || "{}"); } catch { unavailableModels = {}; }
let userSettings = {};
try { userSettings = JSON.parse(localStorage.getItem("agenthub:user-settings") || "{}"); } catch { userSettings = {}; }
const defaultSettings = {
  displayName: "Yerel kullanıcı",
  keepHistory: true,
  localHistory: true,
  homepage: "https://www.google.com",
  tips: true,
  windowRestore: "default",
  systemNotifications: true,
  warningNotifications: false,
  trayIcon: true,
  completionSound: false,
  theme: "dark",
  compactSidebar: false,
  restoreProject: true,
  autoMemory: true,
  defaultAgent: "auto",
  defaultRoutingScope: "engine",
  defaultRoutingPolicy: "balanced",
  autoProviders: engines.map((engine) => engine.id),
  defaultEngine: "codex",
  defaultApproval: "ask",
  parallelRuns: false,
  autoSnapshot: true,
  visionWarnings: true,
  useWorktrees: false,
  worktreeBase: "main",
  rulesText: "",
  skillsPaths: "",
  allowShell: true,
  allowMcp: false,
  mcpConfig: "",
  browserAutoPanel: true,
  useMemory: true,
  indexIgnore: true,
  debugStream: false,
  experimentalEffort: true,
  betaBadge: false
};
const defaultShortcuts = Object.freeze({
  newChat: "Ctrl+N",
  focusPrompt: "Ctrl+L",
  toggleTerminal: "Ctrl+`",
  toggleSubagents: "Ctrl+Shift+A",
  openSettings: "Ctrl+,",
  openNotifications: "Ctrl+Shift+B"
});
Object.assign(defaultSettings, {
  inAppNotifications: true,
  subagentsEnabled: true,
  subagentTeamId: "",
  shortcuts: { ...defaultShortcuts }
});
userSettings = Object.assign({}, defaultSettings, userSettings);
userSettings.shortcuts = Object.assign({}, defaultShortcuts, userSettings.shortcuts || {});
if (!localStorage.getItem("agenthub:approval") && userSettings.defaultApproval) {
  approvalMode = userSettings.defaultApproval;
}
if (!localStorage.getItem("agenthub:agent") && userSettings.defaultAgent) {
  selectedAgentId = agentRegistry.normalizeAgentId(userSettings.defaultAgent);
}
if (!localStorage.getItem("agenthub:routing-scope")) {
  routingScope = modelRouter.normalizeScope(userSettings.defaultRoutingScope);
}
if (!localStorage.getItem("agenthub:routing-policy")) {
  routingPolicy = modelRouter.normalizePolicy(userSettings.defaultRoutingPolicy);
}
if (!Array.isArray(userSettings.autoProviders)) userSettings.autoProviders = engines.map((engine) => engine.id);
if (!localStorage.getItem("agenthub:engine") && userSettings.defaultEngine) {
  activeEngine = userSettings.defaultEngine;
} else {
  try { activeEngine = localStorage.getItem("agenthub:engine") || activeEngine; } catch { /* ignore */ }
}

/** @type {{ sessionStarted: number, totalMs: number, projectsOpened: string[], runs: number, tokensEst: number, edits: number }} */
let usageStats = {};
try { usageStats = JSON.parse(localStorage.getItem("agenthub:usage-stats") || "{}"); } catch { usageStats = {}; }
usageStats = Object.assign({ sessionStarted: Date.now(), totalMs: 0, projectsOpened: [], runs: 0, tokensEst: 0, edits: 0 }, usageStats);
usageStats.totalMs = Math.max(0, Number(usageStats.totalMs) || 0);
usageStats.projectsOpened = Array.isArray(usageStats.projectsOpened) ? usageStats.projectsOpened.filter(Boolean) : [];
usageStats.runs = Math.max(0, Number(usageStats.runs) || 0);
usageStats.tokensEst = Math.max(0, Number(usageStats.tokensEst) || 0);
usageStats.edits = Math.max(0, Number(usageStats.edits) || 0);
// A persisted start timestamp would count the time while the application was closed.
usageStats.sessionStarted = Date.now();
const usageAnalytics = window.TaxCliUsageAnalytics;
if (!usageAnalytics?.createTracker) throw new Error("Kullanım analitiği modülü yüklenemedi.");
const usageTracker = usageAnalytics.createTracker({
  storageKey: "agenthub:usage-analytics",
  pricing: { default: { inputPerMillion: 1000, outputPerMillion: 1000, unit: "TaxCLI kredi", source: "local-estimate" } }
});
if (!usageTracker.getState().runs.length && !usageTracker.getState().legacy.runs && usageStats.runs) {
  usageTracker.replace(usageAnalytics.migrateState(usageStats));
}
let notifications = [];
try { notifications = JSON.parse(localStorage.getItem("agenthub:notifications") || "[]"); } catch { notifications = []; }
if (!Array.isArray(notifications)) notifications = [];
const tips = [
  "Akıllı seçim promptunu okuyup Planlayıcı, Gündelik, Kodlayıcı veya Analist agentına yönlendirir.",
  "Codex, Claude Code, OpenCode, Cursor, Copilot ve Gemini arasında motor değiştir.",
  "+ menüsünden Plan veya Tarayıcı modunu composer’a ekle.",
  "Onay modu: Her işlemde sor · Düzenlemeleri onayla · Plan.",
  "Sidebar’daki AI Ofisi ile farklı uzman takımları kurup birlikte çalıştır.",
  "Resim için + / Ctrl+V / sürükle-bırak; vision’suz modellerde yol uyarısı çıkar.",
  "Bağlantılar’dan CLI kurup oturum aç; modeller canlı listeden gelir."
];
let tipIndex = 0;
let projects = [];
let selectedProjectId = null;
let taskQueueState = { paused: false, tasks: [] };
let taskQueuePumpActive = false;
let activeQueuedTaskId = "";
let workspaceTrustState = { trusted: false };
let contextProjectId = null;
let contextProjectAnchor = null;
let contextProjectBounds = null;
let terminalId = null;
let selectedImages = [];
let multiAiPreparing = false;
const comparisonProgress = window.createComparisonProgress({
  root: document.querySelector("#comparisonProgress"),
  project: () => $("#projectPath").value,
  conversation: () => activeConversationId(),
  openConversation: async (projectPath, id, variantId) => {
    if ($("#projectPath").value !== projectPath) return;
    await activateConversation(id);
    showView("workspace");
    const root = $("#conversation");
    const output = [...root.querySelectorAll("[data-comparison-variant-id]")].find((el) => el.dataset.comparisonVariantId === variantId);
    if (output) root.scrollTo({ top: Math.max(0, root.scrollTop + output.closest(".message").getBoundingClientRect().top - root.getBoundingClientRect().top - 12), behavior: "smooth" });
  },
  openResult: async (runId) => {
    showView("workbench");
    await window.TaxCliWorkbench.openRun(runId);
  }
});
let multiAiCancelled = false;
let multiAiCurrentRun = "";
let collapsedProjectIds = new Set();
const expandedConversationArchives = new Set();
try {
  const savedCollapsedProjects = JSON.parse(localStorage.getItem("agenthub:collapsed-projects") || "[]");
  if (Array.isArray(savedCollapsedProjects)) collapsedProjectIds = new Set(savedCollapsedProjects.map(String));
} catch { collapsedProjectIds = new Set(); }
/** @type {WeakMap<Element, { files: Map<string, any>, thoughtCount: number, collapsed: boolean }>} */
const streamState = new WeakMap();
const parkedConversations = new Map();
const conversationsByProject = new Map();
const activeConversationByProject = new Map();
/** @type {Map<string, { projectPath: string, status: string }>} */
const runMeta = new Map();
/** @type {Map<string, string>} projectPath -> active runId */
const projectRuns = new Map();
const approvalQueue = [];
let activeApprovalRequest = null;
const officeJobs = new Map();
let activeOfficeJobId = null;
let engineDetectionPromise = null;
let sidebarNavigationBusy = false;
let pendingSidebarNavigation = null;
const historySaveTimers = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
let confirmDialogResolve = null;
let confirmDialogReturnFocus = null;

function persistNotifications() {
  notifications = notifications.slice(0, 200);
  localStorage.setItem("agenthub:notifications", JSON.stringify(notifications));
}

function renderNotifications() {
  const host = $("#notificationList");
  const unread = notifications.filter((item) => !item.read).length;
  const badge = $("#notificationBadge");
  if (badge) { badge.textContent = unread > 99 ? "99+" : String(unread); badge.hidden = unread === 0; }
  if ($("#notificationSummary")) $("#notificationSummary").textContent = unread ? `${unread} okunmamış bildirim` : "Yeni bildirim yok";
  if (!host) return;
  if (!notifications.length) {
    host.innerHTML = '<div class="notification-empty"><i class="fa-regular fa-bell-slash"></i><p>Henüz bildirim yok.</p></div>';
    return;
  }
  host.innerHTML = notifications.map((item) => {
    const icon = item.type === "error" ? "fa-triangle-exclamation" : item.type === "update" ? "fa-cloud-arrow-down" : item.type === "cloudflare" ? "fa-cloud" : "fa-check";
    return `<article class="notification-item ${escapeHtml(item.type)} ${item.read ? "" : "unread"}"><i class="fa-solid ${icon}"></i><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p></div><time>${new Date(item.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time></article>`;
  }).join("");
}

function pushNotification({ type = "success", title = "TaxCLI", message = "", dedupeKey = "" } = {}) {
  if (userSettings.inAppNotifications === false) return;
  const key = String(dedupeKey || "");
  const recent = key && notifications.find((item) => item.dedupeKey === key && Date.now() - item.createdAt < 60000);
  if (recent) {
    recent.count = (recent.count || 1) + 1;
    recent.message = `${String(message).slice(0, 220)} (${recent.count} kez)`;
    recent.createdAt = Date.now();
    recent.read = false;
  } else {
    notifications.unshift({ id: crypto.randomUUID(), type, title: String(title).slice(0, 80), message: String(message).slice(0, 260), createdAt: Date.now(), read: false, dedupeKey: key, count: 1 });
  }
  persistNotifications();
  renderNotifications();
}

function toast(message, type = "success") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 3200);
  if (type === "error" && userSettings.warningNotifications) {
    try {
      if (window.Notification?.permission === "granted") new Notification("TaxCLI", { body: message });
    } catch { /* ignore */ }
  }
}

function persistUsage() {
  localStorage.setItem("agenthub:usage-stats", JSON.stringify(usageStats));
}

function finishConfirmDialog(accepted) {
  const modal = $("#confirmModal");
  modal?.classList.remove("open");
  const resolve = confirmDialogResolve;
  confirmDialogResolve = null;
  resolve?.(Boolean(accepted));
  const returnFocus = confirmDialogReturnFocus;
  confirmDialogReturnFocus = null;
  if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
}

function askUserConfirmation({
  title = "Bu işlem yapılsın mı?",
  message = "Devam etmeden önce işlemi onayla.",
  note = "",
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  tone = "warning",
  eyebrow = "ONAY GEREKİYOR",
  icon = "fa-solid fa-triangle-exclamation"
} = {}) {
  if (confirmDialogResolve) finishConfirmDialog(false);
  const modal = $("#confirmModal");
  const dialog = modal?.querySelector(".confirm-dialog");
  if (!modal || !dialog) return Promise.resolve(false);
  confirmDialogReturnFocus = document.activeElement;
  dialog.dataset.confirmTone = ["warning", "danger", "info", "success"].includes(tone) ? tone : "warning";
  $("#confirmDialogIcon").innerHTML = `<i class="${escapeHtml(icon)}"></i>`;
  $("#confirmDialogEyebrow").textContent = eyebrow;
  $("#confirmDialogTitle").textContent = title;
  $("#confirmDialogMessage").textContent = message;
  const noteElement = $("#confirmDialogNote");
  noteElement.textContent = note;
  noteElement.hidden = !note;
  $("#acceptConfirmDialog").textContent = confirmLabel;
  $("#cancelConfirmDialog").textContent = cancelLabel;
  modal.classList.add("open");
  requestAnimationFrame(() => $("#cancelConfirmDialog")?.focus());
  return new Promise((resolve) => { confirmDialogResolve = resolve; });
}

function initialsForName(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/u)
    .map((word) => Array.from(word).filter((character) => /[\p{L}\p{N}]/u.test(character)).join(""))
    .filter(Boolean);
  const value = words.length > 1
    ? `${Array.from(words[0])[0] || ""}${Array.from(words[1])[0] || ""}`
    : Array.from(words[0] || "").slice(0, 2).join("");
  return (value || "YK").toLocaleUpperCase("tr-TR");
}

function recordProjectOpened(projectPath) {
  const normalized = String(projectPath || "").trim();
  if (!normalized || usageStats.projectsOpened.includes(normalized)) return;
  usageStats.projectsOpened = [...usageStats.projectsOpened, normalized].slice(-80);
  persistUsage();
  refreshUsageUi();
}

function recordUsageRun(promptText = "", replyText = "", details = {}) {
  usageStats.runs = (usageStats.runs || 0) + 1;
  const est = Math.ceil((String(promptText).length + String(replyText).length) / 4);
  usageStats.tokensEst = (usageStats.tokensEst || 0) + est;
  usageTracker.record({
    id: details.runId,
    engineId: details.engineId || activeEngine,
    model: details.model || modelByEngine[details.engineId || activeEngine] || "auto",
    prompt: promptText,
    reply: replyText,
    usage: details.usage,
    startedAt: details.startedAt,
    finishedAt: new Date().toISOString(),
    code: details.code,
    error: details.error,
    fileEdits: details.fileEdits || [],
    projectPath: details.projectPath || $("#projectPath")?.value || "",
    agentId: details.agentId || selectedAgentId
  });
  persistUsage();
  refreshUsageUi();
}

function accumulateSessionTime() {
  const now = Date.now();
  const started = usageStats.sessionStarted || now;
  usageStats.totalMs = (usageStats.totalMs || 0) + Math.max(0, now - started);
  usageStats.sessionStarted = now;
  persistUsage();
}

function formatHours(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours <= 0) return `${mins} dk`;
  return `${hours} sa ${mins} dk`;
}

function refreshUsageUi() {
  accumulateSessionTime();
  const totalMs = usageStats.totalMs || 0;
  const projectCount = new Set(usageStats.projectsOpened || []).size;
  const tokens = usageStats.tokensEst || 0;
  const runs = usageStats.runs || 0;
  const edits = usageStats.edits || 0;
  const fill = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  fill("usageHours", formatHours(totalMs));
  fill("usageProjects", String(projectCount));
  fill("usageTokens", tokens.toLocaleString("tr-TR"));
  fill("usageRuns", String(runs));
  fill("profileTokenHint", tokens.toLocaleString("tr-TR"));
  fill("profileProjectHint", String(projectCount));
  const days = $("#usagePeriod")?.value || "30";
  const provider = $("#usageProviderFilter")?.value || "all";
  const from = days === "all" ? undefined : new Date(Date.now() - Number(days) * 86400000).toISOString();
  const state = usageTracker.getState();
  const filteredState = provider === "all" ? state : { ...state, legacy: {}, runs: state.runs.filter((run) => run.engineId === provider) };
  const report = usageAnalytics.buildReport(filteredState, { from, includeLegacy: provider === "all" });
  const grid = $("#usageStatsGrid");
  const profileGrid = $("#profileStatsGrid");
  const billingTotal = report.summary.billingByUnit.length
    ? report.summary.billingByUnit.map((item) => `${item.amount.toFixed(2)} ${item.unit}${item.quality === "estimated" ? " ≈" : ""}`).join(" + ")
    : "—";
  const cards = [
    { label: "Kullanım süresi", value: formatHours(totalMs) },
    { label: "Açılan projeler", value: String(projectCount) },
    { label: "Ajan çalıştırma", value: String(report.summary.runCount || runs) },
    { label: "Toplam token", value: Number(report.summary.totalTokens || tokens).toLocaleString("tr-TR") },
    { label: "Kredi / maliyet", value: billingTotal },
    { label: "Başarı", value: report.summary.successRate == null ? "—" : `%${Math.round(report.summary.successRate * 100)}` },
    { label: "Dosya değişikliği", value: String(report.summary.fileEdits || edits) }
  ];
  const html = cards.map((c) => `<div class="stat-card"><strong>${escapeHtml(c.value)}</strong><small>${escapeHtml(c.label)}</small></div>`).join("");
  if (grid) grid.innerHTML = html;
  if (profileGrid) profileGrid.innerHTML = html;
  renderDetailedUsage(report, state);
}

function renderDetailedUsage(report, state) {
  const providers = [...new Set(state.runs.map((run) => run.engineId))].sort();
  const filter = $("#usageProviderFilter");
  if (filter) {
    const current = filter.value || "all";
    filter.innerHTML = '<option value="all">Tüm motorlar</option>' + providers.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(engines.find((item) => item.id === id)?.name || id)}</option>`).join("");
    filter.value = providers.includes(current) ? current : "all";
  }
  const dayRows = report.byDay.filter((row) => row.key !== "legacy").slice(-30);
  const maxTokens = Math.max(1, ...dayRows.map((row) => row.totalTokens));
  if ($("#usageDailyChart")) $("#usageDailyChart").innerHTML = dayRows.length ? dayRows.map((row) => {
    const level = Math.max(1, Math.min(10, Math.round(row.totalTokens / maxTokens * 10)));
    return `<div class="usage-day" title="${escapeHtml(row.key)} · ${row.totalTokens.toLocaleString("tr-TR")} token"><div class="usage-day-bar usage-level-${level}"></div><small>${escapeHtml(row.key.slice(5))}</small></div>`;
  }).join("") : '<div class="notification-empty">Bu dönem için kayıt yok.</div>';
  const modelRows = report.tableRows.filter((row) => !row.legacy).slice(0, 8);
  const maxModelTokens = Math.max(1, ...modelRows.map((row) => row.totalTokens));
  if ($("#usageModelChart")) $("#usageModelChart").innerHTML = modelRows.length ? modelRows.map((row) => `<div class="usage-model-row"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><progress class="usage-model-fill" max="${maxModelTokens}" value="${Math.max(1, row.totalTokens)}" aria-label="${escapeHtml(row.label)} token oranı"></progress><strong>${row.runs}</strong></div>`).join("") : '<div class="notification-empty">Model verisi henüz oluşmadı.</div>';
  if ($("#usageModelTable")) $("#usageModelTable").innerHTML = report.tableRows.map((row) => {
    const billing = row.billing.length ? row.billing.map((item) => `${item.amount.toFixed(2)} ${escapeHtml(item.unit)}${item.quality === "estimated" ? " ≈" : ""}`).join(" + ") : "—";
    const engineIds = [...new Set(state.runs.filter((run) => run.model === row.id).map((run) => run.engineId))];
    const engineLabel = engineIds.map((id) => engines.find((item) => item.id === id)?.name || id).join(", ");
    const quality = row.tokenQuality === "provider" ? "sağlayıcı verisi" : row.legacy ? "eski toplam" : "yerel tahmin";
    return `<tr><td><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(engineLabel || "Bilinmeyen motor")} · ${quality}</small></td><td>${row.runs}</td><td>${row.successRate == null ? "—" : `%${Math.round(row.successRate * 100)}`}</td><td>${row.inputTokens.toLocaleString("tr-TR")}</td><td>${row.outputTokens.toLocaleString("tr-TR")}</td><td>${billing}</td><td>${formatHours(row.durationMs)}</td><td>${row.fileEdits}</td></tr>`;
  }).join("");
}

function effortLevelsForModel(modelId = "", engineId = activeEngine) {
  const id = String(modelId || "").toLowerCase();
  if (/max|ultra|opus|o3|gpt-6|astra|gpt-5\.5|gpt-5\.6|sonnet-4|gemini-3\.1-pro/i.test(id)) {
    return ["low", "medium", "high", "ultra", "max"];
  }
  if (/flash|mini|haiku|nano|free|mimo|lite/i.test(id)) {
    return ["low", "medium", "high"];
  }
  if (engineId === "cursor" || /auto/i.test(id)) {
    return ["low", "medium", "high", "ultra"];
  }
  return ["low", "medium", "high", "max"];
}

function selectedEffortFor(modelId = "", engineId = activeEngine, agentId = selectedAgentId) {
  const supported = effortLevelsForModel(modelId, engineId);
  if (effortMode === "auto") return modelRouter.effortFor(routingPolicy, agentId, supported);
  return supported.includes(effortLevel)
    ? effortLevel
    : modelRouter.effortFor("balanced", agentId, supported);
}

let providerUsageLoading = false;
let providerUsageLoadedAt = 0;

function formatProviderReset(unixSeconds) {
  if (!Number.isFinite(Number(unixSeconds))) return "Sıfırlanma zamanı yok";
  const date = new Date(Number(unixSeconds) * 1000);
  return `Sıfırlanma: ${date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}`;
}

function providerWindowLabel(window, fallback) {
  const minutes = Number(window?.windowDurationMins);
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 10080 === 0) return `${minutes / 10080} haftalık`;
  if (minutes % 1440 === 0) return `${minutes / 1440} günlük`;
  if (minutes % 60 === 0) return `${minutes / 60} saatlik`;
  return `${minutes} dakikalık`;
}

function providerRemainingLevel(remainingPercent) {
  if (remainingPercent <= 15) return "critical";
  if (remainingPercent <= 35) return "warning";
  return "healthy";
}

function renderCodexUsageCard(codex = {}) {
  const identity = codex.email || (codex.planType ? `${codex.planType} planı` : "Codex CLI hesabı");
  const windows = [];
  (codex.buckets || []).forEach((bucket) => {
    if (bucket.primary) windows.push({ name: `${bucket.name} · ${providerWindowLabel(bucket.primary, "Birincil")}`, ...bucket.primary });
    if (bucket.secondary) windows.push({ name: `${bucket.name} · ${providerWindowLabel(bucket.secondary, "İkincil")}`, ...bucket.secondary });
  });
  const limits = windows.map((window) => {
    const remainingPercent = Math.max(0, Math.min(100, Number(window.remainingPercent) || 0));
    const roundedRemaining = Math.round(remainingPercent);
    const level = providerRemainingLevel(remainingPercent);
    return `
      <div class="provider-limit">
        <div class="provider-limit-row"><strong title="${escapeHtml(window.name)}">${escapeHtml(window.name)}</strong><span class="${level}">%${roundedRemaining} kaldı</span></div>
        <progress class="provider-meter ${level}" max="100" value="${remainingPercent}" title="%${roundedRemaining} kullanım hakkı kaldı" aria-label="%${roundedRemaining} kullanım hakkı kaldı"></progress>
        <small>${escapeHtml(formatProviderReset(window.resetsAt))}</small>
      </div>`;
  }).join("");
  const creditLabels = (codex.buckets || []).map((bucket) => bucket.credits).filter(Boolean).map((credits) => credits.unlimited ? "Sınırsız kredi" : credits.balance != null ? `${Number(credits.balance).toLocaleString("tr-TR")} kredi bakiye` : credits.hasCredits ? "Kredi kullanılabilir" : "");
  const summaryItems = [codex.summary?.lifetimeTokens != null ? `${Number(codex.summary.lifetimeTokens).toLocaleString("tr-TR")} toplam token` : "", ...new Set(creditLabels)].filter(Boolean);
  const summary = summaryItems.length ? `<div class="provider-usage-meta">${summaryItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : "";
  return `<article class="provider-usage-card">
    <div class="provider-usage-head">
      <img class="invert-dark" src="assets/engines/codex.svg" alt="">
      <span><strong>Codex</strong><small>${escapeHtml(identity)}</small></span>
      <em class="provider-state ${codex.available ? "ok" : ""}">${codex.available ? "Canlı" : "Alınamadı"}</em>
    </div>
    ${limits || `<p class="provider-usage-note">${escapeHtml(codex.message || "Codex limit bilgisi bulunamadı. CLI oturumunu kontrol edin.")}</p>`}
    ${summary}
  </article>`;
}

function renderCursorUsageCard(cursor = {}) {
  const details = [cursor.subscriptionTier, cursor.cliVersion && `CLI ${cursor.cliVersion}`].filter(Boolean).join(" · ")
    || (cursor.installed ? "Cursor Agent CLI" : "CLI bulunamadı");
  return `<article class="provider-usage-card">
    <div class="provider-usage-head">
      <img src="assets/engines/cursor.svg" alt="">
      <span><strong>Cursor</strong><small>${escapeHtml(details)}</small></span>
      <em class="provider-state ${cursor.authenticated ? "ok" : ""}">${cursor.authenticated ? "Bağlı" : "Bağlı değil"}</em>
    </div>
    <p class="provider-usage-note">${escapeHtml(cursor.message || "Kalan kullanım Cursor Spending panelinde gösterilir.")}</p>
    <button class="s-btn" type="button" data-open-cursor-usage data-url="${escapeHtml(cursor.dashboardUrl || "https://cursor.com/dashboard/spending")}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Cursor kullanımını aç</button>
  </article>`;
}

async function refreshProviderUsage(force = false) {
  const grid = $("#providerUsageGrid");
  if (!grid || providerUsageLoading) return;
  if (!force && providerUsageLoadedAt && Date.now() - providerUsageLoadedAt < 60000) return;
  providerUsageLoading = true;
  grid.innerHTML = `<div class="provider-usage-card loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Servis limitleri yükleniyor...</span></div>`;
  try {
    const result = await window.agentHub.getProviderUsage();
    providerUsageLoadedAt = Date.now();
    grid.innerHTML = `${renderCodexUsageCard(result?.codex)}${renderCursorUsageCard(result?.cursor)}`;
  } catch (error) {
    grid.innerHTML = `<div class="provider-usage-card loading"><i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(error.message || "Limit bilgileri alınamadı.")}</span></div>`;
  } finally {
    providerUsageLoading = false;
  }
  if (type === "error") pushNotification({ type: "error", title: "İşlem hatası", message, dedupeKey: `error:${String(message).slice(0, 90)}` });
}

function resolveSelectedAgent(prompt = "") {
  return agentRegistry.resolveAgent(selectedAgentId, prompt, {
    plan: contextFlags.plan || approvalMode === "plan",
    browser: contextFlags.browser,
    hasImages: selectedImages.length > 0
  });
}

function renderAgentSelector() {
  const prompt = $("#prompt")?.value || "";
  const resolution = resolveSelectedAgent(prompt);
  const selected = agentRegistry.byId[selectedAgentId] || agentRegistry.byId.auto;
  const button = $("#agentButton");
  const label = $("#agentButtonLabel");
  const icon = $("#agentButtonIcon");
  const list = $("#agentList");
  if (!button || !label || !icon || !list) return;

  const routedSuffix = resolution.automatic && prompt.trim()
    ? ` → ${resolution.profile.shortName}`
    : "";
  label.textContent = `${selected.shortName}${routedSuffix}`;
  icon.className = selected.icon;
  button.dataset.agentColor = selected.id;
  button.title = resolution.automatic
    ? `Prompt gönderildiğinde ${resolution.profile.name} kullanılacak.`
    : selected.description;

  list.innerHTML = agentProfiles.map((profile) => {
    const active = profile.id === selectedAgentId;
    const autoRoute = profile.id === "auto" && resolution.automatic && prompt.trim()
      ? `<small>Şu an: ${escapeHtml(resolution.profile.name)}</small>`
      : `<small>${escapeHtml(profile.description)}</small>`;
    return `<button type="button" role="menuitemradio" aria-checked="${active}" class="agent-option ${active ? "selected" : ""}" data-agent-id="${profile.id}">
      <span class="agent-option-icon" data-agent-color="${profile.id}"><i class="${profile.icon}"></i></span>
      <span><strong>${escapeHtml(profile.name)}</strong>${autoRoute}</span>
      ${active ? '<i class="fa-solid fa-check agent-check"></i>' : ""}
    </button>`;
  }).join("");

  $$('[data-agent-id]').forEach((option) => option.addEventListener("click", () => {
    selectedAgentId = agentRegistry.normalizeAgentId(option.dataset.agentId);
    localStorage.setItem("agenthub:agent", selectedAgentId);
    renderAgentSelector();
    closeRunTuningMenu();
    const profile = agentRegistry.byId[selectedAgentId];
    toast(`${profile.name} seçildi.`);
    $("#prompt")?.focus();
  }));
  updateRunTuningButton();
}

function renderRoutingPolicySelector() {
  const list = $("#routePolicyList");
  if (!list) return;
  list.innerHTML = modelRouter.policies.map((item) => {
    const active = item.id === routingPolicy;
    return `<button type="button" role="menuitemradio" aria-checked="${active}" class="tuning-policy-option ${active ? "selected" : ""}" data-routing-policy="${item.id}">
      <span class="agent-option-icon" data-agent-color="policy-${item.id}"><i class="${item.icon}"></i></span>
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span>
      ${active ? '<i class="fa-solid fa-check"></i>' : ""}
    </button>`;
  }).join("");
  $$('[data-routing-policy]').forEach((option) => option.addEventListener("click", () => {
    routingPolicy = modelRouter.normalizePolicy(option.dataset.routingPolicy);
    localStorage.setItem("agenthub:routing-policy", routingPolicy);
    renderRoutingPolicySelector();
    updateModelButton();
    renderEffortDropdown();
    closeRunTuningMenu();
    toast(`Auto politikası: ${modelRouter.byId[routingPolicy].name}`);
  }));
  updateRunTuningButton();
}

function buildRoutingCandidates() {
  const byDetectedId = Object.fromEntries(detected.map((item) => [item.id, item]));
  const allowed = new Set((userSettings.autoProviders || []).map(String));
  const candidates = [];
  for (const engine of engines) {
    const info = byDetectedId[engine.id] || {};
    const usable = routingScope === "all"
      ? Boolean(info.installed && info.authenticated && allowed.has(engine.id))
      : engine.id === activeEngine && Boolean(info.installed);
    if (!usable) continue;
    const known = normalizeModelEntries(availableModels[engine.id] || modelPresets[engine.id] || []);
    const selected = modelByEngine[engine.id];
    if (selected && selected !== "__auto__" && !known.some((model) => model.id === selected)) {
      known.push({ id: selected, label: selected });
    }
    const models = known.length ? known : [{ id: "", label: "Sağlayıcı varsayılanı" }];
    models.forEach((model) => candidates.push({ engineId: engine.id, model }));
  }
  return candidates;
}

function resolveRunTarget(agentResolution, { hasImages = false } = {}) {
  const target = modelRouter.selectRunTarget({
    scope: routingScope,
    activeEngine,
    selectedModel: modelByEngine[activeEngine] ?? "",
    policy: routingPolicy,
    agentId: agentResolution.resolvedId,
    hasImages,
    allowedEngineIds: userSettings.autoProviders,
    candidates: buildRoutingCandidates()
  });
  target.effort = selectedEffortFor(target.model, target.engineId, agentResolution.resolvedId);
  target.appliedPolicy = target.automatic || effortMode === "auto" ? target.policy : "balanced";
  target.engineName = engines.find((engine) => engine.id === target.engineId)?.name || target.engineId;
  target.modelLabel = target.modelLabel || target.model || "Sağlayıcı varsayılanı";
  target.summary = `${target.engineName} · ${target.modelLabel} · ${target.effort}`;
  return target;
}

function renderContextChips() {
  const host = $("#contextChips");
  if (!host) return;
  const chips = [];
  if (contextFlags.plan) {
    chips.push(`<span class="context-chip plan" data-chip="plan"><i class="fa-regular fa-map lead"></i>Plan<button type="button" data-remove-chip="plan" aria-label="Kaldır"><i class="fa-solid fa-xmark"></i></button></span>`);
  }
  if (contextFlags.browser) {
    chips.push(`<span class="context-chip" data-chip="browser"><i class="fa-solid fa-globe lead"></i>Tarayıcı<button type="button" data-remove-chip="browser" aria-label="Kaldır"><i class="fa-solid fa-xmark"></i></button></span>`);
  }
  if (contextFlags.multiAi) {
    chips.push(`<span class="context-chip multi-ai" data-chip="multiAi" title="Model seçimini düzenle"><i class="fa-solid fa-code-branch lead"></i>Çoklu AI · ${multiAiSelection.length}<button type="button" data-remove-chip="multiAi" aria-label="Kaldır"><i class="fa-solid fa-xmark"></i></button></span>`);
  }
  if (contextFlags.office) {
    const manager = officeRegistry.managerOf(officeTeam);
    const count = officeRegistry.workersOf(officeTeam).length;
    chips.push(`<span class="context-chip office" data-chip="office" title="Ofis kadrosunu düzenle"><i class="fa-solid fa-building-user lead"></i>${escapeHtml(activeOfficeTeamRecord()?.name || manager?.name || "AI Ofisi")} · ${count + 1} kişi<button type="button" data-remove-chip="office" aria-label="Kaldır"><i class="fa-solid fa-xmark"></i></button></span>`);
  }
  if (contextFlags.subagents) {
    const count = officeRegistry.workersOf(officeTeam).filter((member) => member.enabled).length;
    chips.push(`<span class="context-chip office" data-chip="subagents" title="Yönetici görevi alt ajanlara bölecek"><i class="fa-solid fa-people-arrows lead"></i>Alt ajanlar · ${count}<button type="button" data-remove-chip="subagents" aria-label="Kaldır"><i class="fa-solid fa-xmark"></i></button></span>`);
  }
  host.innerHTML = chips.join("");
  host.classList.toggle("has-chips", chips.length > 0);
  $$("[data-remove-chip]").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const key = btn.dataset.removeChip;
    if (key === "plan") {
      contextFlags.plan = false;
      if (approvalMode === "plan") setApprovalMode(userSettings.defaultApproval || "ask", { skipConfirm: true });
    }
    if (key === "browser") {
      contextFlags.browser = false;
      closeBrowserPane();
    }
    if (key === "multiAi") contextFlags.multiAi = false;
    if (key === "office") contextFlags.office = false;
    if (key === "subagents") contextFlags.subagents = false;
    renderContextChips();
  }));
  $('[data-chip="multiAi"]')?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-chip]")) return;
    openMultiAiModal();
  });
  $('[data-chip="office"]')?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-chip]")) return;
    openOfficeModal();
  });
  $('[data-chip="subagents"]')?.addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-chip]")) return;
    showView("office");
  });
  $("#approvalButton")?.classList.toggle("active-mode", approvalMode === "plan" || contextFlags.plan);
  renderAgentSelector();
  renderRoutingPolicySelector();
}

async function setApprovalMode(next, { skipConfirm = false } = {}) {
  if (next === "auto_edit" && !skipConfirm && !(await askUserConfirmation({
    title: "Otomatik düzenleme etkinleştirilsin mi?",
    message: "Seçili ajan proje içindeki dosyaları düzenleyip normal proje komutlarını çalıştırabilecek. Codex ek erişim isteklerini otomatik güvenlik incelemesine yönlendirecek.",
    note: "Riskli işlemler engellenebilir. Otomatik inceleme ek Codex kullanımı oluşturabilir. Seçim yeni başlatılan görevlere uygulanır.",
    confirmLabel: "Modu etkinleştir",
    tone: "warning",
    icon: "fa-solid fa-bolt"
  }))) return;
  const changed = approvalMode !== next;
  approvalMode = next;
  localStorage.setItem("agenthub:approval", approvalMode);
  if (next === "plan") contextFlags.plan = true;
  else if (contextFlags.plan && next !== "plan") contextFlags.plan = false;
  updateApprovalLabel();
  renderContextChips();
  $$(".approval-option").forEach((btn) => btn.classList.toggle("selected", btn.dataset.approval === approvalMode));
  if (changed && projectRuns.size) toast("İzin seçimi yeni görevlere uygulanır; çalışan görevlerin izinleri değişmez.");
}

const BROWSER_SITE_HINTS = [
  { re: /cloudflare|cf\s*dash|dash\.cloudflare/i, url: "https://dash.cloudflare.com" },
  { re: /workers\.dev|cloudflare\s*workers/i, url: "https://dash.cloudflare.com/?to=/:account/workers-and-pages" },
  { re: /github(\.com)?/i, url: "https://github.com" },
  { re: /gitlab/i, url: "https://gitlab.com" },
  { re: /vercel/i, url: "https://vercel.com/dashboard" },
  { re: /netlify/i, url: "https://app.netlify.com" },
  { re: /supabase/i, url: "https://supabase.com/dashboard" },
  { re: /notion/i, url: "https://www.notion.so" },
  { re: /figma/i, url: "https://www.figma.com" },
  { re: /google\s*(search|ara|a\u00e7)?/i, url: "https://www.google.com" },
  { re: /youtube|youtu\.be/i, url: "https://www.youtube.com" },
  { re: /stackoverflow|stack\s*overflow/i, url: "https://stackoverflow.com" },
  { re: /npmjs|npm\s*package/i, url: "https://www.npmjs.com" }
];

function stripTrailingPunct(url) {
  return String(url || "").replace(/[.,;:!?)\]}'"]+$/g, "");
}

/** Resolve a navigation target from user text. Returns null if none found. */
function extractBrowserTarget(text = "") {
  const source = String(text || "").trim();
  if (!source) return null;
  const full = source.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (full) return stripTrailingPunct(full);
  const www = source.match(/\b((?:www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?)/i)?.[0];
  if (www) return `https://${stripTrailingPunct(www)}`;
  const domain = source.match(/\b([a-z0-9][a-z0-9-]{0,61}\.(?:com|net|org|io|dev|app|co|ai|gg|cloud|pages\.dev)(?:\/[^\s<>"']*)?)/i)?.[0];
  if (domain && !/^(localhost|example\.com)/i.test(domain)) return `https://${stripTrailingPunct(domain)}`;
  for (const hint of BROWSER_SITE_HINTS) {
    if (hint.re.test(source)) return hint.url;
  }
  return null;
}

function isBrowserPaneOpen() {
  const pane = $("#browserPane");
  const layout = $("#workspaceLayout");
  return Boolean(pane && !pane.hidden && layout?.classList.contains("split"));
}

function getBrowserCurrentUrl() {
  try {
    const webview = $("#agentBrowser");
    const live = webview?.getURL?.();
    if (live && live !== "about:blank") return live;
  } catch { /* ignore */ }
  const bar = $("#browserUrl")?.value?.trim();
  if (bar && bar !== "about:blank") return bar;
  return "";
}

function navigateAgentBrowser(url, { force = true } = {}) {
  if (!url) return false;
  let target = String(url).trim();
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  try {
    const parsed = new URL(target);
    const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) return false;
    target = parsed.href;
  } catch { return false; }
  $("#browserUrl").value = target;
  try {
    const webview = $("#agentBrowser");
    const current = getBrowserCurrentUrl();
    if (!force && current && normalizeBrowserUrl(current) === normalizeBrowserUrl(target)) return true;
    if (webview?.loadURL) webview.loadURL(target);
    else if (webview) webview.src = target;
  } catch { /* ignore */ }
  return true;
}

function normalizeBrowserUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch { return String(url || "").replace(/\/$/, ""); }
}

function browserUrlForModel(value) {
  try {
    const url = new URL(String(value || ""));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function redactBrowserText(value) {
  return String(value || "")
    .replace(/\bBearer\s+[a-zA-Z0-9._~+/=-]{8,}\b/gi, "[REDACTED]")
    .replace(/\b(?:sk|nvapi|gh[opusr]|github_pat|AIza|xox[baprs])[-_a-zA-Z0-9]{10,}\b/g, "[REDACTED]")
    .replace(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]{6,}/gi, "$1=[REDACTED]");
}

/**
 * Open the side browser. Only navigate when:
 * - a new target URL is provided, OR
 * - the pane is closed (first open uses target / current / homepage).
 * Never force google reset if user already has a live page.
 */
function openBrowserPane(url, { navigate = "auto" } = {}) {
  if (userSettings.browserAutoPanel === false) {
    toast("Tarayıcı kontrolü Ayarlar → Tarayıcı bölümünde kapalı.", "error");
    return false;
  }
  const layout = $("#workspaceLayout");
  const pane = $("#browserPane");
  if (!layout || !pane) return false;
  const wasOpen = isBrowserPaneOpen();
  pane.hidden = false;
  layout.classList.add("split");
  hardensWebviewOnce();

  const target = url || null;
  const current = getBrowserCurrentUrl();
  let shouldNavigate = false;
  let navUrl = target;

  if (navigate === true || navigate === "force") {
    shouldNavigate = Boolean(navUrl);
  } else if (navigate === false || navigate === "never") {
    shouldNavigate = false;
  } else {
    // auto: navigate only if target given, or pane was closed without a page
    if (target) {
      shouldNavigate = !wasOpen || !current || normalizeBrowserUrl(current) !== normalizeBrowserUrl(target);
    } else if (!wasOpen && !current) {
      navUrl = userSettings.homepage || "https://www.google.com";
      shouldNavigate = true;
    }
  }

  if (shouldNavigate && navUrl) navigateAgentBrowser(navUrl, { force: true });
  else if (current) $("#browserUrl").value = current;
  showView("workspace");
  return true;
}

function browserPluginAllowsUrl(pluginId, url) {
  if (!pluginId) return true;
  try {
    const parsed = new URL(url);
    if (approvedBrowserOrigins.has(parsed.origin)) return true;
    const allowed = browserPluginHosts[pluginId] || [];
    return parsed.protocol === "https:" && allowed.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

async function confirmBrowserPluginNavigation(url) {
  if (!activeBrowserPluginId || browserPluginAllowsUrl(activeBrowserPluginId, url)) return true;
  let origin = url;
  try { origin = new URL(url).origin; } catch { return false; }
  const plugin = plugins.find((item) => item.id === activeBrowserPluginId);
  const accepted = await askUserConfirmation({
    title: `${plugin?.name || "Eklenti"} farklı bir alana gidiyor`,
    message: `${origin} bu eklentinin varsayılan izin listesinde değil.`,
    note: "Yalnızca bu uygulama oturumu için izin verilir. Parola veya gizli bilgi isteyen bilinmeyen alanları reddet.",
    confirmLabel: "Bu alana izin ver",
    tone: "warning",
    eyebrow: "DIŞ ALAN ADI",
    icon: "fa-solid fa-shield-halved"
  });
  if (accepted) approvedBrowserOrigins.add(origin);
  window.agentHub.recordSecurityEvent?.({ type: "browser.external-domain", details: { pluginId: activeBrowserPluginId, origin, accepted } }).catch(() => {});
  return accepted;
}

let webviewHardened = false;
function hardensWebviewOnce() {
  if (webviewHardened) return;
  const webview = $("#agentBrowser");
  if (!webview) return;
  webviewHardened = true;
  const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const apply = () => {
    try { webview.setUserAgent?.(chromeUA); } catch { /* ignore */ }
    try {
      webview.executeJavaScript?.(`
        try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
        try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array; } catch (e) {}
      `).catch(() => {});
    } catch { /* ignore */ }
  };
  webview.addEventListener("dom-ready", apply);
  if (webview.getWebContentsId) {
    try { apply(); } catch { /* not ready */ }
  }
}

function closeBrowserPane() {
  const layout = $("#workspaceLayout");
  const pane = $("#browserPane");
  if (layout) layout.classList.remove("split");
  if (pane) pane.hidden = true;
  // Do not navigate to about:blank — keeps Cloudflare/session cookies in partition when reopened
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Guest-page script: deep-read visible UI, skip cookie walls, list domains.
 * Returned as a string so executeJavaScript serialization stays reliable.
 */
const BROWSER_READ_SCRIPT = `(() => {
  const clean = (s) => String(s || "").replace(/[\\u00a0\\t\\r\\n ]+/g, " ").trim();
  const isCookieish = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const blob = ((el.id || "") + " " + (el.className || "") + " " + (el.getAttribute?.("aria-label") || "") + " " + (el.getAttribute?.("role") || "")).toLowerCase();
    return /cookie|consent|onetrust|gdpr|privacy.?banner|ot-sdk|cf-cookie|truste/i.test(blob) ||
      /cookie|çerez|consent|gizlilik politikası|privacy policy|manage preferences|tercihleri yönet/i.test(clean(el.innerText || "").slice(0, 280));
  };
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const walkShadow = (root, out) => {
    if (!root) return;
    const kids = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of kids) {
      out.push(el);
      if (el.shadowRoot) walkShadow(el.shadowRoot, out);
    }
  };
  const all = [];
  walkShadow(document, all);

  // Collect hostnames / domains strongly
  const hostSet = new Set();
  const domainRe = /\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:com|net|org|io|dev|app|co|ai|gg|cloud|tr|uk|de|fr|dev|page|site)(?:\\.[a-z]{2})?\\b/gi;
  const pushHosts = (s) => {
    const m = String(s || "").match(domainRe) || [];
    m.forEach((d) => {
      const low = d.toLowerCase();
      if (/cloudflare\\.com|google\\.com|gstatic|facebook|doubleclick|onetrust|example\\.com/.test(low)) return;
      hostSet.add(low);
    });
  };

  const headings = [];
  const buttons = [];
  const rows = [];
  const links = [];
  const textParts = [];

  for (const el of all) {
    if (!isVisible(el)) continue;
    if (isCookieish(el) && el.tagName !== "BODY" && el.tagName !== "HTML") continue;
    const tag = (el.tagName || "").toLowerCase();
    const t = clean(el.innerText || el.textContent || "");
    if (!t) continue;
    if (tag === "h1" || tag === "h2" || tag === "h3" || el.getAttribute("role") === "heading") {
      if (t.length < 160) headings.push(t);
    }
    if (tag === "button" || el.getAttribute("role") === "button" || tag === "a") {
      if (t.length > 0 && t.length < 100) buttons.push(t);
    }
    if (tag === "a" && el.href && /^https?:/i.test(el.href)) {
      links.push({ text: t.slice(0, 100), href: el.href });
    }
    // table / list / card-ish chunks
    if (["tr", "li", "td", "th", "article", "section"].includes(tag) && t.length > 2 && t.length < 400) {
      rows.push(t);
      pushHosts(t);
    }
    pushHosts(t);
  }

  // Full page text without cookie nodes: clone approach
  let full = "";
  try {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(
      '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[class*="onetrust" i],[aria-label*="cookie" i],#onetrust-banner-sdk,#onetrust-consent-sdk,.osano-cm-window'
    ).forEach((n) => n.remove());
    full = clean(clone.innerText || clone.textContent || "");
  } catch (e) {
    full = clean(document.body?.innerText || "");
  }
  pushHosts(full);

  // Prefer center/main region text
  let mainText = "";
  const main = document.querySelector('main,[role="main"],#root,#app,#react-root,[data-testid*="dashboard" i]') || document.body;
  if (main) mainText = clean(main.innerText || "");
  pushHosts(mainText);

  // Rank: if full is cookie-heavy, use main + rows
  const cookieScore = (s) => {
    const m = String(s || "").toLowerCase().match(/cookie|çerez|consent|privacy policy|gizlilik|onetrust|manage preferences/g);
    return m ? m.length : 0;
  };
  let primary = mainText || full;
  if (cookieScore(primary) > 8 && rows.length) {
    primary = rows.slice(0, 80).join(" \\n ");
  } else if (cookieScore(full) > cookieScore(mainText) + 3) {
    primary = mainText || rows.join(" \\n ") || full;
  }

  // Build condensed page map
  const hosts = [...hostSet].slice(0, 40);
  const unique = (arr) => [...new Set(arr.map((x) => clean(x)).filter(Boolean))];
  return {
    title: document.title || "",
    url: location.href,
    domain: location.hostname,
    readyState: document.readyState,
    hostnames: hosts,
    headings: unique(headings).slice(0, 40),
    buttons: unique(buttons).slice(0, 40),
    rows: unique(rows).slice(0, 60),
    links: links.filter((l, i, a) => a.findIndex((x) => x.href === l.href) === i).slice(0, 40),
    text: (primary || full || "").slice(0, 28000),
    cookieHints: cookieScore(full),
    textLen: (primary || full || "").length
  };
})()`;

function scoreBrowserSnap(raw) {
  if (!raw) return -1;
  const hosts = Array.isArray(raw.hostnames) ? raw.hostnames.length : 0;
  const textLen = String(raw.text || "").length;
  const cookie = Number(raw.cookieHints || 0);
  const heads = Array.isArray(raw.headings) ? raw.headings.length : 0;
  return hosts * 120 + Math.min(textLen, 8000) + heads * 15 - cookie * 40;
}

/**
 * Read live UI from the agent browser (retries until account content beats cookie spam).
 */
async function captureBrowserSnapshot({ maxChars = 16000, attempts = 4 } = {}) {
  const webview = $("#agentBrowser");
  const fallbackUrl = getBrowserCurrentUrl();
  if (!webview || !fallbackUrl || fallbackUrl === "about:blank") {
    return { ok: false, url: fallbackUrl || "", title: "", text: "", headings: [], links: [], hostnames: [], error: "Tarayıcıda açık sayfa yok" };
  }
  if (typeof webview.executeJavaScript !== "function") {
    return { ok: false, url: fallbackUrl, title: "", text: "", headings: [], links: [], hostnames: [], error: "Webview okuma desteklenmiyor" };
  }

  let best = null;
  let lastError = "";

  for (let i = 0; i < attempts; i += 1) {
    try {
      if (webview.isLoading?.() && i === 0) {
        await new Promise((resolve) => {
          const done = () => { webview.removeEventListener("did-stop-loading", done); resolve(); };
          webview.addEventListener("did-stop-loading", done);
          setTimeout(done, 3500);
        });
      }
      // short settle for SPAs
      if (i > 0) await sleep(450 + i * 200);

      const raw = await webview.executeJavaScript(BROWSER_READ_SCRIPT, true);
      if (!raw || typeof raw !== "object") {
        lastError = "Boş webview cevabı";
        continue;
      }
      const snap = {
        ok: true,
        url: browserUrlForModel(raw.url || fallbackUrl),
        title: redactBrowserText(raw.title || ""),
        domain: raw.domain || "",
        headings: Array.isArray(raw.headings) ? raw.headings.map(redactBrowserText) : [],
        links: Array.isArray(raw.links) ? raw.links.map((link) => ({ text: redactBrowserText(link.text), href: browserUrlForModel(link.href) })).filter((link) => link.href) : [],
        buttons: Array.isArray(raw.buttons) ? raw.buttons.map(redactBrowserText) : [],
        rows: Array.isArray(raw.rows) ? raw.rows.map(redactBrowserText) : [],
        hostnames: Array.isArray(raw.hostnames) ? raw.hostnames : [],
        text: redactBrowserText(raw.text || "").slice(0, maxChars),
        cookieHints: Number(raw.cookieHints || 0),
        error: ""
      };
      // Also harvest domains from url path
      if (snap.url) {
        try {
          const u = new URL(snap.url);
          if (u.hostname && !/cloudflare\.com$/.test(u.hostname)) snap.hostnames.push(u.hostname);
        } catch { /* ignore */ }
      }
      // secondary domain hunt in text
      const more = String(snap.text).match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|co|tr|cloud)(?:\.[a-z]{2})?\b/gi) || [];
      more.forEach((d) => {
        const low = d.toLowerCase();
        if (!/cloudflare\.com|google|gstatic|onetrust|facebook/.test(low) && !snap.hostnames.includes(low)) {
          snap.hostnames.push(low);
        }
      });
      snap.hostnames = [...new Set(snap.hostnames)].slice(0, 50);

      if (!best || scoreBrowserSnap(snap) > scoreBrowserSnap(best)) best = snap;

      // Good enough: has hostnames or long non-cookie text
      if (snap.hostnames.length >= 1 || (snap.text.length > 400 && snap.cookieHints < 6)) break;
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }

  if (!best) {
    return {
      ok: false,
      url: fallbackUrl,
      title: "",
      text: "",
      headings: [],
      links: [],
      hostnames: [],
      error: lastError || "Sayfa okunamadı"
    };
  }
  if (!best.text && !best.hostnames.length && !best.headings.length) {
    best.ok = false;
    best.error = lastError || "Sayfa metni boş (korumalı iframe veya henüz yüklenmedi)";
  }
  return best;
}

function formatBrowserSnapshotForPrompt(snap) {
  if (!snap) return "";
  const lines = [
    "=== TaxCLI TARAYICI CANLI OKUMA (SAĞ PANEL — BUNU GÖRÜYORSUN) ===",
    "Kural: Aşağıdaki veri sağ paneldaki gerçek sayfadan okundu. 'Göremiyorum', 'cookie outer' veya bot-challenge varsayımı yapma.",
    `URL: ${snap.url || "bilinmiyor"}`,
    snap.title ? `Sekme başlığı: ${snap.title}` : "",
    snap.domain ? `Host: ${snap.domain}` : ""
  ].filter(Boolean);

  if (snap.hostnames?.length) {
    lines.push("Hesapta / sayfada görünen alan adları (önemli):");
    snap.hostnames.forEach((h, i) => lines.push(`  ${i + 1}. ${h}`));
  }
  if (snap.headings?.length) {
    lines.push("Başlıklar:");
    snap.headings.slice(0, 20).forEach((h, i) => lines.push(`  ${i + 1}. ${h}`));
  }
  if (snap.buttons?.length) {
    lines.push("Görünen düğmeler/etiketler:");
    lines.push(snap.buttons.slice(0, 25).join(" · "));
  }
  if (snap.rows?.length) {
    lines.push("Liste/satır özeti:");
    snap.rows.slice(0, 30).forEach((r) => lines.push(`  • ${r}`));
  }
  if (snap.links?.length) {
    lines.push("Linkler:");
    snap.links.slice(0, 20).forEach((l) => lines.push(`  - ${(l.text || "").slice(0, 60) || "(link)"} → ${l.href}`));
  }
  if (snap.text) {
    lines.push("Sayfa gövdesi (cookie panelleri ayıklandı, kırpılmış):");
    lines.push(snap.text);
  } else if (snap.error) {
    lines.push(`Okuma notu: ${snap.error}`);
  }
  lines.push("=== /TARAYICI CANLI OKUMA ===");
  lines.push("Yukarıdaki alan adları ve metin gerçek dashboard içeriğidir. Kullanıcıya gördüğün domainleri ve paneli açıkça say.");
  return `\n\n${lines.join("\n")}`;
}

/* ── Sandboxed browser controller (agent drives the side webview) ── */

function waitWebviewSettled(timeoutMs = 8000) {
  const webview = $("#agentBrowser");
  if (!webview) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { webview.removeEventListener("did-stop-loading", onStop); } catch { /* ignore */ }
      clearTimeout(timer);
      resolve();
    };
    const onStop = () => finish();
    webview.addEventListener("did-stop-loading", onStop);
    const timer = setTimeout(finish, timeoutMs);
    if (!webview.isLoading?.()) {
      setTimeout(finish, 350);
    }
  });
}

function parseBrowserActions(text = "") {
  const source = String(text || "");
  const actions = [];
  const push = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const action = String(obj.action || obj.type || obj.cmd || "").toLowerCase().trim();
    if (!action) return;
    actions.push({
      action,
      url: obj.url || obj.href || "",
      text: obj.text || obj.label || obj.name || "",
      selector: obj.selector || obj.css || obj.qid || "",
      value: obj.value != null ? String(obj.value) : (obj.text != null && action === "type" ? String(obj.text) : ""),
      key: obj.key || obj.keys || "Enter",
      x: Number(obj.x),
      y: Number(obj.y),
      ms: Number(obj.ms || obj.wait || 800),
      direction: obj.direction || "down",
      amount: Number(obj.amount || obj.dy || 600)
    });
  };

  // BROWSER_ACTION: {...}
  const lineRe = /BROWSER_ACTION\s*:\s*(\{[\s\S]*?\})(?=\s*(?:BROWSER_ACTION\s*:|$|\n\n))/gi;
  let m;
  const raw = source.replace(/\r\n/g, "\n");
  // simpler line-based JSON
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    const idx = trimmed.search(/BROWSER_ACTION\s*:/i);
    if (idx < 0) return;
    const jsonPart = trimmed.slice(trimmed.indexOf(":") + 1).trim();
    try { push(JSON.parse(jsonPart)); } catch {
      const brace = jsonPart.match(/\{[\s\S]*\}/);
      if (brace) {
        try { push(JSON.parse(brace[0])); } catch { /* ignore */ }
      }
    }
  });

  // ```browser ... ```
  const fence = raw.match(/```(?:browser|browser-actions?|agenthub-browser)\s*([\s\S]*?)```/gi) || [];
  fence.forEach((block) => {
    const body = block.replace(/```(?:browser|browser-actions?|agenthub-browser)\s*/i, "").replace(/```$/, "").trim();
    body.split("\n").forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      try {
        if (t.startsWith("{")) push(JSON.parse(t));
        else if (/^goto\s+/i.test(t)) push({ action: "goto", url: t.replace(/^goto\s+/i, "").trim() });
        else if (/^click\s+/i.test(t)) push({ action: "click", text: t.replace(/^click\s+/i, "").trim() });
        else if (/^done$/i.test(t)) push({ action: "done" });
      } catch { /* ignore */ }
    });
    // whole array
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) parsed.forEach(push);
      else push(parsed);
    } catch { /* ignore */ }
  });

  // de-dupe consecutive identical
  return actions.filter((a, i, arr) => {
    if (i === 0) return true;
    const p = arr[i - 1];
    return JSON.stringify(a) !== JSON.stringify(p);
  });
}

function stripBrowserActionMarkup(text = "") {
  return String(text || "")
    .replace(/```(?:browser|browser-actions?|agenthub-browser)[\s\S]*?```/gi, "")
    .replace(/^.*BROWSER_ACTION\s*:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** When the LLM forgets protocol, infer clicks from user ask + live snapshot. */
function buildAutoBrowserActions(userTask = "", snap = {}) {
  const task = String(userTask || "").toLowerCase();
  const hosts = Array.isArray(snap.hostnames) ? snap.hostnames : [];
  const actions = [];
  const domainFromTask = (userTask.match(/\b([a-z0-9][a-z0-9-]*\.(?:com|net|org|io|dev|app|co|tr)(?:\.[a-z]{2})?)\b/i) || [])[1];
  const domain = domainFromTask
    || hosts.find((h) => task.includes(String(h).toLowerCase()))
    || hosts[0];

  if (!snap.url || /google\.|about:blank/i.test(snap.url)) {
    if (/cloudflare|dns|domain|zones?/i.test(task)) {
      actions.push({ action: "goto", url: "https://dash.cloudflare.com" });
      actions.push({ action: "wait", ms: 1500 });
      return actions;
    }
  }
  if (domain && (/dns|kayıt|kayit|record|nameserver|ns\b/i.test(task) || /görebili|gorebili|göster|goster/i.test(task))) {
    actions.push({ action: "click", text: domain });
    actions.push({ action: "wait", ms: 1400 });
    if (/dns|kayıt|kayit|record/i.test(task)) {
      actions.push({ action: "click", text: "DNS" });
      actions.push({ action: "wait", ms: 1200 });
    }
    return actions;
  }
  if (domain && /domain|zone|site|hesap/i.test(task) && hosts.includes(domain)) {
    actions.push({ action: "click", text: domain });
    actions.push({ action: "wait", ms: 1200 });
    return actions;
  }
  return actions;
}

async function webviewEval(script) {
  const webview = $("#agentBrowser");
  if (!webview?.executeJavaScript) throw new Error("Webview yok");
  return webview.executeJavaScript(script, true);
}

async function executeBrowserAction(action, { container } = {}) {
  const act = String(action.action || "").toLowerCase();
  const label = (() => {
    if (act === "goto" || act === "navigate" || act === "open") return `goto ${action.url || ""}`.trim();
    if (act === "click") return `click ${action.text || action.selector || ""}`.trim();
    if (act === "type") return `type ${action.selector || ""}`;
    if (act === "done") return "done";
    return act;
  })();
  if (container) addToolChip(container, "browser", label.slice(0, 80));
  $("#runStatus").textContent = `Tarayıcı · ${label.slice(0, 48)}`;

  if (act === "done" || act === "finish" || act === "stop") {
    return { ok: true, done: true };
  }

  const currentUrl = getBrowserCurrentUrl() || "about:blank";
  let approvalMessage = "";
  if (["type", "fill", "input"].includes(act)) {
    approvalMessage = `Ajan ${currentUrl} sayfasındaki bir alana metin yazmak istiyor.`;
  } else if (["click", "tap"].includes(act)) {
    approvalMessage = `Ajan ${currentUrl} sayfasında “${String(action.text || action.selector || "seçili öğe").slice(0, 100)}” öğesine tıklamak istiyor.`;
  } else if (["press", "key"].includes(act)) {
    approvalMessage = `Ajan ${currentUrl} sayfasında ${String(action.key || "Enter").slice(0, 30)} tuşunu göndermek istiyor.`;
  } else if (["goto", "navigate", "open"].includes(act)) {
    try {
      const targetUrl = new URL(String(action.url || ""), currentUrl === "about:blank" ? undefined : currentUrl);
      const localHttp = targetUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(targetUrl.hostname);
      if (targetUrl.protocol !== "https:" && !localHttp) {
        return { ok: false, error: "yalnızca HTTPS veya yerel HTTP adreslerine izin verilir", done: true };
      }
      const currentOrigin = currentUrl === "about:blank" ? "" : new URL(currentUrl).origin;
      if (targetUrl.origin !== currentOrigin) approvalMessage = `Ajan yeni bir alana gitmek istiyor: ${targetUrl.origin}`;
    } catch {
      return { ok: false, error: "geçersiz veya güvensiz URL", done: true };
    }
  }
  if (approvalMessage) {
    const approved = await askUserConfirmation({
      title: "Tarayıcı eylemine izin verilsin mi?",
      message: approvalMessage,
      note: "Sayfa içeriği güvenilmeyen veri sayılır. Onay yalnızca bu eylem için geçerlidir.",
      confirmLabel: "Bu eyleme izin ver",
      eyebrow: "TARAYICI ONAYI",
      icon: "fa-solid fa-globe"
    });
    if (!approved) return { ok: false, denied: true, done: true, error: "Kullanıcı eylemi reddetti." };
  }

  if (act === "goto" || act === "navigate" || act === "open") {
    if (!action.url) return { ok: false, error: "url yok" };
    openBrowserPane(action.url, { navigate: "force" });
    await waitWebviewSettled(10000);
    await sleep(500);
    return { ok: true, url: getBrowserCurrentUrl() };
  }

  if (act === "back") {
    const wv = $("#agentBrowser");
    if (wv?.canGoBack?.()) wv.goBack();
    await waitWebviewSettled(6000);
    return { ok: true };
  }
  if (act === "forward") {
    const wv = $("#agentBrowser");
    if (wv?.canGoForward?.()) wv.goForward();
    await waitWebviewSettled(6000);
    return { ok: true };
  }
  if (act === "reload" || act === "refresh") {
    $("#agentBrowser")?.reload?.();
    await waitWebviewSettled(8000);
    return { ok: true };
  }
  if (act === "wait" || act === "sleep") {
    await sleep(Math.min(Math.max(action.ms || 800, 200), 15000));
    return { ok: true };
  }
  if (act === "scroll") {
    const y = Number.isFinite(action.y) ? action.y : (action.direction === "up" ? -Math.abs(action.amount || 600) : Math.abs(action.amount || 600));
    await webviewEval(`window.scrollBy(0, ${y}); true`);
    await sleep(300);
    return { ok: true };
  }
  if (act === "press" || act === "key") {
    const key = JSON.stringify(String(action.key || "Enter"));
    await webviewEval(`(() => {
      const el = document.activeElement || document.body;
      const opts = { key: ${key}, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", opts));
      el.dispatchEvent(new KeyboardEvent("keyup", opts));
      if (${key} === "Enter" && el.form) el.form.requestSubmit?.();
      return true;
    })()`);
    await sleep(250);
    return { ok: true };
  }
  if (act === "type" || act === "fill" || act === "input") {
    const selector = JSON.stringify(action.selector || "input,textarea,[contenteditable='true']");
    const value = JSON.stringify(action.value || action.text || "");
    const result = await webviewEval(`(() => {
      const sel = ${selector};
      let el = null;
      try { el = document.querySelector(sel); } catch (e) {}
      if (!el) {
        el = document.querySelector("input:not([type=hidden]), textarea, [contenteditable='true']");
      }
      if (!el) return { ok: false, error: "input yok" };
      el.focus();
      const val = ${value};
      if (el.isContentEditable) el.textContent = val;
      else {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { ok: true };
    })()`);
    await sleep(200);
    return result || { ok: true };
  }
  if (act === "click" || act === "tap") {
    const selector = JSON.stringify(action.selector || "");
    const text = JSON.stringify(action.text || "");
    const x = Number.isFinite(action.x) ? action.x : null;
    const y = Number.isFinite(action.y) ? action.y : null;
    const result = await webviewEval(`(() => {
      const wantSel = ${selector};
      const wantText = ${text};
      const cx = ${x === null ? "null" : x};
      const cy = ${y === null ? "null" : y};
      const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const isVisible = (el) => {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      if (cx != null && cy != null) {
        const el = document.elementFromPoint(cx, cy);
        if (el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: cx, clientY: cy, view: window })); return { ok: true, via: "xy" }; }
      }
      if (wantSel) {
        try {
          const el = document.querySelector(wantSel);
          if (el && isVisible(el)) {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            el.click();
            return { ok: true, via: "selector", text: clean(el.innerText).slice(0, 80) };
          }
        } catch (e) {}
      }
      if (wantText) {
        const needle = clean(wantText).toLowerCase();
        const nodes = [...document.querySelectorAll("a,button,[role='button'],[role='link'],[role='tab'],input[type='submit'],input[type='button'],label,span,div,td,li,h1,h2,h3")];
        // exact then contains; prefer shorter nodes
        let candidates = nodes.filter((el) => isVisible(el) && clean(el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase() === needle);
        if (!candidates.length) {
          candidates = nodes
            .filter((el) => isVisible(el) && clean(el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase().includes(needle))
            .sort((a, b) => clean(a.innerText).length - clean(b.innerText).length);
        }
        const el = candidates[0];
        if (el) {
          el.scrollIntoView({ block: "center", inline: "nearest" });
          el.click();
          return { ok: true, via: "text", text: clean(el.innerText).slice(0, 80) };
        }
      }
      return { ok: false, error: "hedef bulunamadı" };
    })()`);
    await sleep(400);
    await waitWebviewSettled(8000);
    return result || { ok: false };
  }
  if (act === "read" || act === "snapshot") {
    const snap = await captureBrowserSnapshot({ maxChars: 12000, attempts: 3 });
    return { ok: true, snap };
  }
  return { ok: false, error: `bilinmeyen eylem: ${act}` };
}

function buildBrowserControlPrompt({ userTask, snap, loop, lastActions, lastResults }) {
  const snapBlock = formatBrowserSnapshotForPrompt(snap);
  const historyBlock = lastActions?.length
    ? `\nÖnceki sandboxed adımlar:\n${lastActions.map((a, i) => `  ${i + 1}. ${JSON.stringify(a)} → ${JSON.stringify(lastResults[i] || {})}`).join("\n")}\n`
    : "";
  return `[TaxCLI DENEYSEL TARAYICI — sen kontrol ediyorsun]
Sağ paneldeki webview senin sandbox tarayıcın. Kendin gez, tıkla, yaz. "Göremiyorum" deme; sayfa metni ve alan adları aşağıda.
Tur: ${loop}

KULLANICI İSTEĞİ:
${userTask}

NASIL KONTROL EDERSİN (zorunlu protokol):
Her adımı ayrı satırda yaz:
BROWSER_ACTION: {"action":"goto","url":"https://..."}
BROWSER_ACTION: {"action":"click","text":"miyotu.com"}
BROWSER_ACTION: {"action":"click","selector":"a[href*='dns']"}
BROWSER_ACTION: {"action":"type","selector":"input[type=search]","value":"..."}
BROWSER_ACTION: {"action":"press","key":"Enter"}
BROWSER_ACTION: {"action":"scroll","amount":700}
BROWSER_ACTION: {"action":"wait","ms":1200}
BROWSER_ACTION: {"action":"back"}
BROWSER_ACTION: {"action":"done"}

Kurallar:
1) Bu turda SAYFAYI GÖRMEK / DEĞİŞTİRMEK için 1–6 BROWSER_ACTION yaz. TaxCLI uygular, sonra yeni snapshot ile devam edersin.
2) DNS, ayar, domain listesi vb. için önce doğru yerdeki metne tıkla (ör. domain adı, "DNS", "Records").
3) Veri yeterliyse kısa yanıt yaz + BROWSER_ACTION: {"action":"done"}
4) Cloudflare zaten açıksa google'a gitme.
5) Kod bloğu da kullanabilirsin: \`\`\`browser ... \`\`\`
${historyBlock}${snapBlock}`;
}

async function startAgentAndWait({
  prompt,
  routingPrompt = prompt,
  agentId = selectedAgentId,
  runTarget = null,
  projectPath,
  history = [],
  images = [],
  browserLoop = false,
  promptForStats = "",
  container = null,
  conversationId = activeConversationId(projectPath)
}) {
  const target = container || activeAssistant;
  if (!target) throw new Error("Asistan kutusu yok");
  const targetEngine = runTarget?.engineId || activeEngine;
  const result = await window.agentHub.startAgent({
    engineId: targetEngine,
    agentId,
    routingPrompt,
    prompt,
    history,
    images,
    projectPath,
    conversationId,
    model: runTarget?.model ?? modelByEngine[targetEngine] ?? "",
    approvalMode,
    effort: runTarget?.effort || selectedEffortFor(runTarget?.model ?? modelByEngine[targetEngine] ?? "", targetEngine, agentId),
    routingPolicy: runTarget?.appliedPolicy || "balanced",
    experimentalEffort: Boolean(userSettings.experimentalEffort),
    autoSnapshot: Boolean(userSettings.autoSnapshot),
    useWorktrees: Boolean(userSettings.useWorktrees),
    worktreeBase: userSettings.worktreeBase || "main",
    browserSession: true,
    browserUrl: browserUrlForModel(getBrowserCurrentUrl()),
    rules: userSettings.rulesText || "",
    skillsPaths: userSettings.skillsPaths || "",
    allowShell: userSettings.allowShell !== false,
    allowMcp: Boolean(userSettings.allowMcp),
    mcpConfig: userSettings.mcpConfig || "",
    useMemory: userSettings.useMemory !== false,
    indexIgnore: userSettings.indexIgnore !== false,
    debugStream: Boolean(userSettings.debugStream)
  });
  activeRun = result.runId;
  target.dataset.runId = result.runId;
  target.dataset.recordId = result.runId;
  projectRuns.set(projectKey(projectPath, conversationId), result.runId);
  const waitPromise = new Promise((resolve) => {
    runMeta.set(result.runId, {
      projectPath,
      conversationId,
      status: "Tarayıcı ajanı…",
      promptForStats,
      browserLoop: Boolean(browserLoop),
      waitResolve: resolve
    });
  });
  if (result.visionNote && userSettings.visionWarnings !== false) toast(result.visionNote, "error");
  renderProjects();
  return waitPromise;
}

async function runBrowserControlledSession({
  typedPrompt,
  agentResolution,
  runTarget,
  projectPath,
  history,
  outgoingImages,
  promptForStats,
  conversationId = activeConversationId(projectPath)
}) {
  const browserConsent = await askUserConfirmation({
    title: "Sayfa içeriği AI sağlayıcısına gönderilsin mi?",
    message: "Tarayıcı modu, açık sayfanın görünür metnini seçili AI sağlayıcısına görev bağlamı olarak gönderir.",
    note: "URL sorguları ve bilinen anahtar/token biçimleri otomatik temizlenir. Yine de kişisel veya gizli veri içeren sayfalarda devam etmeyin.",
    confirmLabel: "Tarayıcı modunu başlat",
    eyebrow: "VERİ PAYLAŞIMI",
    icon: "fa-solid fa-shield-halved"
  });
  if (!browserConsent) {
    toast("Tarayıcı modu başlatılmadı.", "error");
    return;
  }
  openBrowserPane(null, { navigate: "auto" });
  const extracted = extractBrowserTarget(typedPrompt);
  if (extracted) {
    openBrowserPane(extracted, { navigate: "force" });
    await waitWebviewSettled(10000);
    await sleep(600);
  }

  activeAssistant = addMessage("assistant", "", agentResolution?.resolvedId || "analyst", runTarget?.engineId || activeEngine);
  appendThoughtStep(activeAssistant, `${runTarget?.summary || "Auto"} · Sandbox tarayıcı hazırlanıyor…`);
  setRunning(true, "Tarayıcı sandbox…");

  let loop = 0;
  const maxLoops = 8;
  let lastActions = [];
  let lastResults = [];
  let finalText = "";
  const container = activeAssistant;

  try {
    while (loop < maxLoops) {
      loop += 1;
      if (!isRunning && !activeRun) break;

      $("#runStatus").textContent = `Tarayıcı okuma · tur ${loop}`;
      const snap = await captureBrowserSnapshot({ maxChars: 14000, attempts: 4 });
      if (snap.hostnames?.length) {
        toast(`Tarayıcı · ${snap.hostnames.slice(0, 3).join(", ")}`);
      }
      appendThoughtStep(container, `Tur ${loop}: sayfa okundu${snap.hostnames?.length ? ` (${snap.hostnames.length} alan)` : ""}`);

      const controlPrompt = buildBrowserControlPrompt({
        userTask: typedPrompt,
        snap,
        loop,
        lastActions,
        lastResults
      });
      let fullPrompt = controlPrompt;
      if (userSettings.rulesText?.trim()) fullPrompt = `${userSettings.rulesText.trim()}\n\n${fullPrompt}`;

      if (loop > 1) {
        // Fresh model answer each control turn (keep tool chips / thoughts)
        const p = ensureAssistantParts(container);
        p.response.dataset.rawText = "";
        p.response.innerHTML = "";
      }

      const outcome = await startAgentAndWait({
        prompt: fullPrompt,
        routingPrompt: typedPrompt,
        agentId: agentResolution?.requestedId || selectedAgentId,
        runTarget,
        projectPath,
        history: loop === 1 ? history : [],
        images: loop === 1 ? outgoingImages.map((image) => image.path) : [],
        browserLoop: true,
        promptForStats: loop === 1 ? promptForStats : "",
        container,
        conversationId
      });

      if (outcome?.stopped || !isRunning) {
        finalText = stripBrowserActionMarkup(outcome?.text || finalText || "");
        break;
      }

      const rawReply = String(outcome?.text || "");
      let actions = parseBrowserActions(rawReply);
      const spoken = stripBrowserActionMarkup(rawReply);
      if (spoken) {
        const prevKept = loop === 1 ? "" : String(ensureAssistantParts(container).response.dataset.rawText || "").trim();
        // Prefer latest spoken; keep brief prior summary
        const merged = prevKept && spoken && !prevKept.includes(spoken)
          ? `${stripBrowserActionMarkup(prevKept)}\n\n${spoken}`
          : (spoken || prevKept);
        setRichText(ensureAssistantParts(container).response, stripBrowserActionMarkup(merged));
        finalText = spoken;
      }

      // Weak free models often forget the protocol — auto drive for common intents
      if (!actions.length && loop <= 3) {
        const auto = buildAutoBrowserActions(typedPrompt, snap);
        if (auto.length) {
          actions = auto;
          appendThoughtStep(container, `Otomatik tarayıcı adımları (${auto.length})`);
          addToolChip(container, "browser", "auto-drive");
        }
      }

      if (!actions.length) {
        finalText = spoken || rawReply || finalText;
        break;
      }

      lastActions = actions;
      lastResults = [];
      let done = false;
      for (const action of actions) {
        if (String(action.action).toLowerCase() === "done") {
          done = true;
          lastResults.push({ ok: true, done: true });
          continue;
        }
        try {
          const res = await executeBrowserAction(action, { container });
          lastResults.push(res || { ok: true });
          if (res?.done) done = true;
        } catch (error) {
          lastResults.push({ ok: false, error: error.message });
          addEventRow(container, `Tarayıcı hata: ${error.message}`, true);
        }
      }

      if (done) break;
      // brief pause before next model call
      await sleep(400);
    }

    if (finalText) {
      const parts = ensureAssistantParts(container);
      // ensure final clean answer (without action markup)
      const cleaned = stripBrowserActionMarkup(finalText);
      if (cleaned) setRichText(parts.response, cleaned);
    } else {
      const snap = await captureBrowserSnapshot({ maxChars: 8000, attempts: 2 });
      const fallback = snap.hostnames?.length
        ? `Sandbox tarayıcıda görünen alan adları: ${snap.hostnames.join(", ")}.\nURL: ${snap.url}`
        : `Sandbox tarayıcı URL: ${snap.url || getBrowserCurrentUrl() || "—"}`;
      setRichText(ensureAssistantParts(container).response, fallback);
    }

    finishThinking(container, "Tarayıcı kontrolü bitti");
    recordUsageRun(promptForStats, finalText || "", { engineId: runTarget.engineId, model: runTarget.model || "auto", startedAt: new Date(Date.now() - 1).toISOString(), projectPath });
    const historyRoot = parkedConversations.get(projectKey(projectPath, conversationId)) || $("#conversation");
    saveHistory(historyRoot, projectPath, conversationId);
    projectRuns.delete(projectKey(projectPath, conversationId));
    notifyAgentDone(true);
  } catch (error) {
    const parts = ensureAssistantParts(container);
    setRichText(parts.response, error.message);
    finishThinking(container, "Hata");
    toast(error.message, "error");
  } finally {
    setRunning(false);
    activeRun = null;
    activeAssistant = null;
    renderProjects();
    renderConversations();
  }
}

function applyTheme(theme = userSettings.theme) {
  if (theme === "zinc") theme = "dark";
  if (!["dark", "midnight", "brand", "light", "system"].includes(theme)) theme = "dark";
  document.body.classList.remove("theme-light", "theme-dark", "theme-brand", "theme-zinc", "theme-midnight");
  let resolved = theme;
  if (theme === "system") {
    resolved = window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
  }
  if (resolved === "light") {
    document.body.classList.add("theme-light");
  } else if (resolved === "dark") {
    document.body.classList.add("theme-zinc", "theme-dark");
  } else if (resolved === "midnight") {
    document.body.classList.add("theme-midnight", "theme-dark");
  } else {
    document.body.classList.add("theme-brand", "theme-dark");
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-resolved-theme", resolved);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = resolved === "light" ? "light" : "dark";
  $$(".theme-card").forEach((card) => card.classList.toggle("selected", card.dataset.theme === theme));
  const hidden = $("#settingsTheme");
  if (hidden) hidden.value = theme;
}

function playCompletionSound() {
  if (!userSettings.completionSound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 140);
  } catch { /* ignore */ }
}

function notifyAgentDone(ok = true) {
  playCompletionSound();
  pushNotification({ type: ok ? "success" : "error", title: ok ? "Görev tamamlandı" : "Görev hata verdi", message: ok ? "Ajan çıktısı çalışma alanında hazır." : "Ayrıntılar için aktif sohbeti aç.", dedupeKey: ok ? "" : "agent-failed" });
  if (!userSettings.systemNotifications) return;
  try {
    if (window.Notification?.permission === "granted") {
      new Notification(ok ? "Ajan tamamlandı" : "Ajan hata verdi", { body: "TaxCLI çalışma alanına bak." });
    } else if (window.Notification?.permission !== "denied") {
      Notification.requestPermission();
    }
  } catch { /* ignore */ }
}

function renderEffortDropdown() {
  const levels = effortLevelsForModel(modelByEngine[activeEngine] || "", activeEngine);
  if (!levels.includes(effortLevel)) {
    effortLevel = levels.includes("medium") ? "medium" : levels[0];
    localStorage.setItem("agenthub:effort", effortLevel);
  }
  const list = $("#effortList");
  if (!list) return;
  const titles = { low: "Düşük", medium: "Orta", high: "Yüksek", xhigh: "Çok yüksek", ultra: "Ultra", max: "Maks" };
  list.innerHTML = [
    `<button type="button" role="menuitemradio" aria-checked="${effortMode === "auto"}" data-effort="auto" class="${effortMode === "auto" ? "selected" : ""}"><i class="fa-solid fa-wand-magic-sparkles"></i><span><strong>Auto</strong><small>Türe göre</small></span></button>`,
    ...levels.map((level) => `<button type="button" role="menuitemradio" aria-checked="${effortMode === "manual" && effortLevel === level}" data-effort="${level}" class="${effortMode === "manual" && effortLevel === level ? "selected" : ""}"><i class="fa-solid ${effortMode === "manual" && effortLevel === level ? "fa-check" : "fa-gauge"}"></i><span><strong>${titles[level] || level}</strong><small>${level}</small></span></button>`)
  ].join("");
  $$("[data-effort]").forEach((button) => button.addEventListener("click", () => {
    const selected = button.dataset.effort;
    effortMode = selected === "auto" ? "auto" : "manual";
    if (effortMode === "manual") effortLevel = selected;
    localStorage.setItem("agenthub:effort-mode", effortMode);
    localStorage.setItem("agenthub:effort", effortLevel);
    renderEffortDropdown();
    closeRunTuningMenu();
  }));
  const hint = $("#effortModeHint");
  if (hint) hint.textContent = effortMode === "auto"
    ? `${modelRouter.byId[routingPolicy]?.name || "Dengeli"} türü göreve göre seçer`
    : "Seçtiğin değer doğrudan modele gönderilir";
  updateRunTuningButton();
}

function updateRunTuningButton() {
  const btn = $("#runTuningButton");
  if (!btn) return;
  const policy = modelRouter.byId[routingPolicy] || modelRouter.byId.balanced;
  const titles = { low: "Düşük", medium: "Orta", high: "Yüksek", xhigh: "Çok yüksek", ultra: "Ultra", max: "Maks" };
  const label = $("#runTuningLabel");
  const icon = $("#runTuningIcon");
  const profile = agentRegistry.byId[selectedAgentId] || agentRegistry.byId.auto;
  const effort = effortMode === "auto" ? "Auto" : titles[effortLevel] || effortLevel;
  if (label) label.textContent = `${profile.shortName} · ${policy.shortName} · ${effort}`;
  if (icon) icon.className = "fa-solid fa-sliders";
  if ($("#tuningTypeLabel")) $("#tuningTypeLabel").textContent = policy.name;
  if ($("#tuningEffortLabel")) $("#tuningEffortLabel").textContent = effort;
  btn.title = effortMode === "auto"
    ? `${policy.name}: model ve düşünme eforu göreve göre ayarlanır.`
    : `${policy.name}: düşünme eforu ${titles[effortLevel] || effortLevel}.`;
  btn.dataset.agentColor = `policy-${policy.id}`;
}

function closeRunTuningMenu(restoreFocus = false) {
  $("#runTuningDropdown")?.classList.remove("open");
  $("#runTuningButton")?.setAttribute("aria-expanded", "false");
  $$("[data-tuning-item]").forEach((item) => {
    item.classList.remove("submenu-open");
    item.querySelector("[data-tuning-menu]")?.setAttribute("aria-expanded", "false");
  });
  if (restoreFocus) $("#runTuningButton")?.focus();
}

function positionRunTuningMenus() {
  const menu = $("#runTuningDropdown"), button = $("#runTuningButton");
  if (!menu?.classList.contains("open") || !button) return;
  const trigger = button.getBoundingClientRect();
  const subWidth = parseFloat(getComputedStyle(menu.querySelector(".tuning-submenu")).width) || 270;
  const left = Math.max(12, Math.min(trigger.left, window.innerWidth - menu.offsetWidth - subWidth - 12));
  const top = Math.max(12, Math.min(trigger.top - menu.offsetHeight - 8, window.innerHeight - menu.offsetHeight - 12));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const bounds = menu.getBoundingClientRect();
  $$(".submenu-open > .tuning-submenu").forEach((submenu) => {
    const row = submenu.parentElement.getBoundingClientRect();
    submenu.style.left = `${bounds.right - 1}px`;
    submenu.style.top = `${Math.max(12, Math.min(row.top - 5, window.innerHeight - submenu.offsetHeight - 12))}px`;
  });
}

function showRunTuningSubmenu(key, focusFirst = false) {
  if (!$("#runTuningDropdown")?.classList.contains("open")) return;
  $$("[data-tuning-item]").forEach((item) => {
    const active = item.dataset.tuningItem === key;
    item.classList.toggle("submenu-open", active);
    item.querySelector("[data-tuning-menu]")?.setAttribute("aria-expanded", String(active));
    if (active && focusFirst) item.querySelector(".tuning-submenu button:not(:disabled)")?.focus();
  });
  positionRunTuningMenus();
}

function openRunTuningMenu() {
  closeRunTuningMenu();
  $$(".popup-menu").forEach((menu) => menu.classList.remove("open"));
  syncToolMenuButton();
  $("#modelDropdown")?.classList.remove("open");
  renderAgentSelector();
  renderRoutingPolicySelector();
  renderEffortDropdown();
  $("#runTuningDropdown")?.classList.add("open");
  $("#runTuningButton")?.setAttribute("aria-expanded", "true");
  positionRunTuningMenus();
}

function rotateTip() {
  const tip = $("#heroTip");
  if (!tip || !userSettings.tips) return;
  tip.textContent = tips[tipIndex % tips.length];
  tipIndex += 1;
}

function setField(id, value, isCheckbox = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isCheckbox) el.checked = Boolean(value);
  else el.value = value ?? "";
}

function showSettingsSection(section = "general") {
  const id = String(section || "general").trim() || "general";
  $$("[data-settings-section]").forEach((item) => {
    item.classList.toggle("active", item.dataset.settingsSection === id);
  });
  let found = false;
  $$("[data-settings-panel]").forEach((panel) => {
    const ids = String(panel.dataset.settingsPanel || "").split(/\s+/).filter(Boolean);
    const on = ids.includes(id);
    panel.classList.toggle("active", on);
    if (on) found = true;
  });
  if (!found) {
    const general = document.querySelector('[data-settings-panel="general"]');
    if (general) general.classList.add("active");
  }
  const content = $(".settings-content");
  if (content) content.scrollTop = 0;
  if (id === "mobile") refreshMobileAccessStatus();
  if (id === "usage") refreshProviderUsage();
  if (id === "recovery") refreshSnapshots();
  if (id === "queue") refreshTaskQueue();
  if (id === "git-center") refreshGitCenter();
  if (id === "security") refreshSecurityCenter().catch((error) => toast(`Güvenlik merkezi açılamadı: ${error.message}`, "error"));
  if (id === "plugins") renderMcpMarketplace();
}

function showView(view) {
  comparisonProgress.sync();
  closeRunTuningMenu();
  if (view === "userSettings") toggleNotificationDrawer(false);
  $$(".view").forEach((el) => el.classList.remove("active"));
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  const target = $(`#${view}View`);
  if (target) target.classList.add("active");
  document.body.classList.toggle("settings-mode", view === "userSettings");
  if (view === "userSettings") {
    const current = $(".settings-nav button.active")?.dataset?.settingsSection || "general";
    showSettingsSection(current);
    // Force layout paint — content column must not stay empty after DOM show
    requestAnimationFrame(() => {
      showSettingsSection($(".settings-nav button.active")?.dataset?.settingsSection || "general");
      const content = $(".settings-content");
      const activePanel = $(".settings-panel.active");
      if (content && activePanel && activePanel.offsetHeight < 8) activePanel.classList.add("force-visible");
    });
    refreshUsageUi();
    renderSettingsPlugins();
  }
  if (view === "office") {
    renderOfficeHub();
    if (!detected.length) detectEngines(true).then(renderOfficeHub).catch(() => {});
  }
  if (view === "workbench") window.TaxCliWorkbench?.refresh().catch((error) => toast(error.message, "error"));
}

function renderSettingsPlugins() {
  const host = $("#settingsPluginsList");
  if (!host) return;
  host.innerHTML = plugins.map((plugin) => {
    const on = connectedPlugins.has(plugin.id);
    const badge = on ? "Bağlı" : plugin.ready ? "Hazır" : "Yakında";
    return `<div class="plugin-settings-item">
      <span class="psi-icon"><i class="${plugin.icon}"></i></span>
      <span><strong>${escapeHtml(plugin.name)}</strong><small>${escapeHtml(plugin.description)}</small></span>
      <span class="badge ${on ? "on" : ""}">${badge}</span>
    </div>`;
  }).join("");
}

function nowLabel() {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function markdownToHtml(value) {
  const source = normalizeStoredContent(value).replace(/\r\n/g, "\n");
  if (!source) return "";
  const blocks = source.split(/(```[\s\S]*?```)/g);
  return blocks.map((block) => {
    if (block.startsWith("```")) {
      const match = block.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
      const language = escapeHtml((match?.[1] || "kod").trim() || "kod");
      const code = (match?.[2] ?? "").replace(/\n$/, "");
      return `<div class="code-block"><div class="code-label">${language}</div><pre><code>${escapeHtml(code)}</code></pre></div>`;
    }
    let html = escapeHtml(block);
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>").replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code class=\"inline-code\">$1</code>");
    html = html.replace(/^(?:- |\* |• )(.+)$/gm, "<div class=\"md-list-item\"><span>•</span><span>$1</span></div>");
    return html.replace(/\n/g, "<br>");
  }).join("");
}

function normalizeStoredContent(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/^•\s*$/gm, "")
    .replace(/^•\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function baseProjectKey(projectPath = $("#projectPath").value) {
  return String(projectPath || "").trim() || "__none__";
}

function mobileContext() {
  const project = projects.find((item) => item.id === selectedProjectId);
  const engine = engines.find((item) => item.id === activeEngine);
  const agent = agentRegistry.byId[agentRegistry.normalizeAgentId(selectedAgentId)];
  return {
    projectName: project?.name || "",
    projectId: project?.id || "",
    engineId: activeEngine,
    model: modelByEngine[activeEngine] === "__auto__" ? "" : modelByEngine[activeEngine] || "",
    approvalMode,
    engineName: engine?.name || activeEngine,
    agentName: agent?.name || "Otomatik"
  };
}

let mobilePairExpiryTimer = null;

function renderMobileAccess(status = {}, { showPairing = false } = {}) {
  const running = Boolean(status.running);
  const sessionCount = Number(status.sessionCount) || 0;
  const title = $("#mobileAccessTitle");
  const detail = $("#mobileAccessStatus");
  const dot = $("#mobileAccessDot");
  const pairing = $("#mobilePairing");
  if (!title || !detail || !pairing) return;
  title.textContent = running ? "Mobil köprü açık" : "Mobil köprü kapalı";
  detail.textContent = running
    ? `${status.baseUrl || "Yerel ağ"} · HTTPS · ${sessionCount} eşleşmiş cihaz`
    : "Başlattığında yalnızca aynı yerel ağdaki cihazlar bağlanabilir.";
  dot?.classList.toggle("online", running);
  $("#startMobileAccess").hidden = running;
  $("#refreshMobileQr").hidden = !running;
  $("#revokeMobileSessions").hidden = !running || !sessionCount;
  $("#stopMobileAccess").hidden = !running;
  pairing.hidden = !(running && showPairing && status.qrDataUrl);
  if (!pairing.hidden) {
    $("#mobileQrImage").src = status.qrDataUrl;
    $("#mobilePairUrl").textContent = status.pairUrl || "";
    $("#mobileTlsFingerprint").textContent = status.tlsFingerprint ? `SHA-256: ${status.tlsFingerprint}` : "";
    clearInterval(mobilePairExpiryTimer);
    const updateExpiry = () => {
      const seconds = Math.max(0, Math.ceil((Number(status.expiresAt) - Date.now()) / 1000));
      $("#mobilePairExpiry").textContent = seconds ? `QR kodu ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} sonra yenilemeniz gerekir.` : "QR kodunun süresi doldu; yenisini oluşturun.";
      if (!seconds) clearInterval(mobilePairExpiryTimer);
    };
    updateExpiry();
    mobilePairExpiryTimer = setInterval(updateExpiry, 1000);
  }
}

async function refreshMobileAccessStatus() {
  try {
    const status = await window.agentHub.getMobileStatus();
    renderMobileAccess(status);
    if (status.running) window.agentHub.updateMobileContext(mobileContext()).catch(() => {});
  } catch (error) {
    renderMobileAccess({ running: false });
    toast(`Mobil erişim durumu alınamadı: ${error.message}`, "error");
  }
}

async function createMobilePairing() {
  const button = $("#startMobileAccess");
  const refresh = $("#refreshMobileQr");
  if (button) button.disabled = true;
  if (refresh) refresh.disabled = true;
  try {
    const status = await window.agentHub.startMobileAccess(mobileContext());
    renderMobileAccess(status, { showPairing: true });
    toast("Mobil bağlantı hazır. QR kodu telefonunla okut.");
  } catch (error) {
    toast(`Mobil erişim başlatılamadı: ${error.message}`, "error");
  } finally {
    if (button) button.disabled = false;
    if (refresh) refresh.disabled = false;
  }
}

function activeConversationId(projectPath = $("#projectPath").value) {
  return activeConversationByProject.get(baseProjectKey(projectPath)) || "main";
}

function projectKey(projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath)) {
  return `${baseProjectKey(projectPath)}::${conversationId || "main"}`;
}

const richTextRenderTimers = new WeakMap();
const richTextRenderedValues = new WeakMap();

function renderRichTextNow(container) {
  const value = String(container?.dataset?.rawText || "");
  if (!container || richTextRenderedValues.get(container) === value) return;
  container.innerHTML = markdownToHtml(value);
  richTextRenderedValues.set(container, value);
}

function setRichText(container, text) {
  const pending = richTextRenderTimers.get(container);
  if (pending) clearTimeout(pending);
  richTextRenderTimers.delete(container);
  container.dataset.rawText = String(text || "");
  renderRichTextNow(container);
}

function appendRichText(container, text) {
  container.dataset.rawText = `${container.dataset.rawText || ""}${text || ""}`;
  if (richTextRenderTimers.has(container)) return;
  // Several office agents can stream at once. Rebuilding markdown for every token
  // blocks the renderer, especially while a large worker card is expanded.
  const compactWorker = Boolean(container.closest?.(".office-worker-card.compact"));
  const timer = setTimeout(() => {
    richTextRenderTimers.delete(container);
    renderRichTextNow(container);
  }, compactWorker ? 120 : 32);
  richTextRenderTimers.set(container, timer);
}

function responseRawText(content) {
  if (!content) return "";
  const body = content.classList?.contains("assistant-stream") ? content.querySelector(".response-body") : content;
  if (!body) return "";
  if (body.dataset.rawText != null && body.dataset.rawText !== "") return body.dataset.rawText;
  const clone = body.cloneNode(true);
  clone.querySelectorAll(".md-list-item").forEach((item) => {
    const text = [...item.querySelectorAll("span")].map((span) => span.textContent.trim()).filter((part) => part && part !== "•").join(" ");
    item.replaceWith(document.createTextNode(`- ${text}\n`));
  });
  clone.querySelectorAll("br").forEach((br) => br.replaceWith(document.createTextNode("\n")));
  clone.querySelectorAll("h1,h2,h3").forEach((heading) => {
    const level = Number(heading.tagName[1]);
    heading.replaceWith(document.createTextNode(`${"#".repeat(level)} ${heading.textContent.trim()}\n`));
  });
  clone.querySelectorAll(".code-block").forEach((block) => {
    const language = block.querySelector(".code-label")?.textContent?.trim() || "";
    const code = block.querySelector("code")?.textContent || "";
    block.replaceWith(document.createTextNode(`\`\`\`${language}\n${code}\n\`\`\`\n`));
  });
  return clone.innerText.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function messagePlainText(content) {
  if (!content) return "";
  if (content.classList.contains("assistant-stream")) {
    const thoughts = [...content.querySelectorAll(".thought-step .thought-body")].map((el) => el.innerText.trim()).filter(Boolean).join("\n");
    const response = responseRawText(content);
    const files = [...(streamState.get(content)?.files?.values() || [])].map((file) => file.path).join(", ");
    return [thoughts && `Düşünce:\n${thoughts}`, response, files && `Dosyalar: ${files}`].filter(Boolean).join("\n\n");
  }
  return responseRawText(content) || content.innerText || "";
}

function hydrateStoredMessage(message) {
  const activity = Array.isArray(message.activity) ? [...message.activity] : [];
  let content = String(message.content || "");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    const toolMatch = trimmed.match(/^([A-Za-zİıĞğÜüŞşÖöÇç0-9_\-./]+)\s+kullanılıyor(?:\.{1,3}|…)?$/i);
    if (toolMatch) {
      const name = toolMatch[1];
      if (!activity.some((item) => item.type === "tool" && String(item.name).toLowerCase() === name.toLowerCase())) {
        activity.push({ type: "tool", name, detail: "" });
      }
      return;
    }
    if (/^Dosyalar:\s*/i.test(trimmed)) {
      const names = trimmed.replace(/^Dosyalar:\s*/i, "").split(",").map((part) => part.trim()).filter(Boolean);
      names.forEach((pathName) => {
        if (!activity.some((item) => item.type === "file" && item.path === pathName)) {
          activity.push({ type: "file", path: pathName, added: 0, removed: 0, diff: "" });
        }
      });
      return;
    }
    if (/^Düşünce:\s*$/i.test(trimmed)) return;
    kept.push(line);
  });
  return {
    role: message.role === "user" ? "user" : "assistant",
    engineId: String(message.engineId || ""),
    agentId: message.agentId ? agentRegistry.normalizeAgentId(message.agentId) : "",
    recordId: String(message.recordId || ""),
    comparisonVariantId: String(message.comparisonVariantId || ""),
    comparisonLabel: String(message.comparisonLabel || ""),
    content: normalizeStoredContent(kept.join("\n")),
    activity
  };
}

function ensureAssistantParts(container) {
  if (!container.classList.contains("assistant-stream")) {
    container.classList.add("assistant-stream");
    container.innerHTML = `
      <div class="activity-feed"></div>
      <div class="thinking-block status-only" hidden><div class="thinking-label"><i class="fa-solid fa-brain"></i><span>Düşünüyor…</span></div></div>
      <div class="response-body"></div>
      <div class="changes-summary" hidden></div>`;
  }
  if (!streamState.has(container)) {
    streamState.set(container, { files: new Map(), thoughtCount: 0, collapsed: false, thoughtLog: [] });
  }
  const state = streamState.get(container);
  if (!Array.isArray(state.thoughtLog)) state.thoughtLog = [];
  return {
    feed: container.querySelector(".activity-feed"),
    status: container.querySelector(".thinking-block.status-only"),
    statusLabel: container.querySelector(".thinking-block.status-only .thinking-label span"),
    response: container.querySelector(".response-body"),
    summary: container.querySelector(".changes-summary"),
    state
  };
}

function messagePlainText(content) {
  if (!content) return "";
  if (content.classList.contains("assistant-stream")) {
    const thoughts = [...content.querySelectorAll(".thought-step .thought-body")].map((el) => el.innerText.trim()).filter(Boolean).join("\n");
    const response = responseRawText(content);
    const files = [...(streamState.get(content)?.files?.values() || [])].map((file) => file.path).join(", ");
    return [thoughts && `Düşünce:\n${thoughts}`, response, files && `Dosyalar: ${files}`].filter(Boolean).join("\n\n");
  }
  return responseRawText(content) || content.innerText || "";
}

function fileLanguage(filePath) {
  const ext = String(filePath || "").split(".").pop()?.toLowerCase() || "";
  return ({ js: "js", cjs: "js", mjs: "js", ts: "ts", tsx: "tsx", jsx: "jsx", css: "css", html: "html", json: "json", md: "md", py: "py", rs: "rs", go: "go", java: "java" })[ext] || ext || "kod";
}

function shortPath(filePath) {
  const parts = String(filePath || "").replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return parts.join("/");
  return `${parts.slice(0, 1).join("/")}/…/${parts.slice(-2).join("/")}`;
}

function countDiffStats(diffText) {
  let added = 0;
  let removed = 0;
  String(diffText || "").split(/\r?\n/).forEach((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  });
  return { added, removed };
}

function renderDiffHtml(diffText, limit = 40) {
  const lines = String(diffText || "").replace(/\r\n/g, "\n").split("\n");
  const visible = lines.slice(0, limit);
  const html = visible.map((line) => {
    let kind = "ctx";
    if (line.startsWith("+") && !line.startsWith("+++")) kind = "add";
    else if (line.startsWith("-") && !line.startsWith("---")) kind = "del";
    else if (line.startsWith("@@")) kind = "hunk";
    return `<div class="diff-line ${kind}"><code>${escapeHtml(line || " ")}</code></div>`;
  }).join("");
  const more = lines.length > limit ? `<div class="diff-more">+${lines.length - limit} satır daha</div>` : "";
  return `${html}${more}`;
}

function currentThoughtStep(feed) {
  return feed.querySelector(".thought-step.primary") || feed.querySelector(".thought-step[data-open='1']");
}

function setThoughtLabel(step, label, { live = false } = {}) {
  const labelEl = step?.querySelector(".thought-label");
  if (!labelEl || !label) return;
  labelEl.textContent = label;
  labelEl.classList.toggle("live", live);
}

function thoughtHasContent(parts) {
  return Boolean(String(parts?.state?.reasoningText || "").trim() || parts?.state?.thoughtLog?.length);
}

function setLiveStatusRow(container, label) {
  const parts = ensureAssistantParts(container);
  if (parts.state.collapsed) return;
  // Remove empty expandable thought — user doesn't want placeholder body text.
  parts.feed.querySelectorAll(".thought-step.primary[data-empty='1']").forEach((node) => node.remove());
  let row = parts.feed.querySelector(".thought-status-live");
  if (!row) {
    row = document.createElement("div");
    row.className = "thought-status-live";
    row.innerHTML = `<i class="fa-solid fa-brain"></i><span class="thought-label live"></span>`;
    parts.feed.insertBefore(row, parts.feed.firstChild);
  }
  const span = row.querySelector(".thought-label");
  if (span) {
    span.classList.add("live");
    span.textContent = label || "Düşünüyor…";
  }
  parts.status.hidden = true;
}

function clearLiveStatusRow(container) {
  const parts = ensureAssistantParts(container);
  parts.feed.querySelectorAll(".thought-status-live").forEach((node) => node.remove());
}

function ensurePrimaryThought(container, label = "Düşünüyor…") {
  const parts = ensureAssistantParts(container);
  clearLiveStatusRow(container);
  let step = parts.feed.querySelector(".thought-step.primary");
  if (!step) {
    step = document.createElement("details");
    step.className = "thought-step primary open";
    step.dataset.open = "1";
    step.dataset.empty = "1";
    step.open = false;
    step.innerHTML = `<summary class="thought-summary"><i class="fa-solid fa-brain"></i><span class="thought-label live">${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down chev"></i></summary><div class="thought-body" hidden></div>`;
    parts.feed.insertBefore(step, parts.feed.firstChild);
    parts.state.thoughtCount += 1;
  }
  parts.status.hidden = true;
  return step;
}

function renderThoughtBody(step, logLines = [], reasoning = "") {
  const body = step.querySelector(".thought-body");
  if (!body) return false;
  const reasoningText = String(reasoning || "").trim();
  const steps = logLines.map((line) => String(line || "").trim()).filter(Boolean);
  const sections = [];
  if (reasoningText) sections.push(reasoningText);
  if (steps.length) {
    sections.push(reasoningText ? `Adımlar:\n${steps.map((line) => `• ${line}`).join("\n")}` : steps.map((line) => `• ${line}`).join("\n"));
  }
  if (!sections.length) {
    body.textContent = "";
    body.hidden = true;
    step.dataset.empty = "1";
    step.classList.add("thought-empty");
    step.open = false;
    return false;
  }
  body.hidden = false;
  body.textContent = sections.join("\n\n");
  step.dataset.empty = "0";
  step.classList.remove("thought-empty");
  return true;
}

/** Only show expandable thought when real content exists; otherwise a compact status row. */
function appendThoughtStep(container, label, text = "", { append = false } = {}) {
  const parts = ensureAssistantParts(container);
  if (parts.state.collapsed) return;
  const chunk = String(text || "");
  if (chunk.trim()) {
    if (append && parts.state.reasoningText) parts.state.reasoningText += chunk;
    else if (append) parts.state.reasoningText = (parts.state.reasoningText || "") + chunk;
    else parts.state.reasoningText = chunk;
  }
  if (!thoughtHasContent(parts) && !chunk.trim()) {
    setLiveStatusRow(container, label || "Düşünüyor…");
    return;
  }
  const step = ensurePrimaryThought(container, label || "Düşünüyor…");
  setThoughtLabel(step, label || "Düşünüyor…", { live: true });
  const hasBody = renderThoughtBody(step, parts.state.thoughtLog, parts.state.reasoningText || "");
  if (hasBody) {
    step.open = true;
    step.dataset.open = "1";
  } else {
    setLiveStatusRow(container, label || "Düşünüyor…");
    step.remove();
  }
}

function pushThoughtLog(container, line, label = "Çalışıyor…") {
  const parts = ensureAssistantParts(container);
  if (parts.state.collapsed) return;
  const entry = String(line || "").trim();
  if (!entry) return;
  if (parts.state.thoughtLog[parts.state.thoughtLog.length - 1] === entry) return;
  parts.state.thoughtLog.push(entry);
  if (parts.state.thoughtLog.length > 40) parts.state.thoughtLog.shift();
  const step = ensurePrimaryThought(container, label);
  setThoughtLabel(step, label, { live: true });
  renderThoughtBody(step, parts.state.thoughtLog, parts.state.reasoningText || "");
  step.open = false;
  step.dataset.open = "0";
}

function setStatusChip(container, label) {
  const parts = ensureAssistantParts(container);
  if (parts.state.collapsed) return;
  if (!thoughtHasContent(parts)) {
    setLiveStatusRow(container, label || "Düşünüyor…");
    return;
  }
  const step = ensurePrimaryThought(container, label || "Düşünüyor…");
  setThoughtLabel(step, label || "Düşünüyor…", { live: true });
  renderThoughtBody(step, parts.state.thoughtLog, parts.state.reasoningText || "");
}

function isFileMutationTool(name) {
  const normalized = String(name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return /^(write|edit|str_replace|strreplace|search_replace|apply_patch|edit_file|create_file|multiedit|patch)$/.test(normalized);
}

function contentToUnifiedDiff(filePath, content, previous = null) {
  const name = String(filePath || "file").replace(/\\/g, "/");
  const nextLines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
  if (previous == null) {
    return [`--- /dev/null`, `+++ b/${name}`, `@@`, ...nextLines.map((line) => `+${line}`)].join("\n");
  }
  const prevLines = String(previous).replace(/\r\n/g, "\n").split("\n");
  return [
    `--- a/${name}`,
    `+++ b/${name}`,
    `@@`,
    ...prevLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`)
  ].join("\n");
}

function extractMessageText(message) {
  if (!message) return "";
  if (typeof message === "string") return message;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    }).join("");
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

function extractThinkingText(data, item = {}) {
  const part = data.part || item;
  const candidates = [
    data.thinking, data.reasoning, data.thought, data.delta?.thinking, data.delta?.reasoning,
    item.thinking, item.reasoning, part.thinking, part.reasoning,
    typeof part.text === "string" && /reason|think/i.test(String(part.type || data.type || "")) ? part.text : null,
    data.message?.reasoning, data.message?.thinking,
    typeof data.text === "string" && /reason|think/i.test(String(data.type || "")) ? data.text : null
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** Cursor Agent stream-json tool_call → normalized tool / file change. */
function extractCursorToolCall(data) {
  if (data?.type !== "tool_call" || !data.tool_call || typeof data.tool_call !== "object") return null;
  const entries = Object.entries(data.tool_call);
  if (!entries.length) return null;
  const [rawKey, payload] = entries[0];
  const toolName = rawKey.replace(/ToolCall$/i, "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()
    || payload?.name
    || "tool";
  const args = payload?.args || {};
  let path = args.path || args.filePath || args.file_path || payload?.result?.success?.path || "";
  if (typeof args.arguments === "string") {
    try {
      const parsed = JSON.parse(args.arguments);
      path = path || parsed.path || parsed.filePath || "";
    } catch { /* plain */ }
  }
  const done = data.subtype === "completed";
  const fileText = args.fileText ?? args.contents ?? args.content ?? null;
  const isWrite = /write|edit|apply_patch|update/i.test(rawKey) || /write|edit/i.test(toolName);
  const out = {
    tool: toolName === "function" ? (payload?.name || "tool") : toolName,
    toolDetail: path ? shortPath(String(path)) : (args.pattern || args.query || ""),
    status: done
      ? (isWrite && path ? "Dosya güncellendi" : "Araç tamamlandı")
      : (isWrite && path ? "Dosya düzenleniyor…" : "Araç çalışıyor…"),
    toolDone: done
  };
  if (path && (isWrite || fileText != null)) {
    out.fileChange = {
      path: String(path),
      content: typeof fileText === "string" ? fileText : null,
      status: done ? "done" : "editing",
      diff: typeof fileText === "string" ? contentToUnifiedDiff(String(path), fileText) : ""
    };
    if (out.fileChange.diff) {
      const stats = countDiffStats(out.fileChange.diff);
      out.fileChange.added = stats.added;
      out.fileChange.removed = stats.removed;
    }
  }
  return out;
}

function extractFileChange(data, item = {}) {
  const type = String(data.type || item.type || "");
  const part = data.part || item;
  const state = part.state || item.state || {};
  const input = state.input || part.input || item.input || {};
  const nested = Array.isArray(item.changes) ? item.changes[0] : null;
  const toolName = part.tool || item.tool || data.tool_name || data.toolName || item.name || "";

  let path = input.filePath || input.path || input.file || input.file_path
    || item.path || item.file || item.filename || item.file_path || nested?.path
    || data.path || data.file || item.uri
    || state.metadata?.filepath || state.metadata?.filePath || state.title || "";

  // Never treat bare tool names as file paths (e.g. todowrite / write).
  if (path && isFileMutationTool(path) && !/[\\/.]/.test(path)) path = "";

  const diffParts = [];
  if (item.unified_diff || item.diff || item.patch) diffParts.push(item.unified_diff || item.diff || item.patch);
  if (data.diff || data.unified_diff) diffParts.push(data.diff || data.unified_diff);
  if (Array.isArray(item.changes)) {
    item.changes.forEach((change) => {
      if (change?.unified_diff || change?.diff || change?.patch) diffParts.push(change.unified_diff || change.diff || change.patch);
    });
  }

  // OpenCode write/edit: content lives in state.input
  if (!diffParts.length && (input.content != null || input.newString != null || input.new_string != null)) {
    const next = input.content ?? input.newString ?? input.new_string;
    const prev = input.oldString ?? input.old_string ?? null;
    if (path) diffParts.push(contentToUnifiedDiff(path, next, prev));
  }

  const diff = diffParts.filter(Boolean).join("\n");
  const looksLikeFile = isFileMutationTool(toolName)
    || /file|edit|write|patch|apply_patch|update_file/i.test(type)
    || item.type === "file_change"
    || Boolean(path && (diff || input.content != null));
  if (!looksLikeFile && !path) return null;
  if (!path && !diff) return null;
  if (!path && isFileMutationTool(toolName)) return null;
  const stats = countDiffStats(diff);
  return {
    path: path || nested?.path || "unknown",
    diff,
    added: item.additions ?? item.added ?? nested?.additions ?? stats.added,
    removed: item.deletions ?? item.removed ?? nested?.deletions ?? stats.removed,
    status: /completed|done|end/i.test(String(state.status || type)) ? "done" : "editing",
    content: input.content ?? null
  };
}

function summarizeStructuredEvent(data) {
  const item = data.item || data.part || data.payload || {};
  const type = String(data.type || data.event?.type || item.type || "");
  const thinkingText = extractThinkingText(data, item);
  const fileChange = extractFileChange(data, item);
  const toolName = item.tool || data.tool_name || data.toolName || item.name || "";

  // Gemini CLI stream-json: {"type":"message","role":"assistant","content":"...","delta":true}
  if (data.type === "message" || type === "message") {
    const role = data.role || data.message?.role || item.role || "";
    if (role === "user") return {};
    const text = typeof data.content === "string"
      ? data.content
      : (extractMessageText(data.message || data) || (typeof item.content === "string" ? item.content : ""));
    if (!String(text).trim()) {
      return data.status ? { status: String(data.status) } : {};
    }
    // delta:true = streaming fragment; false/absent = full or final segment
    if (data.delta === true || data.partial === true) return { delta: text };
    return { response: text };
  }

  // Cursor Agent stream-json (docs: content is array of { type:"text", text })
  if (data.type === "result") {
    if (data.status === "error" || data.is_error) {
      const msg = data.error?.message || data.error?.type || data.message || data.result || "Ajan hatası";
      return { error: String(msg) };
    }
    const text = typeof data.result === "string"
      ? data.result
      : (typeof data.response === "string" ? data.response : extractMessageText(data.result));
    if (String(text || "").trim()) return { response: text };
    if (data.stats || data.status === "success") return { status: "Tamamlandı" };
    return { status: "Tamamlandı" };
  }
  if (data.type === "assistant") {
    const text = extractMessageText(data.message);
    if (!text) return {};
    // With stream-partial-output: only timestamp_ms + no model_call_id is new text.
    if (Object.prototype.hasOwnProperty.call(data, "timestamp_ms") || Object.prototype.hasOwnProperty.call(data, "model_call_id")) {
      if (data.timestamp_ms != null && data.model_call_id == null) return { delta: text };
      return {};
    }
    // Default stream-json: one complete assistant segment between tool calls
    return { delta: text };
  }
  if (data.type === "user" || (data.type === "system" && data.subtype === "init") || data.type === "init") {
    return data.model || data.subtype === "init" ? { status: data.model ? `Model: ${data.model}` : "Başladı…" } : {};
  }
  const cursorTool = extractCursorToolCall(data);
  if (cursorTool) return cursorTool;

  // OpenCode: tool_use with write content
  if (data.type === "tool_use" || type === "tool_use" || item.type === "tool") {
    const name = toolName || "tool";
    if (isFileMutationTool(name) && fileChange?.path && fileChange.path !== "unknown") {
      return {
        fileChange,
        tool: name,
        toolDetail: shortPath(fileChange.path),
        status: fileChange.status === "done" ? "Dosya güncellendi" : "Dosya düzenleniyor…"
      };
    }
    const detail = item.state?.input?.filePath || item.state?.input?.path || item.state?.title || item.state?.input?.pattern || item.state?.input?.query || "";
    return {
      tool: name && name !== "tool" ? name : "tool",
      toolDetail: detail ? shortPath(String(detail)) : "",
      status: "Araç çalışıyor…",
      toolDone: /completed|done/i.test(String(item.state?.status || ""))
    };
  }

  if (fileChange && fileChange.path !== "unknown" && (fileChange.diff || /file|patch|edit|write/i.test(type) || item.type === "file_change")) {
    return { fileChange, status: fileChange.status === "done" ? "Dosya güncellendi" : "Dosya düzenleniyor…" };
  }
  if (item.type === "reasoning" || /reason|think/i.test(type) || ["reasoning", "agent_reasoning", "thinking", "thought"].includes(item.type)) {
    if (type.includes("delta") || data.delta != null) return { thinkingDelta: thinkingText || (typeof data.delta === "string" ? data.delta : ""), thoughtLabel: "Düşünüyor…" };
    if (thinkingText) return { thinking: thinkingText, thoughtLabel: "Kısaca düşündü" };
  }
  if (thinkingText && !/message|text/i.test(type) && item.type !== "text") {
    return { thinkingDelta: thinkingText, thoughtLabel: "Düşünüyor…" };
  }
  if (data.type === "item.completed" && item.type === "agent_message") return { response: item.text || "" };
  if (data.type === "item.completed" && (item.type === "reasoning" || item.type === "agent_reasoning")) {
    return { thinking: item.text || item.content || thinkingText || "", thoughtLabel: "Kısaca düşündü" };
  }
  if (data.type === "item.started" && (item.type === "reasoning" || item.type === "agent_reasoning")) {
    return { thinking: thinkingText || "", thoughtLabel: "Düşünüyor…", status: "Düşünüyor…" };
  }
  if (data.type === "item.completed" && item.type === "command_execution") {
    const output = `${item.command || "Komut"}\n${item.aggregated_output || ""}`.trim();
    const maybeDiff = /diff --git|\n\+[^\n]+\n-[^\n]+/.test(output) ? extractFileChange({ diff: item.aggregated_output }, { path: item.command || "komut çıktısı", unified_diff: item.aggregated_output }) : null;
    return maybeDiff ? { fileChange: maybeDiff, event: output } : { event: output };
  }
  if (data.type === "item.started" && item.type === "command_execution") return { event: `Çalıştırılıyor: ${item.command || "komut"}`, status: "Komut çalışıyor…" };
  if (data.type === "item.started" && item.type === "file_change") {
    return { fileChange: { path: item.path || item.file || "dosya", status: "editing" }, status: "Dosya düzenleniyor…" };
  }
  if (data.type === "error" || data.error) {
    let message = data.error?.message || data.message || (typeof data.error === "string" ? data.error : "") || "Ajan hatası";
    // Codex sometimes nests the API JSON string inside message.
    try {
      const nested = JSON.parse(message);
      if (nested?.error?.message) message = nested.error.message;
    } catch {
      /* plain */
    }
    if (/failed to record rollout items: thread .* not found/i.test(message)) return {};
    const rejected = (message.match(/'([^']+)'\s+model is not supported/i) || [])[1];
    if (/not supported when using Codex with a ChatGPT account/i.test(message)) {
      return {
        error: rejected
          ? `'${rejected}' ChatGPT oturumuyla Codex’te desteklenmiyor. Model menüsünden hesabınıza açık başka bir model seçin.`
          : "Seçilen model ChatGPT oturumuyla Codex’te desteklenmiyor. Model menüsünden hesabınıza açık başka bir model seçin."
      };
    }
    return { error: message };
  }

  // OpenCode text parts
  if ((data.type === "text" || item.type === "text") && (item.text || data.text || data.part?.text)) {
    return { delta: item.text || data.text || data.part?.text || "" };
  }
  if (typeof data.delta === "string" && !/reason|think/i.test(type)) return { delta: data.delta };
  if (data.type === "message" && (data.role === "assistant" || data.message?.role === "assistant")) {
    // Handled above for stream-json; keep as safety net for plain shapes.
    const text = typeof data.content === "string" ? data.content : extractMessageText(data.message || data);
    if (!text) return {};
    return data.delta === true || data.delta ? { delta: typeof data.delta === "string" ? data.delta : text } : { response: text };
  }
  if (data.type === "tool_result" || type === "tool.end" || data.type === "tool_call" || type === "tool_call") {
    if (data.type === "tool_call" || type === "tool_call") {
      const name = data.tool_name || data.name || data.tool?.name || item.name || "tool";
      const detail = data.args?.path || data.args?.file_path || data.input?.path || data.path || "";
      return { tool: name, toolDetail: detail ? shortPath(String(detail)) : "", status: "Araç çalışıyor…" };
    }
    const maybe = extractFileChange(data, item);
    if (maybe?.path && maybe.path !== "unknown") return { fileChange: { ...maybe, status: "done" } };
    return { toolDone: true };
  }
  if (data.message?.content && typeof data.message.content === "string") return { response: data.message.content };
  if (["thread.started", "turn.started", "step_start", "session.started"].includes(type) || type === "step-start") {
    return { status: "Düşünüyor…" };
  }
  if (type === "step_finish" || type === "step-finish" || type === "turn.completed") {
    return { status: "Sonraki adımları planlıyor…" };
  }
  return {};
}

function setThinking(container, text, { append = false, label = "Düşünüyor…" } = {}) {
  if (text) appendThoughtStep(container, label, text, { append });
  else appendThoughtStep(container, label);
}

function finishThinking(container, label = "Düşünce") {
  const parts = ensureAssistantParts(container);
  clearLiveStatusRow(container);
  const step = parts.feed.querySelector(".thought-step.primary");
  if (!thoughtHasContent(parts)) {
    step?.remove();
    parts.status.hidden = true;
    return;
  }
  if (step) {
    step.open = false;
    step.dataset.open = "0";
    step.classList.remove("open");
    setThoughtLabel(step, label, { live: false });
    renderThoughtBody(step, parts.state.thoughtLog, parts.state.reasoningText || "");
  }
  parts.status.hidden = true;
}

function bindDiffCardToggle(card) {
  const header = card?.querySelector(":scope > header");
  if (!header || header.dataset.diffToggleBound === "1") return;
  header.dataset.diffToggleBound = "1";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", String(!card.classList.contains("collapsed")));

  const toggle = () => {
    const collapsed = card.classList.toggle("collapsed");
    header.setAttribute("aria-expanded", String(!collapsed));
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}

function bindDiffCards(root) {
  root?.querySelectorAll(".live-diff").forEach(bindDiffCardToggle);
}

function upsertLiveDiff(container, fileChange) {
  if (!fileChange?.path || (isFileMutationTool(fileChange.path) && !/[\\/.]/.test(fileChange.path))) return;
  const parts = ensureAssistantParts(container);
  const key = fileChange.path;
  const existing = parts.state.files.get(key) || { path: key, language: fileLanguage(key), added: 0, removed: 0, diff: "", status: "editing" };
  if (fileChange.diff) {
    existing.diff = fileChange.diff;
    const stats = countDiffStats(fileChange.diff);
    existing.added = fileChange.added ?? stats.added;
    existing.removed = fileChange.removed ?? stats.removed;
  } else {
    if (fileChange.added != null) existing.added = fileChange.added;
    if (fileChange.removed != null) existing.removed = fileChange.removed;
  }
  if (fileChange.status) existing.status = fileChange.status;
  if (fileChange.content != null && !existing.diff) {
    existing.diff = contentToUnifiedDiff(key, fileChange.content);
    const stats = countDiffStats(existing.diff);
    existing.added = stats.added;
    existing.removed = stats.removed;
  }
  parts.state.files.set(key, existing);
  pushThoughtLog(container, `${existing.status === "done" ? "yazıldı" : "yazılıyor"} · ${shortPath(key)}`, "Dosya düzenleniyor…");

  if (parts.state.collapsed) {
    renderChangesSummary(container);
    return;
  }

  let card = [...parts.feed.querySelectorAll(".live-diff")].find((el) => el.dataset.path === key) || null;
  if (!card) {
    card = document.createElement("article");
    card.className = "live-diff";
    card.dataset.path = key;
    parts.feed.appendChild(card);
  }
  const wasCollapsed = card.classList.contains("collapsed");
  const stats = `<span class="diff-stats">${existing.added ? `<em class="add">+${existing.added}</em>` : ""}${existing.removed ? `<em class="del">-${existing.removed}</em>` : ""}${!existing.added && !existing.removed ? "<em>düzenleniyor</em>" : ""}</span>`;
  card.innerHTML = `
    <header><i class="fa-solid fa-chevron-down diff-toggle" aria-hidden="true"></i><span class="diff-lang">${escapeHtml(existing.language)}</span><strong title="${escapeHtml(key)}">${escapeHtml(shortPath(key))}</strong>${stats}</header>
    <div class="diff-body">${existing.diff ? renderDiffHtml(existing.diff) : '<div class="diff-line ctx"><code>Değişiklikler uygulanıyor…</code></div>'}</div>`;
  card.classList.toggle("collapsed", wasCollapsed);
  bindDiffCardToggle(card);
}

function friendlyErrorText(text) {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message || parsed?.message || (typeof parsed?.error === "string" ? parsed.error : raw);
    try {
      const nested = JSON.parse(message);
      if (nested?.error?.message) message = nested.error.message;
    } catch {
      /* plain */
    }
  } catch {
    /* not JSON */
  }
  const rejected = (String(message).match(/'([^']+)'\s+model is not supported/i) || [])[1];
  const unavailable = (String(message).match(/Model\s+["']([^"']+)["']\s+from\s+--model\s+flag\s+is\s+not\s+available/i) || [])[1];
  const outdatedModel = (String(message).match(/The '([^']+)' model requires a newer version of Codex/i) || [])[1];
  if (/requires a newer version of Codex/i.test(message)) {
    return `${outdatedModel ? `'${outdatedModel}' modeli` : "Bu model"} için Codex CLI güncel değil. Terminalde \`codex update\` çalıştırıp TaxCLI’yi yeniden başlatın.`;
  }
  if (/not supported when using Codex with a ChatGPT account/i.test(message)) {
    return rejected
      ? `'${rejected}' bu ChatGPT hesabında açık değil. Auto ile yeniden deneyin veya hesaba açık bir model seçin.`
      : String(message);
  }
  if (unavailable) return `'${unavailable}' bu Copilot hesabında kullanılamıyor. Auto seçeneğini kullanın veya bağlantıyı yenileyin.`;
  return String(message || raw);
}

function isCliHelpNoise(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  return /^(Usage:|Commands:|Positionals:|Options:|Arguments:)/i.test(raw)
    || /^gemini\s+(mcp|extensions|skills|hooks|gemma|\[query)/i.test(raw)
    || /^-[a-z],\s+--[a-z]/i.test(raw)
    || /^--[a-z][\w-]*(?:\s|$)/i.test(raw)
    || /^\s{2,}(-[a-z]|--|\[boolean\]|\[string\]|\[default)/i.test(raw)
    || /\[boolean\]|\[string\]|\[default:|\[aliases:/i.test(raw)
    || /^Gemini CLI -/i.test(raw)
    || /^Launch Gemini CLI/i.test(raw)
    || /^Manage (MCP|local Gemma|agent skills|Gemini CLI)/i.test(raw)
    || /^Initial prompt\. Runs in interactive/i.test(raw)
    || /^query\s{2,}/i.test(raw)
    || /^YOLO mode is enabled/i.test(raw);
}

function addEventRow(container, text, isError = false) {
  if (!text) return;
  const raw = String(text).trim();
  if (!isError && (/^(step_start|thread[._ ]started|turn[._ ]started|session[._ ]started)$/i.test(raw) || /^Araç:\s*(tool)?$/i.test(raw))) return;
  if (isCliHelpNoise(raw)) {
    // CLI flag dumps are noise — surface a single short error if applicable.
    if (isError && /Cannot use both --yolo|--approval-mode/i.test(raw)) {
      text = "Gemini onay modu başlatılamadı. Uygulamayı yenileyip seçili onay moduyla tekrar deneyin.";
    } else {
      return;
    }
  }
  const toolMatch = raw.match(/^(.+?)\s+kullanılıyor(?:\.{1,3}|…)?$/i) || raw.match(/^(Read|Glob|Grep|Shell|Write|Edit|Bash|Search)\b/i);
  if (!isError && toolMatch) {
    addToolChip(container, toolMatch[1], "");
    return;
  }
  let friendly = isError
    ? friendlyErrorText(String(text).trim())
    : raw.startsWith("Çalıştırılıyor:") ? "Proje üzerinde çalışılıyor…" : raw === "Araç tamamlandı" ? "İşlem tamamlandı" : raw;
  if (isError && /Cannot use both --yolo/i.test(friendly)) {
    friendly = "Gemini onay bayrakları çakıştı. Uygulamayı yeniden başlatıp tekrar deneyin.";
  }
  const parts = ensureAssistantParts(container);
  if (friendly === "İşlem tamamlandı") {
    const live = parts.feed.querySelector(".tool-chip.live");
    if (live) {
      live.classList.remove("live");
      live.classList.add("done");
      const icon = live.querySelector("i");
      if (icon) icon.className = "fa-solid fa-check";
    }
    return;
  }
  if (parts.state.collapsed && !isError) return;
  if (!isError) pushThoughtLog(container, friendly);
  const last = parts.feed.lastElementChild;
  if (!isError && last?.classList.contains("event-row") && last.textContent.trim() === friendly) return;
  if (isError && last?.classList.contains("event-row") && last.classList.contains("error") && last.textContent.trim() === friendly) return;
  // Cap error spam: one error row for the same run block.
  if (isError) {
    const errors = parts.feed.querySelectorAll(".event-row.error");
    if (errors.length >= 2) {
      const lastErr = errors[errors.length - 1];
      lastErr.querySelector("span").textContent = friendly;
      return;
    }
  }
  const row = document.createElement("div");
  row.className = `event-row${isError ? " error" : ""}`;
  row.innerHTML = isError
    ? `<i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(friendly)}</span>`
    : `<i class="fa-solid fa-spinner fa-spin"></i><span>${escapeHtml(friendly)}</span>`;
  parts.feed.appendChild(row);
  if (!isError) setStatusChip(container, "Çalışıyor…");
  else clearLiveStatusRow(container);
}

function collapseActivity(container) {
  const parts = ensureAssistantParts(container);
  parts.state.collapsed = true;
  parts.status.hidden = true;
  parts.status.classList.remove("active");

  // Final answer: remove live chips/rows; keep thought only if it has real content.
  [...parts.feed.querySelectorAll(".tool-chip, .event-row:not(.error), .live-diff, .thought-status-live")].forEach((node) => node.remove());

  if (!parts.state.thoughtLog?.length && !String(parts.state.reasoningText || "").trim()) {
    const fileHints = [...parts.state.files.values()].slice(0, 8).map((file) => `yazıldı · ${shortPath(file.path)}`);
    if (fileHints.length) parts.state.thoughtLog = fileHints;
  }

  let primary = parts.feed.querySelector(".thought-step.primary");
  const hasThought = Boolean(parts.state.thoughtLog?.length || String(parts.state.reasoningText || "").trim());
  if (!hasThought) {
    primary?.remove();
  } else {
    if (!primary) {
      primary = document.createElement("details");
      primary.className = "thought-step primary";
      primary.innerHTML = `<summary class="thought-summary"><i class="fa-solid fa-brain"></i><span class="thought-label">Düşünce</span><i class="fa-solid fa-chevron-down chev"></i></summary><div class="thought-body"></div>`;
      parts.feed.insertBefore(primary, parts.feed.firstChild);
    }
    primary.open = false;
    primary.dataset.open = "0";
    primary.classList.remove("open");
    setThoughtLabel(primary, "Düşünce", { live: false });
    renderThoughtBody(primary, parts.state.thoughtLog || [], parts.state.reasoningText || "");
  }
  [...parts.feed.querySelectorAll(".thought-step:not(.primary)")].forEach((node) => node.remove());
  parts.feed.querySelectorAll(".thought-step.primary[data-empty='1']").forEach((node) => node.remove());

  renderChangesSummary(container);
}

function renderFileDiffPanel(file, lineLimit = 80) {
  if (!file) return "";
  const body = file.diff
    ? renderDiffHtml(file.diff, lineLimit)
    : '<div class="diff-line ctx"><code>Bu dosya için satır diff’i yok; araç çıktısı kaydı eksik.</code></div>';
  return `
    <div class="live-diff static">
      <header>
        <i class="fa-solid fa-chevron-down diff-toggle" aria-hidden="true"></i>
        <span class="diff-lang">${escapeHtml(file.language || fileLanguage(file.path))}</span>
        <strong title="${escapeHtml(file.path)}">${escapeHtml(shortPath(file.path))}</strong>
        <span class="diff-stats">${file.added ? `<em class="add">+${file.added}</em>` : ""}${file.removed ? `<em class="del">-${file.removed}</em>` : ""}</span>
      </header>
      <div class="diff-body">${body}</div>
    </div>`;
}

function renderChangesSummary(container) {
  const parts = ensureAssistantParts(container);
  const files = [...parts.state.files.values()].filter((file) => file.path && !isFileMutationTool(file.path));
  if (!files.length) {
    parts.summary.hidden = true;
    parts.summary.innerHTML = "";
    return;
  }
  const totalAdded = files.reduce((sum, file) => sum + (file.added || 0), 0);
  const totalRemoved = files.reduce((sum, file) => sum + (file.removed || 0), 0);
  const visible = files.slice(0, 6);
  const hiddenCount = Math.max(0, files.length - visible.length);
  const prevPath = parts.summary.dataset.activePath || "";
  const prevMode = parts.summary.dataset.mode || "";
  parts.summary.hidden = false;
  parts.summary.innerHTML = `
    <div class="changes-head">
      <div class="changes-title"><i class="fa-solid fa-pen-to-square"></i><strong>Düzenlenen</strong>
        <span class="file-count">${files.length} dosya</span>
        <span class="diff-stats">${totalAdded ? `<em class="add">+${totalAdded}</em>` : ""}${totalRemoved ? `<em class="del">-${totalRemoved}</em>` : ""}</span>
      </div>
      <button type="button" class="changes-review" data-review-toggle aria-expanded="false">İncele</button>
    </div>
    <div class="changes-list">
      ${visible.map((file) => `
        <button type="button" class="change-file" data-change-path="${escapeHtml(file.path)}" aria-expanded="false">
          <span title="${escapeHtml(file.path)}">${escapeHtml(shortPath(file.path))}</span>
          <span class="diff-stats">${file.added ? `<em class="add">+${file.added}</em>` : ""}${file.removed ? `<em class="del">-${file.removed}</em>` : ""}</span>
        </button>`).join("")}
      ${hiddenCount ? `<button type="button" class="change-more" data-review-toggle>${hiddenCount} dosya daha · hepsini incele <i class="fa-solid fa-chevron-down"></i></button>` : ""}
    </div>
    <div class="changes-detail" hidden></div>`;

  const detail = parts.summary.querySelector(".changes-detail");
  const clearActive = () => {
    parts.summary.querySelectorAll(".change-file.active, .changes-review.active").forEach((el) => {
      el.classList.remove("active");
      el.setAttribute("aria-expanded", "false");
    });
  };
  const closeDetail = () => {
    detail.hidden = true;
    detail.innerHTML = "";
    parts.summary.dataset.activePath = "";
    parts.summary.dataset.mode = "";
    clearActive();
  };
  const openFile = (path, button) => {
    const file = parts.state.files.get(path);
    if (!file) return;
    if (!detail.hidden && parts.summary.dataset.activePath === path && parts.summary.dataset.mode === "file") {
      closeDetail();
      return;
    }
    clearActive();
    button?.classList.add("active");
    button?.setAttribute("aria-expanded", "true");
    parts.summary.dataset.activePath = path;
    parts.summary.dataset.mode = "file";
    detail.hidden = false;
    detail.innerHTML = renderFileDiffPanel(file, 120);
    bindDiffCards(detail);
  };
  const openAll = (button) => {
    if (!detail.hidden && parts.summary.dataset.mode === "all") {
      closeDetail();
      return;
    }
    clearActive();
    button?.classList.add("active");
    button?.setAttribute("aria-expanded", "true");
    parts.summary.dataset.activePath = "";
    parts.summary.dataset.mode = "all";
    detail.hidden = false;
    detail.innerHTML = files.map((file) => renderFileDiffPanel(file, 100)).join("");
    bindDiffCards(detail);
  };

  parts.summary.querySelectorAll("[data-change-path]").forEach((button) => {
    button.addEventListener("click", () => openFile(button.dataset.changePath, button));
  });
  parts.summary.querySelectorAll("[data-review-toggle]").forEach((button) => {
    button.addEventListener("click", () => openAll(button));
  });

  // Restore previous open panel if re-render mid-stream
  if (prevMode === "all") openAll(parts.summary.querySelector(".changes-review"));
  else if (prevMode === "file" && prevPath) {
    const btn = [...parts.summary.querySelectorAll("[data-change-path]")].find((el) => el.dataset.changePath === prevPath);
    openFile(prevPath, btn);
  }
}

function addMessageToRoot(root, role, content = "", engineId = activeEngine, agentId = "") {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.dataset.engineId = engineId;
  const profile = role === "assistant" && agentId ? agentRegistry.byId[agentRegistry.normalizeAgentId(agentId)] : null;
  if (profile) article.dataset.agentId = profile.id;
  const agentBadge = profile ? `<span class="message-agent-badge" data-agent-color="${escapeHtml(profile.id)}"><i class="${profile.icon}"></i>${escapeHtml(profile.shortName)}</span>` : "";
  article.innerHTML = `<span class="message-avatar" aria-hidden="true">${renderMessageAvatar(role, engineId)}</span><div class="message-body"><div class="message-head">${role === "user" ? "Sen" : engines.find((item) => item.id === engineId)?.name || "Ajan"}${agentBadge}<time>${nowLabel()}</time><button type="button" class="wb-fork-message" title="Bu mesajdan izole dal aç">Buradan dallandır</button>${role === "assistant" ? '<button type="button" class="wb-review-message" title="Çalışma kaydını ve dosya farklarını aç">İncele</button>' : ""}</div><div class="message-content"></div></div>`;
  const messageContent = article.querySelector(".message-content");
  if (role === "assistant") {
    const parts = ensureAssistantParts(messageContent);
    if (content) setRichText(parts.response, content);
  } else {
    setRichText(messageContent, content);
  }
  root.appendChild(article);
  return messageContent;
}

function addMessage(role, content = "", agentId = "", engineId = activeEngine) {
  $("#workspaceView").classList.add("has-messages");
  const messageContent = addMessageToRoot($("#conversation"), role, content, engineId, agentId);
  $("#conversation").scrollTop = $("#conversation").scrollHeight;
  scheduleHistorySave();
  return messageContent;
}

function labelComparisonOutput(content, variantId, label) {
  if (!variantId) return;
  content.dataset.comparisonVariantId = variantId;
  content.dataset.comparisonLabel = label;
  const head = content.closest(".message")?.querySelector(".message-head");
  if (head && !head.querySelector(".comparison-model-label")) {
    const badge = document.createElement("span");
    badge.className = "comparison-model-label";
    badge.textContent = label;
    head.insertBefore(badge, head.querySelector("time"));
  }
}

function setRunning(running, statusText = "") {
  isRunning = running;
  $("#sendButton").classList.toggle("running", running);
  $("#sendButton").textContent = running ? "■" : "↑";
  $("#sendButton").title = running ? "Durdur" : "Gönder";
  $("#runStatus").textContent = statusText || (running ? "Çalışıyor…" : "");
  renderProjects();
}

function historyKey(projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath)) {
  return `agenthub:history:${projectPath || "default"}:${conversationId || "main"}`;
}

function conversationStateKey(projectPath = $("#projectPath").value) {
  return `agenthub:conversations:${baseProjectKey(projectPath)}`;
}

function readLocalConversationState(projectPath) {
  if (!userSettings.localHistory) return { activeId: "", conversations: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(conversationStateKey(projectPath)) || "{}");
    return {
      activeId: String(parsed.activeId || ""),
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations.filter((item) => item?.id).slice(0, 80) : []
    };
  } catch {
    return { activeId: "", conversations: [] };
  }
}

function recoverLocalConversationMetas(projectPath) {
  if (!userSettings.localHistory || !projectPath) return [];
  const prefix = `agenthub:history:${projectPath}:`;
  const recovered = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) continue;
    try {
      const messages = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(messages) || !messages.length) continue;
      const firstUserText = String(messages.find((message) => message?.role === "user" && message?.content)?.content || "")
        .replace(/\s+/g, " ").trim().slice(0, 46);
      recovered.push({
        id,
        title: firstUserText || "Kurtarılan sohbet",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch {
      /* Ignore a single malformed legacy snapshot. */
    }
  }
  return recovered;
}

function persistConversationState(projectPath = $("#projectPath").value) {
  if (!userSettings.localHistory || !projectPath) return;
  const baseKey = baseProjectKey(projectPath);
  localStorage.setItem(conversationStateKey(projectPath), JSON.stringify({
    activeId: activeConversationByProject.get(baseKey) || "",
    conversations: (conversationsByProject.get(baseKey) || []).slice(0, 80)
  }));
}

function currentConversationMeta(projectPath = $("#projectPath").value) {
  const items = conversationsByProject.get(baseProjectKey(projectPath)) || [];
  return items.find((item) => item.id === activeConversationId(projectPath)) || null;
}

function newConversationMeta(title = "Yeni sohbet") {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 24),
    title,
    createdAt: now,
    updatedAt: now
  };
}

async function loadProjectConversations(projectPath, { ensureOne = true } = {}) {
  const baseKey = baseProjectKey(projectPath);
  if (baseKey === "__none__") {
    conversationsByProject.set(baseKey, []);
    activeConversationByProject.delete(baseKey);
    renderConversations();
    return [];
  }
  let state = { activeId: "", conversations: [] };
  try { state = await window.agentHub.listHistoryConversations(projectPath); } catch { /* local-only fallback */ }
  const cached = readLocalConversationState(projectPath);
  const local = conversationsByProject.get(baseKey) || [];
  const byId = new Map(state.conversations.map((item) => [item.id, item]));
  recoverLocalConversationMetas(projectPath).forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  cached.conversations.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
  local.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
  const items = [...byId.values()].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  if (!items.length && ensureOne) items.push(newConversationMeta());
  conversationsByProject.set(baseKey, items);
  const preferred = activeConversationByProject.get(baseKey) || cached.activeId || state.activeId;
  if (items.length) activeConversationByProject.set(baseKey, items.some((item) => item.id === preferred) ? preferred : items[0].id);
  else activeConversationByProject.delete(baseKey);
  persistConversationState(projectPath);
  renderConversations();
  return items;
}

function updateConversationTitleUi(projectPath = $("#projectPath").value) {
  const heading = document.querySelector(".project-breadcrumb strong");
  if (heading) heading.textContent = currentConversationMeta(projectPath)?.title || "Yeni sohbet";
}

function renderConversations() {
  updateConversationTitleUi();
  renderProjects();
}

async function activateConversation(conversationId) {
  const projectPath = $("#projectPath").value;
  if (!projectPath || conversationId === activeConversationId(projectPath)) return;
  parkCurrentConversation();
  activeConversationByProject.set(baseProjectKey(projectPath), conversationId);
  persistConversationState(projectPath);
  window.agentHub.setActiveHistoryConversation?.({ projectPath, conversationId }).catch(() => {});
  await restoreConversation(projectPath, conversationId);
  try {
    const branch = (await window.agentHub.workbenchRequest("list", { projectPath })).branches.find((b) => b.id === conversationId);
    if (branch?.engineId) { activeEngine = branch.engineId; updateModelButton(); renderEngines(); }
  } catch { /* Conversation remains available even if branch metadata is unreadable. */ }
  renderConversations();
  showView("workspace");
}

async function createConversation(title = "Yeni sohbet", { skipPark = false } = {}) {
  if (!$("#projectPath").value) {
    await addNewProject();
    if (!$("#projectPath").value) return null;
  }
  const projectPath = $("#projectPath").value;
  if (!skipPark) parkCurrentConversation();
  const baseKey = baseProjectKey(projectPath);
  const meta = newConversationMeta(title);
  conversationsByProject.set(baseKey, [meta, ...(conversationsByProject.get(baseKey) || [])]);
  activeConversationByProject.set(baseKey, meta.id);
  persistConversationState(projectPath);
  $("#conversation").innerHTML = "";
  $("#workspaceView").classList.remove("has-messages");
  activeRun = null;
  activeAssistant = null;
  setRunning(false);
  saveHistory($("#conversation"), projectPath, meta.id);
  renderConversations();
  showView("workspace");
  $("#prompt").focus();
  return meta;
}

function updateCurrentConversationTitle(promptText) {
  const meta = currentConversationMeta();
  if (!meta || (meta.title !== "Yeni sohbet" && meta.title !== "Önceki sohbet")) return;
  const title = String(promptText || "").replace(/\s+/g, " ").trim().slice(0, 46);
  if (!title) return;
  meta.title = title;
  meta.updatedAt = new Date().toISOString();
  persistConversationState();
  renderConversations();
}

function collectMessagesFromRoot(root = $("#conversation")) {
  return [...root.querySelectorAll(".message")].map((message) => {
    const contentEl = message.querySelector(".message-content");
    const role = message.classList.contains("user") ? "user" : "assistant";
    if (role === "assistant" && contentEl?.classList.contains("office-dashboard-host")) {
      const phase = contentEl.querySelector("[data-office-phase]")?.textContent?.trim() || "AI Ofisi";
      const workers = [...contentEl.querySelectorAll("[data-office-card]")].map((card) => {
        const name = card.querySelector(".office-worker-meta strong")?.textContent?.trim() || "Uzman";
        const profile = card.querySelector(".office-worker-meta small")?.textContent?.trim() || "";
        const status = card.querySelector("[data-office-state-label]")?.textContent?.trim() || "";
        const output = responseRawText(card.querySelector("[data-office-output]"))?.trim() || "";
        return [`## ${name}${profile ? ` — ${profile}` : ""}`, status && `Durum: ${status}`, output].filter(Boolean).join("\n");
      }).filter(Boolean);
      return {
        role,
        engineId: message.dataset.engineId || "",
        agentId: message.dataset.agentId || "",
        content: [`# AI Ofisi · ${phase}`, ...workers].join("\n\n").slice(0, 12000)
      };
    }
    if (role === "assistant" && contentEl?.classList.contains("assistant-stream")) {
      const activity = serializeActivity(contentEl);
      const content = responseRawText(contentEl).trim().slice(0, 12000);
      return { role, engineId: message.dataset.engineId || "", agentId: message.dataset.agentId || "", recordId: contentEl.dataset.recordId || "", comparisonVariantId: contentEl.dataset.comparisonVariantId || "", comparisonLabel: contentEl.dataset.comparisonLabel || "", content, activity };
    }
    return {
      role,
      engineId: message.dataset.engineId || "",
      agentId: message.dataset.agentId || "",
      content: responseRawText(contentEl).trim().slice(0, 12000)
    };
  }).filter((message) => message.content.trim() || message.activity?.length);
}

function serializeActivity(container) {
  const parts = ensureAssistantParts(container);
  const items = [];
  [...parts.feed.children].forEach((node) => {
    if (node.classList.contains("tool-chip")) {
      items.push({ type: "tool", name: node.dataset.tool || node.querySelector("strong")?.textContent || "tool", detail: node.querySelector("small")?.textContent || "" });
    } else if (node.classList.contains("thought-step")) {
      const text = node.querySelector(".thought-body")?.textContent || "";
      if (!text.trim()) return;
      items.push({ type: "thought", label: node.querySelector(".thought-label")?.textContent || "Düşündü", text });
    } else if (node.classList.contains("live-diff")) {
      const file = parts.state.files.get(node.dataset.path);
      if (file?.path && !isFileMutationTool(file.path)) {
        items.push({ type: "file", path: file.path, added: file.added, removed: file.removed, diff: file.diff?.slice(0, 8000) || "" });
      }
    } else if (node.classList.contains("event-row") && !node.classList.contains("error")) {
      items.push({ type: "event", text: node.querySelector("span")?.textContent || node.textContent });
    }
  });
  // Always keep map-backed file diffs even if live cards were collapsed away.
  [...parts.state.files.values()].forEach((file) => {
    if (!file?.path || isFileMutationTool(file.path)) return;
    if (items.some((item) => item.type === "file" && item.path === file.path)) return;
    items.push({ type: "file", path: file.path, added: file.added, removed: file.removed, diff: (file.diff || "").slice(0, 8000) });
  });
  return items.slice(-40);
}

function restoreActivity(container, activity = []) {
  if (!Array.isArray(activity) || !activity.length) return;
  const parts = ensureAssistantParts(container);
  parts.state.collapsed = false;
  parts.state.thoughtLog = [];
  parts.state.reasoningText = "";
  activity.forEach((item) => {
    if (item.type === "tool") {
      // Log into thought only — chips are stripped at end of turn.
      pushThoughtLog(container, item.detail ? `${item.name} · ${item.detail}` : item.name, item.name || "Araç");
    } else if (item.type === "thought" && String(item.text || "").trim()) {
      parts.state.reasoningText = String(item.text);
      appendThoughtStep(container, item.label || "Düşünce", item.text);
    } else if (item.type === "file" && item.path && !isFileMutationTool(item.path)) {
      upsertLiveDiff(container, { ...item, status: "done" });
    } else if (item.type === "event") {
      const text = String(item.text || "");
      if (/\s+kullanılıyor/i.test(text)) pushThoughtLog(container, text.replace(/\s+kullanılıyor.*$/i, ""), "Araç");
      else pushThoughtLog(container, text);
    }
  });
  collapseActivity(container);
}

function renderStoredMessage(message, into = $("#conversation")) {
  const hydrated = hydrateStoredMessage(message);
  if (into === $("#conversation")) {
    const content = addMessageToRoot(into, hydrated.role, hydrated.content || "", hydrated.engineId || activeEngine, hydrated.agentId || "");
    if (hydrated.recordId) content.dataset.recordId = hydrated.recordId;
    labelComparisonOutput(content, hydrated.comparisonVariantId, hydrated.comparisonLabel || "");
    $("#workspaceView").classList.add("has-messages");
    if (hydrated.role === "assistant" && hydrated.activity?.length) restoreActivity(content, hydrated.activity);
    return content;
  }
  const article = document.createElement("article");
  article.className = `message ${hydrated.role}`;
  const messageEngine = hydrated.engineId || activeEngine;
  article.dataset.engineId = messageEngine;
  const profile = hydrated.role === "assistant" ? agentRegistry.byId[hydrated.agentId] : null;
  if (profile) article.dataset.agentId = profile.id;
  const agentBadge = profile ? `<span class="message-agent-badge" data-agent-color="${escapeHtml(profile.id)}"><i class="${profile.icon}"></i>${escapeHtml(profile.shortName)}</span>` : "";
  article.innerHTML = `<span class="message-avatar" aria-hidden="true">${renderMessageAvatar(hydrated.role, messageEngine)}</span><div class="message-body"><div class="message-head">${hydrated.role === "user" ? "Sen" : engines.find((item) => item.id === messageEngine)?.name || "Ajan"}${agentBadge}<time></time><button type="button" class="wb-fork-message">Buradan dallandır</button>${hydrated.role === "assistant" ? '<button type="button" class="wb-review-message">İncele</button>' : ""}</div><div class="message-content"></div></div>`;
  const content = article.querySelector(".message-content");
  if (hydrated.recordId) content.dataset.recordId = hydrated.recordId;
  labelComparisonOutput(content, hydrated.comparisonVariantId, hydrated.comparisonLabel || "");
  if (hydrated.role === "assistant") {
    setRichText(ensureAssistantParts(content).response, hydrated.content || "");
    if (hydrated.activity?.length) restoreActivity(content, hydrated.activity);
  } else setRichText(content, hydrated.content || "");
  into.appendChild(article);
  return content;
}

function addToolChip(container, name, detail = "", { done = false } = {}) {
  const tool = String(name || "tool").replace(/\s+kullanılıyor…$/i, "").trim() || "tool";
  const parts = ensureAssistantParts(container);
  if (!done && !parts.state.collapsed) {
    pushThoughtLog(container, detail ? `${tool} · ${detail}` : tool, `${tool}…`);
  }
  if (parts.state.collapsed) return null;
  const existing = [...parts.feed.querySelectorAll(".tool-chip")].find((el) => el.dataset.tool === tool && el.dataset.detail === String(detail || ""));
  if (existing) {
    if (done) existing.classList.add("done");
    return existing;
  }
  const chip = document.createElement("div");
  chip.className = `tool-chip${done ? " done" : " live"}`;
  chip.dataset.tool = tool;
  chip.dataset.detail = detail || "";
  const icon = /read|okuma/i.test(tool) ? "fa-book-open" : /glob|search|grep/i.test(tool) ? "fa-magnifying-glass" : /write|edit|strreplace/i.test(tool) ? "fa-pen" : /shell|bash|terminal|cmd/i.test(tool) ? "fa-terminal" : "fa-wrench";
  chip.innerHTML = `<i class="fa-solid ${done ? "fa-check" : icon}"></i><strong>${escapeHtml(tool)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}`;
  parts.feed.appendChild(chip);
  return chip;
}

function readLocalHistory(projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath)) {
  try {
    const messages = JSON.parse(localStorage.getItem(historyKey(projectPath, conversationId)) || "[]");
    return Array.isArray(messages) ? messages.filter((item) => item?.content?.trim() || item?.activity?.length).slice(-200) : [];
  } catch {
    return [];
  }
}

function getHistoryForAgent(projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath)) {
  const live = collectMessagesFromRoot($("#conversation"));
  const source = live.length ? live : readLocalHistory(projectPath, conversationId);
  const noise = /(?:529|yoğunluk hatası|yanıt vermedi|PROVIDER_OVERLOADED|MODEL_TIMEOUT|Çalışma durduruldu|Ajan \d+ koduyla|sağlayıcı yoğun|API anahtarı|Bağlam alındı|Sonraki isteklerde buna göre|Görev tamamlandı\.?\s*$)/i;
  return source
    .filter((item) => item?.content?.trim() && !noise.test(item.content))
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 1800) }));
}

function saveHistory(root = $("#conversation"), projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath)) {
  if (!userSettings.localHistory) return;
  const messages = collectMessagesFromRoot(root).slice(-200);
  try { localStorage.setItem(historyKey(projectPath, conversationId), JSON.stringify(messages)); }
  catch (error) { console.warn("Sohbet geçmişi yerel olarak kaydedilemedi:", error); }
  const items = conversationsByProject.get(baseProjectKey(projectPath)) || [];
  const meta = items.find((item) => item.id === conversationId);
  if (meta) meta.updatedAt = new Date().toISOString();
  persistConversationState(projectPath);
  if (projectPath && pathIsAbsolute(projectPath)) {
    window.agentHub.saveHistoryFile({ projectPath, conversationId, title: meta?.title || "Yeni sohbet", messages }).catch(() => { /* Ignore disk history errors. */ });
  }
}

function scheduleHistorySave(projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath), delay = 450) {
  if (!userSettings.localHistory || !projectPath) return;
  const key = projectKey(projectPath, conversationId);
  clearTimeout(historySaveTimers.get(key));
  historySaveTimers.set(key, setTimeout(() => {
    historySaveTimers.delete(key);
    const isActive = projectKey() === key;
    const root = isActive ? $("#conversation") : parkedConversations.get(key);
    if (root) saveHistory(root, projectPath, conversationId);
  }, delay));
}

function pathIsAbsolute(value) {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(String(value || ""));
}

async function loadHistory(into = $("#conversation"), projectPath = $("#projectPath").value, conversationId = activeConversationId(projectPath)) {
  into.innerHTML = "";
  if (into === $("#conversation")) $("#workspaceView").classList.remove("has-messages");
  if (!userSettings.localHistory) return;
  let local = readLocalHistory(projectPath, conversationId);
  let disk = [];
  if (pathIsAbsolute(projectPath)) {
    try { disk = await window.agentHub.loadHistoryFile({ projectPath, conversationId }); } catch { disk = []; }
  }
  // localStorage is written synchronously and is therefore the freshest crash-safe
  // snapshot. Disk is the durable fallback when no local snapshot exists.
  const messages = local.length ? local : disk;
  if (messages.length) {
    try { localStorage.setItem(historyKey(projectPath, conversationId), JSON.stringify(messages.slice(-200))); }
    catch { /* Disk history remains available when browser storage is full. */ }
  }
  messages.forEach((message) => renderStoredMessage(message, into));
  if (into === $("#conversation") && messages.length) $("#workspaceView").classList.add("has-messages");
}

function parkCurrentConversation() {
  const key = projectKey();
  if (key.startsWith("__none__::") && !$("#conversation").childNodes.length) return;
  if ($("#projectPath").value) saveHistory($("#conversation"), $("#projectPath").value, activeConversationId());
  const holder = document.createElement("div");
  holder.dataset.projectKey = key;
  while ($("#conversation").firstChild) holder.appendChild($("#conversation").firstChild);
  parkedConversations.set(key, holder);
}

async function restoreConversation(projectPath, conversationId = activeConversationId(projectPath)) {
  comparisonProgress.sync();
  const key = projectKey(projectPath, conversationId);
  const holder = parkedConversations.get(key);
  if (!holder) {
    const runId = projectRuns.get(key) || null;
    activeRun = runId;
    activeAssistant = runId ? findRunContainer(runId) : null;
    const meta = runId ? runMeta.get(runId) : null;
    if ($("#conversation").childNodes.length) {
      setRunning(Boolean(runId), meta?.status || "");
      return;
    }
    await loadHistory($("#conversation"), projectPath, conversationId);
    $("#workspaceView").classList.toggle("has-messages", $("#conversation").childNodes.length > 0);
    activeAssistant = runId ? findRunContainer(runId) : null;
    setRunning(Boolean(runId), meta?.status || "");
    return;
  }
  $("#conversation").innerHTML = "";
  while (holder.firstChild) $("#conversation").appendChild(holder.firstChild);
  parkedConversations.delete(key);
  $("#workspaceView").classList.toggle("has-messages", $("#conversation").childNodes.length > 0);
  const runId = projectRuns.get(key) || null;
  activeRun = runId;
  activeAssistant = runId ? findRunContainer(runId) : null;
  const meta = runId ? runMeta.get(runId) : null;
  setRunning(Boolean(runId), meta?.status || "");
  if (activeAssistant) {
    ensureAssistantParts(activeAssistant);
    if (!activeAssistant.querySelector(".response-body")?.dataset.rawText) setThinking(activeAssistant, "", { label: meta?.status || "Düşünüyor…" });
  }
}

function findRunContainer(runId) {
  const match = (root) => [...root.querySelectorAll(".message-content[data-run-id]")].find((el) => el.dataset.runId === runId) || null;
  return match($("#conversation")) || [...parkedConversations.values()].map(match).find(Boolean) || null;
}

function applyAgentPayload(container, payload, isCurrent) {
  const parts = ensureAssistantParts(container);
  const typing = container.querySelector(".typing");
  if (typing) typing.remove();

  if (payload.type === "started") {
    appendThoughtStep(container, "Ajan başlatıldı; ilk işlem bekleniyor…");
    if (isCurrent) $("#runStatus").textContent = "Hazırlanıyor…";
  }
  if (payload.type === "approval-request") {
    setStatusChip(container, "Onayınız bekleniyor…");
    if (isCurrent) $("#runStatus").textContent = "Onayınız bekleniyor…";
  }
  if (payload.type === "output") {
    if (payload.event.kind === "text") {
      if (payload.stream === "stdout" && payload.event.engineId === "copilot") {
        collapseActivity(container);
        appendRichText(parts.response, `${payload.event.text}\n`);
      } else {
        addEventRow(container, payload.event.text, payload.stream === "stderr");
      }
    } else {
      const normalized = summarizeStructuredEvent(payload.event.data || {});
      if (normalized.thinking) appendThoughtStep(container, normalized.thoughtLabel || "Kısaca düşündü", normalized.thinking);
      if (normalized.thinkingDelta) appendThoughtStep(container, normalized.thoughtLabel || "Düşünüyor…", normalized.thinkingDelta, { append: true });
      if (normalized.fileChange) upsertLiveDiff(container, normalized.fileChange);
      if (normalized.tool) addToolChip(container, normalized.tool, normalized.toolDetail || "");
      if (normalized.toolDone) addEventRow(container, "İşlem tamamlandı");
      if (normalized.status) {
        setStatusChip(container, normalized.status);
        if (isCurrent) $("#runStatus").textContent = normalized.status;
        const meta = runMeta.get(payload.runId);
        if (meta) meta.status = normalized.status;
      }
      if (normalized.response) {
        collapseActivity(container);
        const finalText = String(normalized.response).trim();
        const existing = String(parts.response.dataset.rawText || "").trim();
        // Cursor terminal `result` concatenates segments without separators; keep streamed text if any.
        if (finalText && !existing) setRichText(parts.response, finalText);
      }
      if (normalized.delta) {
        // Keep tools/thoughts live during multi-step Cursor turns.
        parts.status.hidden = true;
        const prev = parts.response.dataset.rawText || "";
        const next = normalized.delta;
        if (prev && next.length > 20 && !prev.endsWith("\n") && !prev.endsWith(next)) {
          appendRichText(parts.response, `\n\n${next}`);
        } else {
          appendRichText(parts.response, next);
        }
      }
      if (normalized.event) addEventRow(container, normalized.event);
      if (normalized.error) addEventRow(container, normalized.error, true);
    }
  }
  if (payload.type === "error") {
    container.dataset.lastRunError = String(payload.message || "Ajan hatası");
    addEventRow(container, payload.message, true);
    // Only mark models unavailable on true timeouts — not temporary NVIDIA 529 overload.
    if (payload.code === "MODEL_TIMEOUT" && ["opencode", "nvidia"].includes(payload.engineId)) {
      if (payload.model) unavailableModels[payload.model] = Date.now();
      localStorage.setItem("agenthub:unavailable-models", JSON.stringify(unavailableModels));
      delete availableModels[payload.engineId];
      if (isCurrent) toast("Yanıtsız model 30 dakika pasifleştirildi. Model menüsünden güncel bir model seçin.", "error");
    } else if (payload.code === "PROVIDER_OVERLOADED" && isCurrent) {
      toast("Sağlayıcı yoğun (529). Anahtar sorunu değil — biraz sonra tekrar dene.", "error");
    } else if (payload.code === "AUTH_FAILED" && isCurrent) {
      toast("API anahtarı geçersiz görünüyor. Bağlantılar'dan yeniden kaydet.", "error");
    }
  }
  if (payload.type === "status") {
    setStatusChip(container, payload.message || "Çalışıyor…");
    if (isCurrent) $("#runStatus").textContent = payload.message;
    const meta = runMeta.get(payload.runId);
    if (meta) meta.status = payload.message || "Çalışıyor…";
  }
  if (payload.type === "finished") {
    collapseActivity(container);
    const hasAnswer = Boolean(String(parts.response.dataset.rawText || "").trim());
    const fileList = [...parts.state.files.values()];
    if (!hasAnswer) {
      if (container.dataset.lastRunError) {
        setRichText(parts.response, "Bu model çalışmayı tamamlayamadı. Diğer karşılaştırma sonuçları etkilenmedi.");
      } else if (payload.code == null) {
        setRichText(parts.response, "Çalışma durduruldu.");
      } else if (payload.code === 41) {
        setRichText(parts.response, "Gemini kimlik doğrulama hatası. Bağlantılar → Gemini bölümünden Google ile giriş yapın veya API anahtarı ekleyin.");
      } else if (payload.code === 0 && fileList.length) {
        const names = fileList.slice(0, 6).map((file) => shortPath(file.path)).join(", ");
        const more = fileList.length > 6 ? ` (+${fileList.length - 6})` : "";
        setRichText(parts.response, `Güncellenen dosyalar: ${names}${more}`);
      } else if (payload.code === 0 && parts.state.thoughtLog?.length) {
        const last = parts.state.thoughtLog.filter(Boolean).slice(-3).join(" · ");
        setRichText(parts.response, last || "İşlem bitti; ayrıntılı yanıt gelmedi.");
      } else if (payload.code === 0) {
        setRichText(parts.response, "Ajan tamamlandı ama görünür bir yanıt dönmedi. Promptu netleştirip tekrar dene.");
      } else {
        setRichText(parts.response, payload.code === 1
          ? "Ajan motoru ayrıntılı bir yanıt vermeden kapandı (kod 1). Modeli Auto seçip motor oturumunu kontrol edin."
          : `Ajan ${payload.code} koduyla sonlandı.`);
      }
    }
    const meta = runMeta.get(payload.runId);
    const path = meta?.projectPath;
    const replyText = String(parts.response.dataset.rawText || "");
    if (meta?.waitResolve) {
      try {
        meta.waitResolve({
          text: replyText,
          code: payload.code,
          container,
          stopped: payload.code == null,
          error: container.dataset.lastRunError || ""
        });
      } catch { /* ignore */ }
      meta.waitResolve = null;
    }
    if (meta?.promptForStats != null && !meta?.browserLoop) {
      recordUsageRun(meta.promptForStats, replyText, { ...meta, runId: payload.runId, code: payload.code, usage: payload.usage, error: container.dataset.lastRunError || "", fileEdits: fileList });
    } else if (!meta?.browserLoop) {
      recordUsageRun("", replyText, { ...meta, runId: payload.runId, code: payload.code, usage: payload.usage, error: container.dataset.lastRunError || "", fileEdits: fileList });
    }
    if (fileList.length) {
      usageStats.edits = (usageStats.edits || 0) + fileList.length;
      persistUsage();
      refreshUsageUi();
    }
    if (path && !meta?.browserLoop && !meta?.skipHistory) {
      const conversationId = meta?.conversationId || activeConversationId(path);
      const key = projectKey(path, conversationId);
      projectRuns.delete(key);
      const holder = parkedConversations.get(key);
      saveHistory(holder || $("#conversation"), path, conversationId);
    }
    runMeta.delete(payload.runId);
    delete container.dataset.lastRunError;
    container.removeAttribute("data-run-id");
    if (isCurrent) {
      if (meta?.browserLoop) {
        // Browser control keeps session running between tool loops
        activeRun = null;
      } else {
        setRunning(false);
        activeRun = null;
        activeAssistant = null;
        notifyAgentDone(payload.code === 0 || payload.code == null);
      }
    } else {
      renderProjects();
    }
    renderConversations();
  }
}

function renderAttachmentTray() {
  const tray = $("#attachmentTray");
  tray.classList.toggle("visible", selectedImages.length > 0);
  tray.innerHTML = selectedImages.map((image, index) => `<div class="attachment-card"><img src="${image.dataUrl}" alt="${escapeHtml(image.name)}"><span title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</span><button data-remove-image="${index}" aria-label="Resmi kaldır"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
  $$('[data-remove-image]').forEach((button) => button.addEventListener("click", () => {
    selectedImages.splice(Number(button.dataset.removeImage), 1);
    renderAttachmentTray();
  }));
  renderAgentSelector();
}

function pushSelectedImages(images = []) {
  if (!images.length) return 0;
  const existingPaths = new Set(selectedImages.map((image) => image.path));
  const room = Math.max(0, 8 - selectedImages.length);
  const next = images.filter((image) => image?.path && !existingPaths.has(image.path)).slice(0, room);
  selectedImages.push(...next);
  renderAttachmentTray();
  return next.length;
}

function isImageFileLike(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToImportItem(file) {
  if (file.path) return { path: file.path, name: file.name };
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > 20 * 1024 * 1024) return null;
  return {
    name: file.name || `paste-${Date.now()}.png`,
    mimeType: file.type || "image/png",
    base64: arrayBufferToBase64(buffer)
  };
}

async function addImageFiles(files = []) {
  const list = [...files].filter(isImageFileLike).slice(0, 8);
  if (!list.length) return 0;
  const items = [];
  for (const file of list) {
    const item = await fileToImportItem(file);
    if (item) items.push(item);
  }
  if (!items.length) return 0;
  const images = await window.agentHub.importImages({ items });
  const added = pushSelectedImages(images);
  if (added) {
    $("#prompt").focus();
    toast(added === 1 ? "1 resim eklendi." : `${added} resim eklendi.`);
  } else if (selectedImages.length >= 8) {
    toast("En fazla 8 resim eklenebilir.", "error");
  }
  return added;
}

async function handleComposerPaste(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const imageFiles = [];
  if (clipboard.items?.length) {
    for (const item of clipboard.items) {
      if (item.type?.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
  }
  if (!imageFiles.length && clipboard.files?.length) {
    imageFiles.push(...[...clipboard.files].filter(isImageFileLike));
  }
  if (!imageFiles.length) return;
  event.preventDefault();
  try {
    await addImageFiles(imageFiles);
  } catch (error) {
    toast(error.message || "Yapıştırılan resim eklenemedi.", "error");
  }
}

function setupComposerImageDrop() {
  const composer = document.querySelector(".composer");
  const prompt = $("#prompt");
  if (!composer || !prompt) return;

  let dragDepth = 0;
  const setDropActive = (active) => composer.classList.toggle("drop-active", active);

  composer.addEventListener("dragenter", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    setDropActive(true);
  });
  composer.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  });
  composer.addEventListener("dragleave", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setDropActive(false);
  });
  composer.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    setDropActive(false);
    try {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      const added = await addImageFiles(files);
      if (!added && files.some((file) => !isImageFileLike(file))) {
        toast("Yalnızca png, jpg, webp, gif bırakılabilir.", "error");
      }
    } catch (error) {
      toast(error.message || "Sürüklenen resim eklenemedi.", "error");
    }
  });

  prompt.addEventListener("paste", (event) => { handleComposerPaste(event); });
  composer.addEventListener("paste", (event) => {
    if (event.target === prompt) return;
    handleComposerPaste(event);
  });
}

function addImagesToMessage(container, images) {
  if (!images.length) return;
  const gallery = document.createElement("div");
  gallery.className = "message-images";
  gallery.innerHTML = images.map((image) => `<img src="${image.dataUrl}" alt="${escapeHtml(image.name)}" title="${escapeHtml(image.name)}">`).join("");
  container.prepend(gallery);
}

function readyComparisonEngines() {
  const byId = new Map(detected.map((item) => [item.id, item]));
  return engines.filter((engine) => {
    const status = byId.get(engine.id);
    return Boolean(status?.installed && status?.authenticated);
  });
}

async function loadComparisonModels(engineId) {
  if (["codex", "opencode", "nvidia"].includes(engineId) || !availableModels[engineId]?.length) {
    let live = [];
    try { live = await window.agentHub.listModels(engineId); } catch { live = []; }
    const liveModels = normalizeModelEntries(live);
    // Dynamic providers must only show models confirmed by the current account.
    // Mixing speculative presets into a live list produced selections the CLI rejected.
    availableModels[engineId] = liveModels.length
      ? liveModels
      : normalizeModelEntries(modelPresets[engineId] || []);
  }
  return normalizeModelEntries(availableModels[engineId] || modelPresets[engineId] || []);
}

function multiAiVariantKey(engineId, model = "") {
  return JSON.stringify([String(engineId || ""), normalizeAutoModelSelection(model)]);
}

function normalizeMultiAiSelection(value) {
  if (!Array.isArray(value)) return [];
  const knownEngines = new Set(engines.map((engine) => engine.id));
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const engineId = String(item?.engineId || "").trim();
    const model = normalizeAutoModelSelection(item?.model);
    const key = multiAiVariantKey(engineId, model);
    if (!knownEngines.has(engineId) || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ engineId, model });
    if (normalized.length >= MAX_MULTI_AI_VARIANTS) break;
  }
  return normalized;
}

function selectedMultiAiVariantsFromEditor() {
  return normalizeMultiAiSelection($$('[data-multi-model-option]:checked').map((input) => ({
    engineId: input.closest("[data-multi-engine]")?.dataset.multiEngine,
    model: input.dataset.multiModel || ""
  })));
}

function updateMultiAiSelectionSummary() {
  const selected = selectedMultiAiVariantsFromEditor();
  const summary = $("#multiAiSelectionSummary");
  if (summary) {
    summary.textContent = `${selected.length} / ${MAX_MULTI_AI_VARIANTS} koşu seçildi`;
    summary.classList.toggle("limit", selected.length >= MAX_MULTI_AI_VARIANTS);
  }
  $$('[data-multi-model-option]').forEach((input) => {
    const locked = input.closest("[data-multi-engine]")?.dataset.ready !== "1"
      || input.closest(".multi-ai-model-option")?.classList.contains("locked");
    input.disabled = locked || (!input.checked && selected.length >= MAX_MULTI_AI_VARIANTS);
    input.closest(".multi-ai-model-option")?.classList.toggle("selected", input.checked);
  });
  $("#multiAiModelsLabel").textContent = selected.length ? `${selected.length} model seçildi · Seçimi düzenle` : "Model veya sağlayıcı ara ve seç";
  const chips = $("#multiAiSelectedModels");
  chips.replaceChildren();
  $$('[data-multi-model-option]:checked').forEach((input) => {
    const engine = engines.find((item) => item.id === input.closest("[data-multi-engine]").dataset.multiEngine);
    const label = input.closest("[data-multi-model-row]").querySelector("strong").textContent;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.innerHTML = `${renderEngineLogo(engine)}<span>${escapeHtml(label)}</span><i class="fa-solid fa-xmark" aria-hidden="true"></i>`;
    chip.setAttribute("aria-label", `${engine.name} · ${label} seçimini kaldır`);
    chip.onclick = () => { input.checked = false; updateMultiAiSelectionSummary(); };
    chips.append(chip);
  });
  return selected;
}

function filterMultiAiModels(query = "") {
  const normalized = String(query || "").trim().toLocaleLowerCase("tr-TR");
  $$('[data-multi-model-row]').forEach((row) => {
    row.hidden = Boolean(normalized) && !String(row.dataset.searchText || "").includes(normalized);
  });
  $$('[data-multi-engine]').forEach((card) => {
    const rows = [...card.querySelectorAll("[data-multi-model-row]")];
    card.hidden = Boolean(normalized) && rows.length > 0 && rows.every((row) => row.hidden);
  });
  $("#multiAiNoMatches").hidden = !normalized || $$('[data-multi-model-row]').some((row) => !row.hidden);
}

function toggleMultiAiDropdown(open, focusButton = false) {
  $("#multiAiModelsDropdown").hidden = !open;
  $("#multiAiModelsButton").setAttribute("aria-expanded", String(open));
  if (open) $("#multiAiModelSearch").focus();
  else if (focusButton) $("#multiAiModelsButton").focus();
}

async function populateComparisonModelList(card, selectedKeys = new Set()) {
  const engineId = card?.dataset.multiEngine;
  const engine = engines.find((item) => item.id === engineId);
  const host = card?.querySelector("[data-multi-model-options]");
  if (!engineId || !host || card.dataset.ready !== "1") return;
  host.innerHTML = '<div class="multi-ai-model-empty"><i class="fa-solid fa-spinner fa-spin"></i> Modeller yükleniyor…</div>';
  const models = modelOptionsWithoutAuto(await loadComparisonModels(engineId));
  if (!card.isConnected) return;
  const savedForEngine = multiAiSelection.filter((item) => item.engineId === engineId && item.model);
  const missingSaved = savedForEngine
    .filter((item) => !models.some((model) => model.id === item.model))
    .map((item) => ({ id: item.model, label: item.model, unavailable: ["codex", "opencode", "nvidia"].includes(engineId) }));
  const rows = [{ id: "", label: "Auto · sağlayıcı varsayılanı" }, ...missingSaved, ...models]
    .filter((model, index, all) => all.findIndex((item) => item.id === model.id) === index);
  host.innerHTML = rows.map((model) => {
    const key = multiAiVariantKey(engineId, model.id);
    const checked = !model.unavailable && selectedKeys.has(key);
    const searchText = `${engine.name} ${model.label || model.id} ${model.id}`.toLocaleLowerCase("tr-TR");
    return `<label class="multi-ai-model-option ${model.unavailable ? "locked" : checked ? "selected" : ""}" data-multi-model-row data-search-text="${escapeHtml(searchText)}"><input type="checkbox" data-multi-model-option data-multi-model="${escapeHtml(model.id)}" ${checked ? "checked" : ""} ${model.unavailable ? "disabled" : ""}>${renderEngineLogo(engine)}<span><strong>${escapeHtml(model.label || model.id)}</strong>${model.id ? `<small>${escapeHtml(model.id)}</small>` : ""}${model.unavailable ? "<small>Bu oturumda kullanılamıyor; başka model seçin.</small>" : ""}</span></label>`;
  }).join("");
  $$('[data-multi-model-option]').filter((input) => input.closest("[data-multi-engine]") === card).forEach((input) => input.addEventListener("change", () => {
    updateMultiAiSelectionSummary();
  }));
  filterMultiAiModels($("#multiAiModelSearch")?.value || "");
  updateMultiAiSelectionSummary();
}

async function openMultiAiModal() {
  toggleMenu("toolMenu", false);
  if (!detected.length) await detectEngines(true);
  const host = $("#multiAiEngineList");
  const byId = new Map(detected.map((item) => [item.id, item]));
  const selectedKeys = new Set(multiAiSelection.map((item) => multiAiVariantKey(item.engineId, item.model)));
  host.innerHTML = engines.map((engine) => {
    const status = byId.get(engine.id) || {};
    const ready = Boolean(status.installed && status.authenticated);
    const state = ready ? "Bağlı" : status.installed ? "Giriş gerekli" : "CLI gerekli";
    const detail = status.detail || (status.installed ? "Hesabını bağladıktan sonra modeller yüklenir." : "Önce sağlayıcının CLI aracını kur.");
    const previewRows = ready ? "" : [
      { id: "", label: "Auto · sağlayıcı varsayılanı" },
      ...modelOptionsWithoutAuto(normalizeModelEntries(modelPresets[engine.id] || []))
    ].map((model) => {
      const searchText = `${engine.name} ${model.label || model.id} ${model.id}`.toLocaleLowerCase("tr-TR");
      return `<label class="multi-ai-model-option locked" data-multi-model-row data-search-text="${escapeHtml(searchText)}"><input type="checkbox" data-multi-model-option data-multi-model="${escapeHtml(model.id)}" disabled>${renderEngineLogo(engine)}<span><strong>${escapeHtml(model.label || model.id)}</strong>${model.id ? `<small>${escapeHtml(model.id)}</small>` : ""}</span></label>`;
    }).join("");
    return `<section class="multi-ai-engine ${ready ? "" : "unavailable"}" data-multi-engine="${escapeHtml(engine.id)}" data-ready="${ready ? "1" : "0"}" aria-label="${escapeHtml(engine.name)} modelleri"><div class="multi-ai-engine-head"><strong>${escapeHtml(engine.name)}</strong><em class="multi-ai-engine-state ${ready ? "ready" : ""}">${state}</em></div><div class="multi-ai-model-options" data-multi-model-options>${ready ? '<div class="multi-ai-model-empty">Modeller hazırlanıyor…</div>' : `<div class="multi-ai-model-empty">${escapeHtml(detail)}</div>${previewRows}`}</div></section>`;
  }).join("");
  const search = $("#multiAiModelSearch");
  const judgeEngine = $("#multiAiJudgeEngine");
  const savedJudge = JSON.parse(localStorage.getItem("agenthub:arena-judge") || "null");
  judgeEngine.innerHTML = engines.filter((engine) => byId.get(engine.id)?.installed && byId.get(engine.id)?.authenticated).map((engine) => `<option value="${engine.id}">${escapeHtml(engine.name)}</option>`).join("");
  if ([...judgeEngine.options].some((option) => option.value === savedJudge?.engineId)) judgeEngine.value = savedJudge.engineId;
  $("#multiAiJudgeModel").value = savedJudge?.model || "";
  judgeEngine.onchange = () => populateArenaJudgeModels();
  populateArenaJudgeModels();
  if (search) search.value = "";
  openModal("multiAiModal");
  toggleMultiAiDropdown(false);
  if (search) search.oninput = () => filterMultiAiModels(search.value);
  requestAnimationFrame(() => $("#multiAiModelsButton").focus());
  await Promise.all($$('[data-multi-engine][data-ready="1"]').map((card) => populateComparisonModelList(card, selectedKeys)));
  if (!multiAiSelection.length) {
    const readyCards = $$('[data-multi-engine][data-ready="1"]');
    const defaults = readyCards.slice(0, 2).map((card) => card.querySelector('[data-multi-model-option][data-multi-model=""]')).filter(Boolean);
    if (defaults.length < 2 && readyCards.length === 1) defaults.push(...[...readyCards[0].querySelectorAll('[data-multi-model-option]')].slice(defaults.length, 2));
    defaults.slice(0, 2).forEach((input) => { input.checked = true; });
  }
  updateMultiAiSelectionSummary();
}

async function populateArenaJudgeModels() {
  const engineId = $("#multiAiJudgeEngine")?.value;
  if (!engineId) return;
  try {
    const models = normalizeModelEntries(await window.agentHub.listModels(engineId));
    if ($("#multiAiJudgeEngine").value !== engineId) return;
    $("#multiAiJudgeModels").innerHTML = models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label || model.id)}</option>`).join("");
  } catch (error) { toast(`Hakem modelleri: ${error.message}`, "error"); }
}

function applyMultiAiMode() {
  const selection = selectedMultiAiVariantsFromEditor();
  if (selection.length < 2) return toast("Karşılaştırma için en az iki model seçin.", "error");
  if (selection.length > MAX_MULTI_AI_VARIANTS) return toast(`Aynı anda en fazla ${MAX_MULTI_AI_VARIANTS} model karşılaştırılabilir.`, "error");
  if (!$("#multiAiJudgeEngine").value) return toast("Önce bir hakem sağlayıcısı bağla.", "error");
  localStorage.setItem("agenthub:arena-judge", JSON.stringify({ engineId: $("#multiAiJudgeEngine").value, model: $("#multiAiJudgeModel").value.trim() }));
  multiAiSelection = selection;
  localStorage.setItem("agenthub:multi-ai-selection", JSON.stringify(multiAiSelection));
  contextFlags.multiAi = true;
  contextFlags.office = false;
  closeModal("multiAiModal");
  renderContextChips();
  toast(`${multiAiSelection.length} bağımsız model koşusu hazır. Promptu yazıp Gönder'e basabilirsin.`);
  $("#prompt").focus();
}

const OFFICE_AVATAR_PRESETS = Object.freeze([
  { id: "sage", src: "assets/office/pixel-sage.webp" },
  { id: "sky", src: "assets/office/pixel-sky.webp" },
  { id: "rose", src: "assets/office/pixel-rose.webp" },
  { id: "amber", src: "assets/office/pixel-amber.webp" },
  { id: "violet", src: "assets/office/pixel-violet.webp" },
  { id: "mint", src: "assets/office/pixel-mint.webp" },
  { id: "ocean", src: "assets/office/pixel-ocean.webp" },
  { id: "ember", src: "assets/office/pixel-ember.webp" }
]);
const officeModelLoadPromises = new Map();

function normalizeOfficeTeamRecord(value, index = 0) {
  const id = String(value?.id || `team-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `team-${index + 1}`;
  const schemaVersion = Number(value?.schemaVersion) || 0;
  return {
    id,
    name: String(value?.name || (index ? `Takım ${index + 1}` : "Ürün Stüdyosu")).trim().slice(0, 60) || `Takım ${index + 1}`,
    description: String(value?.description || "Ürün fikirlerini araştırır, tasarlar, geliştirir ve doğrular.").trim().slice(0, 180),
    members: officeRegistry.normalizeTeam(value?.members, { repairCollapsedRoles: schemaVersion < 2 }),
    schemaVersion: 2,
    createdAt: Number(value?.createdAt) || Date.now()
  };
}

function normalizeOfficeTeams(value, legacyMembers) {
  const source = Array.isArray(value) && value.length
    ? value
    : [{ id: "product-studio", name: "Ürün Stüdyosu", description: "Fikirden çalışan ürüne kadar araştırma, tasarım, geliştirme ve kalite ekibi.", members: legacyMembers }];
  const used = new Set();
  return source.slice(0, 12).map(normalizeOfficeTeamRecord).map((team, index) => {
    let id = team.id;
    while (used.has(id)) id = `${team.id}-${index + 1}`;
    used.add(id);
    return { ...team, id };
  });
}

function activeOfficeTeamRecord() {
  return officeTeams.find((team) => team.id === activeOfficeTeamId) || officeTeams[0];
}

function persistOfficeTeams() {
  const active = activeOfficeTeamRecord();
  if (active) active.members = officeRegistry.normalizeTeam(officeTeam);
  localStorage.setItem("agenthub:office-teams", JSON.stringify(officeTeams));
  localStorage.setItem("agenthub:active-office-team", activeOfficeTeamId);
  localStorage.setItem("agenthub:office-team", JSON.stringify(officeTeam));
}

function selectOfficeTeam(teamId, { render = true } = {}) {
  const selected = officeTeams.find((team) => team.id === teamId);
  if (!selected) return null;
  activeOfficeTeamId = selected.id;
  editingOfficeTeamId = selected.id;
  officeTeam = officeRegistry.normalizeTeam(selected.members);
  persistOfficeTeams();
  if (render) {
    renderOfficeHub();
    renderOfficeRoster();
    renderContextChips();
  }
  return selected;
}

function officePreset(member) {
  return OFFICE_AVATAR_PRESETS.find((preset) => preset.id === member?.avatarPreset)
    || OFFICE_AVATAR_PRESETS[Math.abs(String(member?.id || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % OFFICE_AVATAR_PRESETS.length];
}

function officeInitials(name) {
  return String(name || "AI").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toLocaleUpperCase("tr-TR") || "AI";
}

function officeAvatarHtml(member, className = "office-avatar") {
  const preset = officePreset(member);
  const content = member.avatar
    ? `<img src="${escapeHtml(member.avatar)}" alt="">`
    : `<img class="office-character office-pixel-character" src="${escapeHtml(preset.src)}" alt="">`;
  return `<span class="${className}" data-office-role="${escapeHtml(member.role)}" title="${escapeHtml(member.name)}">${content}</span>`;
}

async function officeModelsFor(engineId) {
  if (!officeModelLoadPromises.has(engineId)) {
    officeModelLoadPromises.set(engineId, loadComparisonModels(engineId).finally(() => officeModelLoadPromises.delete(engineId)));
  }
  return officeModelLoadPromises.get(engineId);
}

async function populateOfficeModelSelect(select, engineId, selectedModel = "") {
  if (!select || !engineId) return;
  const selected = normalizeAutoModelSelection(selectedModel);
  select.dataset.modelEngine = engineId;
  select.disabled = true;
  select.innerHTML = `<option value="${escapeHtml(selected)}">${escapeHtml(selected || "Modeller yükleniyor…")}</option>`;
  const engineStatus = detected.find((item) => item.id === engineId);
  if (!engineStatus?.installed || !engineStatus?.authenticated) {
    const pendingLabel = engineStatus
      ? engineStatus.installed ? "Giriş yaptıktan sonra modeller yüklenir" : "CLI kurulunca modeller yüklenir"
      : "Bağlantı taramasından sonra modeller yüklenir";
    select.innerHTML = `<option value="">Auto · sağlayıcı varsayılanı</option>${selected ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : ""}`;
    select.title = pendingLabel;
    select.disabled = false;
    return;
  }
  try {
    const models = modelOptionsWithoutAuto(await officeModelsFor(engineId));
    if (!select.isConnected || select.dataset.modelEngine !== engineId) return;
    const rows = [{ id: "", label: "Auto · sağlayıcı varsayılanı" }, ...models];
    const validSelected = rows.some((model) => model.id === selected) ? selected : "";
    select.innerHTML = rows.map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === validSelected ? "selected" : ""}>${escapeHtml(model.label || model.id)}</option>`).join("");
    if (selected && !validSelected) select.title = `${selected} bu motorun güncel listesinde yok; Auto seçildi.`;
  } catch (error) {
    if (!select.isConnected || select.dataset.modelEngine !== engineId) return;
    select.innerHTML = `<option value="">Auto · sağlayıcı varsayılanı</option>${selected ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : ""}`;
    select.title = error.message || "Model listesi alınamadı";
  } finally {
    if (select.isConnected && select.dataset.modelEngine === engineId) select.disabled = false;
  }
}

function refreshOfficeModelSelects() {
  $$('[data-office-member]').forEach((card) => {
    const select = card.querySelector("[data-office-model]");
    const engineId = card.querySelector("[data-office-engine]")?.value || "codex";
    if (select) populateOfficeModelSelect(select, engineId, select.value || select.dataset.selectedModel || "");
  });
}

function renderOfficeHub() {
  const teamHost = $("#officeTeamGrid");
  const peopleHost = $("#officePeopleGrid");
  if (!teamHost || !peopleHost) return;
  const query = String($("#officeSearch")?.value || "").trim().toLocaleLowerCase("tr-TR");
  const visibleTeams = officeTeams.filter((team) => {
    const haystack = `${team.name} ${team.description} ${team.members.map((member) => `${member.name} ${officeRegistry.roleDefinition(member.role).label}`).join(" ")}`.toLocaleLowerCase("tr-TR");
    return !query || haystack.includes(query);
  });
  teamHost.innerHTML = visibleTeams.length ? visibleTeams.map((team) => {
    const manager = officeRegistry.managerOf(team.members);
    const enabled = team.members.filter((member) => member.enabled);
    const ready = enabled.filter(officeMemberReady).length;
    const active = team.id === activeOfficeTeamId;
    return `<article class="office-team-card ${active ? "active" : ""}" data-office-team-card="${escapeHtml(team.id)}">
      <header>
        <span class="office-team-monogram">${escapeHtml(officeInitials(team.name).slice(0, 1))}</span>
        <span><strong>${escapeHtml(team.name)}</strong><small>${active ? "Aktif takım" : `${escapeHtml(manager?.name || "Yönetici")} yönetiminde`}</small></span>
        <button type="button" data-office-edit="${escapeHtml(team.id)}" title="Takımı düzenle"><i class="fa-solid fa-pen"></i></button>
      </header>
      <p>${escapeHtml(team.description || "Bu takım için henüz açıklama eklenmedi.")}</p>
      <div class="office-team-avatars">${enabled.slice(0, 6).map((member) => officeAvatarHtml(member, "office-card-avatar")).join("")}${enabled.length > 6 ? `<span class="office-avatar-more">+${enabled.length - 6}</span>` : ""}</div>
      <footer>
        <span><strong>${enabled.length}</strong><small>Çalışan</small></span>
        <span><strong>${ready}</strong><small>Bağlı</small></span>
        <span><strong>${escapeHtml(manager?.name || "—")}</strong><small>Yönetici</small></span>
        <div class="office-card-actions">
          <button type="button" data-office-duplicate="${escapeHtml(team.id)}" title="Takımı çoğalt"><i class="fa-regular fa-copy"></i></button>
          <button type="button" data-office-delete="${escapeHtml(team.id)}" title="Takımı sil"><i class="fa-regular fa-trash-can"></i></button>
          <button class="office-use-team ${active ? "selected" : ""}" type="button" data-office-use="${escapeHtml(team.id)}">${active && contextFlags.office ? "Kullanılıyor" : active ? "Seçili" : "Kullan"}</button>
        </div>
      </footer>
    </article>`;
  }).join("") : '<div class="office-empty-state"><i class="fa-solid fa-magnifying-glass"></i><strong>Sonuç bulunamadı</strong><span>Arama ifadesini değiştirip yeniden dene.</span></div>';

  const people = visibleTeams.flatMap((team) => team.members.map((member) => ({ team, member })));
  peopleHost.innerHTML = people.length ? people.map(({ team, member }) => {
    const role = officeRegistry.roleDefinition(member.role);
    const ready = officeMemberReady(member);
    return `<article class="office-person-card">
      ${officeAvatarHtml(member, "office-person-avatar")}
      <div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(role.label)}</small><em>${escapeHtml(team.name)}</em></div>
      <span class="office-person-status ${ready ? "ready" : ""}">${ready ? "Bağlı" : "Kurulum gerekli"}</span>
      <button type="button" data-office-edit="${escapeHtml(team.id)}">Düzenle</button>
    </article>`;
  }).join("") : '<div class="office-empty-state"><i class="fa-solid fa-users-slash"></i><strong>Çalışan bulunamadı</strong></div>';

  $$('[data-office-edit]').forEach((button) => button.addEventListener("click", () => openOfficeModal(button.dataset.officeEdit)));
  $$('[data-office-use]').forEach((button) => button.addEventListener("click", () => useOfficeTeam(button.dataset.officeUse)));
  $$('[data-office-duplicate]').forEach((button) => button.addEventListener("click", () => duplicateOfficeTeam(button.dataset.officeDuplicate)));
  $$('[data-office-delete]').forEach((button) => button.addEventListener("click", () => deleteOfficeTeam(button.dataset.officeDelete)));
}

function createOfficeTeam() {
  if (officeTeams.length >= 12) return toast("En fazla 12 takım oluşturabilirsin.", "error");
  const id = `team-${crypto.randomUUID().slice(0, 8)}`;
  const members = officeRegistry.normalizeTeam([
    { id: `manager-${id}`, name: "Yeni Yönetici", role: "manager", engineId: "codex", enabled: true, avatarPreset: "sage" },
    { id: `developer-${id}`, name: "Yeni Uzman", role: "developer", engineId: "codex", enabled: true, avatarPreset: "sky" }
  ]);
  const draft = normalizeOfficeTeamRecord({ id, name: "Yeni Takım", description: "Bu takımın amacını ve çalışma alanını tanımla.", members }, officeTeams.length);
  openOfficeModal(id, { draft });
}

function duplicateOfficeTeam(teamId) {
  if (officeTeams.length >= 12) return toast("En fazla 12 takım oluşturabilirsin.", "error");
  const source = officeTeams.find((team) => team.id === teamId);
  if (!source) return;
  const id = `team-${crypto.randomUUID().slice(0, 8)}`;
  const copy = normalizeOfficeTeamRecord({ ...source, id, name: `${source.name} Kopyası`, createdAt: Date.now(), members: source.members.map((member, index) => ({ ...member, id: `${member.role}-${id}-${index + 1}` })) }, officeTeams.length);
  officeTeams.push(copy);
  persistOfficeTeams();
  renderOfficeHub();
  toast("Takım çoğaltıldı.");
}

async function deleteOfficeTeam(teamId) {
  if (officeTeams.length <= 1) return toast("AI Ofisi’nde en az bir takım kalmalı.", "error");
  const team = officeTeams.find((item) => item.id === teamId);
  if (!team || !(await askUserConfirmation({
    title: `${team.name} silinsin mi?`,
    message: "Takım ve bu takıma özel çalışan yapılandırmaları AI Ofisi’nden kaldırılacak.",
    note: "Proje dosyaları ve önceki sohbetler silinmez.",
    confirmLabel: "Takımı sil",
    tone: "danger",
    eyebrow: "TAKIMI SİL",
    icon: "fa-solid fa-users-slash"
  }))) return;
  officeTeams = officeTeams.filter((item) => item.id !== teamId);
  if (activeOfficeTeamId === teamId) {
    activeOfficeTeamId = officeTeams[0].id;
    officeTeam = officeRegistry.normalizeTeam(officeTeams[0].members);
    contextFlags.office = false;
  }
  persistOfficeTeams();
  renderOfficeHub();
  renderContextChips();
  toast("Takım silindi.");
}

function officeRoleOptions(selected) {
  return Object.entries(officeRegistry.roles).map(([id, role]) => `<option value="${id}" ${id === selected ? "selected" : ""}>${escapeHtml(role.label)}</option>`).join("");
}

function officeEngineOptions(selected) {
  return engines.map((engine) => `<option value="${engine.id}" ${engine.id === selected ? "selected" : ""}>${escapeHtml(engine.name)}</option>`).join("");
}

function officeAccountOptions(member) {
  const options = [`<option value="">Varsayılan Codex oturumu</option>`];
  for (const account of chatGptAccounts) {
    const label = account.label || account.name || account.email || "ChatGPT hesabı";
    options.push(`<option value="${escapeHtml(account.id)}" ${account.id === member.accountId ? "selected" : ""}>${escapeHtml(label)}${account.email && account.email !== label ? ` · ${escapeHtml(account.email)}` : ""}</option>`);
  }
  if (member.accountId && !chatGptAccounts.some((account) => account.id === member.accountId)) {
    options.push(`<option value="${escapeHtml(member.accountId)}" selected>Bağlantısı kaldırılmış hesap</option>`);
  }
  return options.join("");
}

function refreshOfficeAccountSelects() {
  $$('[data-office-member]').forEach((card) => {
    const select = card.querySelector("[data-office-account]");
    const engineId = card.querySelector("[data-office-engine]")?.value || "codex";
    if (!select) return;
    const member = officeTeam.find((item) => item.id === card.dataset.officeMember) || {};
    const selectedAccountId = select.value || member.accountId || "";
    select.innerHTML = officeAccountOptions({ ...member, accountId: selectedAccountId });
    select.value = selectedAccountId;
    select.disabled = engineId !== "codex";
  });
}

function renderChatGptAccounts() {
  const host = $("#officeAccountList");
  if (!host) return;
  if (!chatGptAccounts.length) {
    host.innerHTML = '<div class="office-account-empty">Henüz ayrı bir ChatGPT hesabı eklenmedi. Çalışanlar varsayılan Codex oturumunu kullanır.</div>';
    return;
  }
  host.innerHTML = chatGptAccounts.map((account) => {
    const label = account.label || account.name || account.email || "ChatGPT hesabı";
    const initial = officeInitials(label);
    return `<div class="office-account-row" data-chatgpt-account="${escapeHtml(account.id)}">
      <span class="office-account-avatar">${account.picture ? `<img src="${escapeHtml(account.picture)}" alt="">` : escapeHtml(initial)}</span>
      <span class="office-account-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(account.email || "Bağlı ChatGPT hesabı")}</small></span>
      <button type="button" data-chatgpt-reconnect title="Hesabı yeniden yetkilendir"><i class="fa-solid fa-rotate"></i> Yenile</button>
      <button type="button" data-chatgpt-remove title="Hesabı ofisten kaldır"><i class="fa-solid fa-link-slash"></i></button>
    </div>`;
  }).join("");
  $$('[data-chatgpt-reconnect]').forEach((button) => button.addEventListener("click", () => connectChatGptAccount(button.closest("[data-chatgpt-account]")?.dataset.chatgptAccount || "")));
  $$('[data-chatgpt-remove]').forEach((button) => button.addEventListener("click", () => removeChatGptAccount(button.closest("[data-chatgpt-account]")?.dataset.chatgptAccount || "")));
}

async function loadChatGptAccounts() {
  try { chatGptAccounts = await window.agentHub.listChatGptAccounts(); }
  catch (error) {
    chatGptAccounts = [];
    const status = $("#officeAccountStatus");
    if (status) status.textContent = error.message;
  }
  renderChatGptAccounts();
  return chatGptAccounts;
}

async function connectChatGptAccount(accountId = "") {
  if ($$('[data-office-member]').length) collectOfficeTeamFromEditor();
  const status = $("#officeAccountStatus");
  const addButton = $("#addChatGptAccount");
  if (addButton) addButton.disabled = true;
  if (status) status.textContent = "Tarayıcı açıldı; kullanmak istediğiniz ChatGPT hesabıyla izin verin…";
  try {
    const account = await window.agentHub.loginChatGptAccount({ accountId });
    await loadChatGptAccounts();
    renderOfficeRoster();
    if (status) status.textContent = `${account.label || account.email || "ChatGPT hesabı"} bağlandı.`;
    toast("ChatGPT hesabı ofise eklendi.");
  } catch (error) {
    if (status) status.textContent = error.message;
    toast(error.message, "error");
  } finally {
    if (addButton) addButton.disabled = false;
  }
}

async function removeChatGptAccount(accountId) {
  if ($$('[data-office-member]').length) collectOfficeTeamFromEditor();
  const account = chatGptAccounts.find((item) => item.id === accountId);
  const accountLabel = account?.label || account?.email || "Bu hesap";
  if (!account || !(await askUserConfirmation({
    title: `${accountLabel} kaldırılsın mı?`,
    message: "Hesabın AI Ofisi bağlantısı kaldırılacak ve bu bilgisayardaki oturumu kapatılacak.",
    note: "Bu hesaba atanmış çalışanlar varsayılan Codex oturumuna döner.",
    confirmLabel: "Hesabı kaldır",
    tone: "danger",
    eyebrow: "HESAP BAĞLANTISI",
    icon: "fa-solid fa-link-slash"
  }))) return;
  try {
    const result = await window.agentHub.removeChatGptAccount(accountId);
    officeTeam = officeRegistry.normalizeTeam(officeTeam.map((member) => member.accountId === accountId ? { ...member, accountId: "" } : member));
    for (const team of officeTeams) {
      team.members = officeRegistry.normalizeTeam(team.members.map((member) => member.accountId === accountId ? { ...member, accountId: "" } : member));
    }
    persistOfficeTeams();
    await loadChatGptAccounts();
    renderOfficeRoster();
    toast(result.revoked ? "ChatGPT hesabının oturumu kapatıldı." : "Hesap yerelden kaldırıldı; uzaktaki oturum doğrulanamadı.", result.revoked ? "success" : "error");
  } catch (error) { toast(error.message, "error"); }
}

function officeMemberReady(member) {
  const status = detected.find((item) => item.id === member.engineId);
  if (!status?.installed) return false;
  if (member.engineId === "codex" && member.accountId) {
    return chatGptAccounts.some((account) => account.id === member.accountId && account.connected);
  }
  return Boolean(status.authenticated);
}

function renderOfficeRoster() {
  const host = $("#officeRoster");
  if (!host) return;
  host.innerHTML = officeTeam.map((member) => {
    const role = officeRegistry.roleDefinition(member.role);
    return `<article class="office-member-editor" data-office-member="${escapeHtml(member.id)}" data-office-role-current="${escapeHtml(member.role)}">
      <button class="office-avatar-button" type="button" data-office-avatar title="Karakter görünümünü seç">${officeAvatarHtml(member, "office-editor-avatar")}</button>
      <input type="file" data-office-avatar-input accept="image/png,image/jpeg,image/webp" hidden>
      <label><span>İsim</span><input data-office-name value="${escapeHtml(member.name)}" maxlength="40" aria-label="Çalışan adı" placeholder="İsim"></label>
      <label><span>Uzmanlık</span><select data-office-role aria-label="Rol">${officeRoleOptions(member.role)}</select></label>
      <label><span>AI motoru</span><select data-office-engine aria-label="AI motoru">${officeEngineOptions(member.engineId)}</select></label>
      <label><span>Hesap</span><select data-office-account aria-label="ChatGPT hesabı" title="Bu Codex çalışanının kullanacağı ChatGPT hesabı" ${member.engineId === "codex" ? "" : "disabled"}>${officeAccountOptions(member)}</select></label>
      <label><span>Model</span><select data-office-model data-selected-model="${escapeHtml(member.model)}" aria-label="Model"><option value="${escapeHtml(member.model)}">${escapeHtml(member.model || "Modeller yükleniyor…")}</option></select></label>
      <button class="office-member-remove" type="button" data-office-remove title="Çalışanı kaldır"><i class="fa-solid fa-trash-can"></i></button>
      <div class="office-avatar-picker" hidden>
        <strong>Karakter görünümü</strong>
        <div>${OFFICE_AVATAR_PRESETS.map((preset) => `<button type="button" class="${preset.id === member.avatarPreset ? "selected" : ""}" data-office-avatar-preset="${preset.id}" title="Pixel karakter ${OFFICE_AVATAR_PRESETS.indexOf(preset) + 1}"><img class="office-pixel-character" src="${escapeHtml(preset.src)}" alt=""></button>`).join("")}</div>
        <button class="office-avatar-upload" type="button" data-office-avatar-upload><i class="fa-regular fa-image"></i> Kendi görselini yükle</button>
      </div>
      <div class="office-member-instructions">
        <textarea data-office-instructions rows="2" maxlength="4000" placeholder="Özel çalışma talimatı (isteğe bağlı)">${escapeHtml(member.instructions || role.defaultInstructions)}</textarea>
        <label><input type="checkbox" data-office-enabled ${member.enabled ? "checked" : ""}> Etkin</label>
      </div>
    </article>`;
  }).join("");

  $$('[data-office-avatar]').forEach((button) => button.addEventListener("click", () => {
    const picker = button.closest("[data-office-member]")?.querySelector(".office-avatar-picker");
    if (picker) picker.hidden = !picker.hidden;
  }));
  $$('[data-office-avatar-upload]').forEach((button) => button.addEventListener("click", () => button.closest("[data-office-member]")?.querySelector("[data-office-avatar-input]")?.click()));
  $$('[data-office-avatar-preset]').forEach((button) => button.addEventListener("click", () => {
    collectOfficeTeamFromEditor({ persist: false });
    const card = button.closest("[data-office-member]");
    const member = officeTeam.find((item) => item.id === card?.dataset.officeMember);
    if (member) {
      member.avatar = "";
      member.avatarPreset = button.dataset.officeAvatarPreset;
    }
    renderOfficeRoster();
  }));
  $$('[data-office-avatar-input]').forEach((input) => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const avatar = await resizeOfficeAvatar(file);
      const card = input.closest("[data-office-member]");
      const member = officeTeam.find((item) => item.id === card?.dataset.officeMember);
      if (member) {
        member.avatar = avatar;
        member.avatarPreset = "";
      }
      renderOfficeRoster();
    } catch (error) { toast(error.message, "error"); }
  }));
  $$('[data-office-remove]').forEach((button) => button.addEventListener("click", () => {
    if (officeTeam.length <= 2) return toast("Ofiste en az yönetici ve bir çalışan kalmalı.", "error");
    officeTeam = officeTeam.filter((item) => item.id !== button.closest("[data-office-member]")?.dataset.officeMember);
    officeTeam = officeRegistry.normalizeTeam(officeTeam);
    renderOfficeRoster();
  }));
  $$('[data-office-role]').forEach((select) => select.addEventListener("change", () => {
    const card = select.closest("[data-office-member]");
    const instructions = card?.querySelector("[data-office-instructions]");
    const previousRole = card?.dataset.officeRoleCurrent || "reviewer";
    const previousDefault = officeRegistry.roleDefinition(previousRole).defaultInstructions;
    const nextRole = officeRegistry.roleDefinition(select.value);
    // Preserve genuinely custom text, but keep generated role descriptions in sync.
    if (instructions && (!instructions.value.trim() || instructions.value.trim() === previousDefault.trim())) {
      instructions.value = nextRole.defaultInstructions;
    }
    if (card) card.dataset.officeRoleCurrent = select.value;
    const avatar = card?.querySelector(".office-editor-avatar");
    if (avatar) avatar.dataset.officeRole = select.value;
  }));
  $$('[data-office-engine]').forEach((select) => select.addEventListener("change", () => {
    const card = select.closest("[data-office-member]");
    const accountSelect = card?.querySelector("[data-office-account]");
    if (accountSelect) accountSelect.disabled = select.value !== "codex";
    const modelSelect = card?.querySelector("[data-office-model]");
    if (modelSelect) populateOfficeModelSelect(modelSelect, select.value, "");
  }));
  $$('[data-office-model]').forEach((select) => {
    const engineId = select.closest("[data-office-member]")?.querySelector("[data-office-engine]")?.value || "codex";
    populateOfficeModelSelect(select, engineId, select.dataset.selectedModel || "");
  });
}

function resizeOfficeAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file.type?.startsWith("image/") || file.size > 6 * 1024 * 1024) return reject(new Error("Avatar PNG, JPG veya WebP olmalı ve 6 MB'ı geçmemeli."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Avatar okunamadı."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Avatar görüntüsü açılamadı."));
      image.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/webp", 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function collectOfficeTeamFromEditor({ persist = true } = {}) {
  const next = $$('[data-office-member]').map((card, index) => {
    const previous = officeTeam.find((item) => item.id === card.dataset.officeMember) || {};
    const selectedRole = card.querySelector("[data-office-role]")?.value;
    return {
      ...previous,
      id: previous.id || `agent-${index + 1}`,
      name: card.querySelector("[data-office-name]")?.value,
      role: officeRegistry.roles[selectedRole] ? selectedRole : previous.role,
      engineId: card.querySelector("[data-office-engine]")?.value,
      accountId: card.querySelector("[data-office-engine]")?.value === "codex" ? card.querySelector("[data-office-account]")?.value : "",
      model: card.querySelector("[data-office-model]")?.value,
      instructions: card.querySelector("[data-office-instructions]")?.value,
      enabled: Boolean(card.querySelector("[data-office-enabled]")?.checked)
    };
  });
  officeTeam = officeRegistry.normalizeTeam(next);
  const record = officeTeamDraft && editingOfficeTeamId === officeTeamDraft.id ? officeTeamDraft : activeOfficeTeamRecord();
  if (record) {
    record.members = officeTeam;
    const nameInput = $("#officeTeamName");
    const descriptionInput = $("#officeTeamDescription");
    if (nameInput) record.name = String(nameInput.value || record.name).trim().slice(0, 60) || record.name;
    if (descriptionInput) record.description = String(descriptionInput.value || "").trim().slice(0, 180);
  }
  if (persist && !officeTeamDraft) persistOfficeTeams();
  return officeTeam;
}

async function openOfficeModal(teamId = activeOfficeTeamId, { draft = null } = {}) {
  toggleMenu("toolMenu", false);
  officeTeamDraft = draft;
  const team = draft || selectOfficeTeam(teamId, { render: false }) || activeOfficeTeamRecord();
  editingOfficeTeamId = team.id;
  if (draft) officeTeam = officeRegistry.normalizeTeam(draft.members);
  $("#officeTeamName").value = team.name;
  $("#officeTeamDescription").value = team.description;
  $("#officeModalTitle").textContent = team.name;
  renderOfficeRoster();
  openModal("officeModal");
  const openedTeamId = team.id;
  try {
    await Promise.all([!detected.length ? detectEngines(true) : Promise.resolve(), loadChatGptAccounts()]);
    if ($("#officeModal")?.classList.contains("open") && editingOfficeTeamId === openedTeamId) {
      refreshOfficeAccountSelects();
      refreshOfficeModelSelects();
    }
    renderOfficeHub();
  } catch (error) {
    const status = $("#officeAccountStatus");
    if (status) status.textContent = error.message || "Bağlantı bilgileri yüklenemedi.";
  }
}

function saveOfficeTeam({ notify = true } = {}) {
  collectOfficeTeamFromEditor({ persist: false });
  if (officeTeamDraft) {
    officeTeamDraft.members = officeRegistry.normalizeTeam(officeTeam);
    officeTeams.push(officeTeamDraft);
    activeOfficeTeamId = officeTeamDraft.id;
    editingOfficeTeamId = officeTeamDraft.id;
    officeTeamDraft = null;
  }
  persistOfficeTeams();
  renderOfficeHub();
  const record = activeOfficeTeamRecord();
  if (record) $("#officeModalTitle").textContent = record.name;
  if (notify) toast("Takım kaydedildi.");
  return record;
}

function discardOfficeTeamDraft() {
  if (!officeTeamDraft) return;
  officeTeamDraft = null;
  editingOfficeTeamId = activeOfficeTeamId;
  officeTeam = officeRegistry.normalizeTeam(activeOfficeTeamRecord()?.members);
  renderOfficeHub();
}

function useOfficeTeam(teamId = activeOfficeTeamId, { fromEditor = false } = {}) {
  if (fromEditor) saveOfficeTeam({ notify: false });
  else selectOfficeTeam(teamId);
  const team = officeTeam;
  const manager = team.find((member) => member.role === "manager" && member.enabled);
  const workers = team.filter((member) => member.enabled && member.id !== manager?.id);
  if (!manager || !workers.length) return toast("En az bir yönetici ve bir etkin çalışan seçin.", "error");
  if (!officeMemberReady(manager)) return toast(`${manager.name} için AI motoru veya seçilen hesap bağlı değil.`, "error");
  if (!workers.some(officeMemberReady)) return toast("En az bir çalışanın AI motoru ve seçilen hesabı bağlı olmalı.", "error");
  contextFlags.office = true;
  contextFlags.subagents = false;
  contextFlags.multiAi = false;
  contextFlags.browser = false;
  closeBrowserPane();
  closeModal("officeModal");
  renderContextChips();
  showView("workspace");
  toast(`${activeOfficeTeamRecord()?.name || manager.name} kullanıma hazır.`);
  $("#prompt").focus();
}

function activateOfficeMode() {
  useOfficeTeam(editingOfficeTeamId, { fromEditor: true });
}

function toggleSubagentMode(force) {
  if (!userSettings.subagentsEnabled) return toast("Alt ajan modu Ayarlar → Yapılandırma bölümünde kapalı.", "error");
  const next = typeof force === "boolean" ? force : !contextFlags.subagents;
  if (next && userSettings.subagentTeamId) selectOfficeTeam(userSettings.subagentTeamId, { render: false });
  contextFlags.subagents = next;
  if (next) {
    contextFlags.office = false;
    contextFlags.multiAi = false;
    toast(`${activeOfficeTeamRecord()?.name || "Takım"} alt ajan modu hazır. Yönetici görevi bölüp sonuçları birleştirecek.`);
  }
  renderContextChips();
  $("#prompt")?.focus();
}

async function startMultiAiComparison({ prompt, outgoingImages = [] }) {
  if (multiAiPreparing) return toast("Bir karşılaştırma zaten çalışıyor.", "error");
  if (multiAiSelection.length < 2) return toast("En az iki model seçin.", "error");
  if (!$("#projectPath").value) {
    await addNewProject();
    if (!$("#projectPath").value) return;
  }
  let judge;
  try { judge = JSON.parse(localStorage.getItem("agenthub:arena-judge") || "null"); } catch { /* Show the same actionable error. */ }
  if (!judge?.engineId) return toast("Karşılaştırma menüsünden hakem sağlayıcı seçin.", "error");
  const projectPath = $("#projectPath").value;
  if (!(await ensureWorkspaceTrusted(projectPath))) return;
  const agentResolution = agentRegistry.resolveAgent(selectedAgentId, prompt, {
    plan: contextFlags.plan || approvalMode === "plan", hasImages: outgoingImages.length > 0
  });
  const requestedVariants = multiAiSelection.map((item, index) => ({ variantId: `variant-${index + 1}`, engineId: item.engineId, model: item.model || "" }));
  multiAiPreparing = true;
  multiAiCancelled = false;
  $("#stopMultiAi").hidden = false;
  $("#sendButton").disabled = true;
  closeModal("multiAiModal");
  parkCurrentConversation();
  const baseKey = baseProjectKey(projectPath);
  const promptTitle = prompt.replace(/\s+/g, " ").trim().slice(0, 34) || "Görsel görevi";
  const meta = newConversationMeta(`Karşılaştırma · ${promptTitle}`);
  const holder = document.createElement("div");
  holder.dataset.projectKey = projectKey(projectPath, meta.id);
  addImagesToMessage(addMessageToRoot(holder, "user", prompt, requestedVariants[0].engineId), outgoingImages);
  const candidates = requestedVariants.map((variant) => {
    const engineName = engines.find((item) => item.id === variant.engineId)?.name || variant.engineId;
    const assistant = addMessageToRoot(holder, "assistant", "", variant.engineId, agentResolution.resolvedId);
    labelComparisonOutput(assistant, variant.variantId, variant.model || "Auto");
    appendThoughtStep(assistant, "Sırada; diğer modelden bağımsız proje kopyası hazırlanacak.");
    return { ...variant, engineName, meta, holder, assistant, conversationId: meta.id };
  });
  // One history and sidebar entry contains every candidate and the judge.
  parkedConversations.set(projectKey(projectPath, meta.id), holder);
  conversationsByProject.set(baseKey, [meta, ...(conversationsByProject.get(baseKey) || [])]);
  persistConversationState(projectPath);
  comparisonProgress.start(projectPath, [...candidates, { variantId: "judge", engineId: judge.engineId, engineName: `Hakem · ${judge.engineId}`, model: judge.model || "" }], meta.id);
  showView("workspace");
  activeConversationByProject.set(baseKey, candidates[0].meta.id);
  await restoreConversation(projectPath, candidates[0].meta.id);
  renderConversations();
  $("#prompt").value = "";
  selectedImages = [];
  renderAttachmentTray();
  let prepared = null, arena = null, completedCount = 0, eligibleCount = 0;
  const cleaned = new Set();
  try {
    prepared = await window.agentHub.prepareParallelWorkspaces({ projectPath, variants: requestedVariants });
    arena = await window.agentHub.workbenchRequest("arena-create", { projectPath, conversationId: meta.id, prompt, variants: prepared.variants.map(({ projectPath: workingPath, ...v }) => v), judge });
    for (const [index, variant] of prepared.variants.entries()) {
      const candidate = candidates.find((c) => c.variantId === variant.variantId);
      if (!candidate) throw new Error("Model çalışma alanı eşleşmedi.");
      const { meta, assistant } = candidate;
      if (multiAiCancelled) {
        comparisonProgress.update(variant.variantId, { status: "cancelled", message: "Başlatılmadan durduruldu." });
        setRichText(ensureAssistantParts(assistant).response, "Başlatılmadan durduruldu.");
        finishThinking(assistant, "Durduruldu");
        await window.agentHub.workbenchRequest("arena-failure", { arenaId: arena.id, variantId: variant.variantId, status: "cancelled", error: "Başlatılmadan durduruldu." });
        candidate.settled = true;
        continue;
      }
      let runId = crypto.randomUUID();
      const key = projectKey(projectPath, meta.id);
      try {
        comparisonProgress.phase(`Model ${index + 1}/${prepared.variants.length} · ${candidate.engineName}`);
        comparisonProgress.update(variant.variantId, { status: "preparing", workingPath: variant.projectPath, message: "Aynı başlangıç dosyalarından proje kopyası hazırlanıyor." });
        meta.variantPath = variant.projectPath;
        await window.agentHub.materializeParallelWorkspace({ batchId: prepared.batchId, variantId: variant.variantId });
        if (multiAiCancelled) throw new Error("Karşılaştırma durduruldu.");
        assistant.dataset.runId = runId;
        assistant.dataset.recordId = runId;
        multiAiCurrentRun = runId;
        projectRuns.set(key, runId);
        comparisonProgress.update(variant.variantId, { status: "running", runId, message: "Sağlayıcı başlatılıyor; ilk çıktı bekleniyor…" });
        const completed = new Promise((resolve) => runMeta.set(runId, {
          projectPath, workingPath: variant.projectPath, conversationId: meta.id,
          engineId: variant.engineId, model: variant.model || "auto", agentId: agentResolution.resolvedId,
          startedAt: new Date().toISOString(), status: "Karşılaştırma çalışıyor…", promptForStats: prompt, waitResolve: resolve
        }));
        if (projectKey() === key) { activeRun = runId; activeAssistant = assistant; setRunning(true); }
        const result = await window.agentHub.startAgent({
          runId, conversationId: meta.id, arenaId: arena.id, variantId: variant.variantId,
          engineId: variant.engineId, agentId: agentResolution.requestedId, routingPrompt: prompt, prompt,
          history: [], images: outgoingImages.map((image) => image.path), projectPath: variant.projectPath,
          model: variant.model, approvalMode,
          effort: selectedEffortFor(variant.model, variant.engineId, agentResolution.resolvedId), routingPolicy,
          experimentalEffort: Boolean(userSettings.experimentalEffort), autoSnapshot: Boolean(userSettings.autoSnapshot),
          useWorktrees: false, worktreeBase: userSettings.worktreeBase || "main", browserSession: false, browserUrl: "",
          rules: userSettings.rulesText || "", skillsPaths: userSettings.skillsPaths || "",
          allowShell: userSettings.allowShell !== false, allowMcp: Boolean(userSettings.allowMcp), mcpConfig: userSettings.mcpConfig || "",
          useMemory: userSettings.useMemory !== false, indexIgnore: userSettings.indexIgnore !== false,
          debugStream: Boolean(userSettings.debugStream), comparisonMode: true
        });
        if (result.runId !== runId) {
          const runningMeta = runMeta.get(runId);
          if (runningMeta) { runMeta.set(result.runId, runningMeta); runMeta.delete(runId); }
          if (activeRun === runId) activeRun = result.runId;
          runId = result.runId;
          assistant.dataset.runId = runId;
          assistant.dataset.recordId = runId;
          projectRuns.set(key, runId);
          multiAiCurrentRun = runId;
          comparisonProgress.update(variant.variantId, { runId });
        }
        if (multiAiCancelled) await window.agentHub.stopAgent(runId);
        const outcome = await completed;
        multiAiCurrentRun = "";
        let tests = null;
        if (outcome.code === 0 && !outcome.error && !multiAiCancelled && $("#multiAiAutoTests").checked) {
          comparisonProgress.update(variant.variantId, { status: "testing", endedAt: null, message: "Proje testleri çalışıyor…" });
          try { tests = await window.agentHub.workbenchRequest("run-tests", { projectPath, runId }); }
          catch (error) { tests = { checks: [{ id: "test-runner", label: "Test çalıştırma", code: -1, output: error.message }] }; }
        }
        const updatedArena = await window.agentHub.workbenchRequest("arena-result", { arenaId: arena.id, variantId: variant.variantId, runId, tests });
        const recorded = updatedArena.variants?.find((v) => v.variantId === variant.variantId);
        const success = recorded ? recorded.status === "completed" : outcome.code === 0 && !outcome.error;
        const failedChecks = tests?.checks?.filter((c) => c.code !== 0) || [];
        if (success) { completedCount += 1; if (!failedChecks.length) eligibleCount += 1; }
        comparisonProgress.update(variant.variantId, {
          status: outcome.stopped ? "cancelled" : success && !failedChecks.length ? "completed" : "failed",
          error: outcome.error || recorded?.error || (failedChecks.length ? failedChecks.map((c) => `${c.label || c.id}: ${c.output || `çıkış kodu ${c.code}`}`).join("\n").slice(0, 1200) : ""),
          endedAt: Date.now(), message: outcome.stopped ? "Çalışma durduruldu." : success ? "Sonuç kaydedildi; değişiklikleri inceleyip hedef projeye uygulayabilirsin." : `Ajan başarısız oldu (çıkış kodu ${outcome.code}).`
        });
      } catch (error) {
        runMeta.delete(runId); projectRuns.delete(key);
        assistant.removeAttribute("data-run-id");
        setRichText(ensureAssistantParts(assistant).response, error.message);
        finishThinking(assistant, multiAiCancelled ? "Durduruldu" : "Hata");
        comparisonProgress.update(variant.variantId, { status: multiAiCancelled ? "cancelled" : "failed", error: error.message, endedAt: Date.now() });
        await window.agentHub.workbenchRequest("arena-failure", { arenaId: arena.id, variantId: variant.variantId, status: multiAiCancelled ? "cancelled" : "failed", error: error.message }).catch(() => {});
      } finally {
        multiAiCurrentRun = "";
        const cleanup = await window.agentHub.cleanupParallelWorkspace({ batchId: prepared.batchId, variantId: variant.variantId }).catch((error) => ({ warning: error.message }));
        if (cleanup?.warning) comparisonProgress.update(variant.variantId, { warning: cleanup.warning });
        cleaned.add(variant.variantId);
        candidate.settled = true;
        meta.variantPath = "";
        saveHistory(parkedConversations.get(key) || (projectKey() === key ? $("#conversation") : candidate.holder), projectPath, meta.id);
        if (activeRun === runId) { activeRun = null; activeAssistant = null; setRunning(false); }
      }
    }
    const arenaError = multiAiCancelled ? "Karşılaştırma durduruldu." : !eligibleCount ? "Başarılı ve testleri geçen bir çözüm yok. Model satırlarındaki hata ayrıntılarını kontrol edin." : "";
    await window.agentHub.workbenchRequest("arena-finish", { arenaId: arena.id, error: arenaError });
    if (!multiAiCancelled && eligibleCount) {
      comparisonProgress.phase(`Hakem çalışıyor · ${judge.engineId} · ${judge.model || "Auto"}`);
      try { await window.TaxCliWorkbench.judgeArena(arena.id, { conversationId: meta.id }); }
      catch (error) {
        comparisonProgress.update("judge", { status: multiAiCancelled ? "cancelled" : "failed", error: error.message, endedAt: Date.now() });
        await window.agentHub.workbenchRequest("arena-finish", { arenaId: arena.id, error: error.message });
        toast(`Hakem: ${error.message}`, "error");
      }
    } else comparisonProgress.update("judge", { status: "cancelled", message: arenaError });
    comparisonProgress.phase(multiAiCancelled ? "Karşılaştırma durduruldu" : `Karşılaştırma bitti · ${completedCount}/${candidates.length} model tamamlandı`);
    toast(multiAiCancelled ? "Karşılaştırma durduruldu; tamamlanan sonuçlar korundu." : `${completedCount}/${candidates.length} model tamamlandı. Durum ve hata ayrıntıları karşılaştırma panelinde.`, completedCount || multiAiCancelled ? "" : "error");
  } catch (error) {
    comparisonProgress.phase(`Karşılaştırma hatası: ${error.message}`);
    candidates.forEach((candidate) => {
      if (candidate.settled) return;
      comparisonProgress.update(candidate.variantId, { status: "failed", error: error.message, endedAt: Date.now() });
      setRichText(ensureAssistantParts(candidate.assistant).response, error.message);
      finishThinking(candidate.assistant, "Hata");
    });
    comparisonProgress.update("judge", { status: "cancelled", message: "Karşılaştırma başlatılamadı." });
    toast(error.message, "error");
  } finally {
    if (prepared) for (const variant of prepared.variants) {
      if (!cleaned.has(variant.variantId)) await window.agentHub.cleanupParallelWorkspace({ batchId: prepared.batchId, variantId: variant.variantId }).catch((error) => toast(`Temizlik: ${error.message}`, "error"));
    }
    const key = projectKey(projectPath, meta.id);
    saveHistory(parkedConversations.get(key) || (projectKey() === key ? $("#conversation") : holder), projectPath, meta.id);
    persistConversationState(projectPath);
    multiAiPreparing = false; multiAiCurrentRun = "";
    $("#stopMultiAi").hidden = true;
    $("#runStatus").textContent = "";
    $("#sendButton").disabled = false;
    renderConversations(); renderProjects();
  }
}
$("#stopMultiAi").addEventListener("click", async () => {
  multiAiCancelled = true;
  if (multiAiCurrentRun) await window.agentHub.stopAgent(multiAiCurrentRun).catch(() => {});
  $("#runStatus").textContent = "Karşılaştırma durduruluyor…";
});

$("#openKnowledgeTool").addEventListener("click", async () => {
  toggleMenu("toolMenu", false);
  showView("workbench");
  await window.TaxCliWorkbench.show("knowledge").catch((error) => toast(error.message, "error"));
});

const officeWorkerToggleFrames = new WeakMap();

function queueOfficeWorkerToggle(button) {
  const card = button?.closest?.("[data-office-card]");
  if (!card || button.dataset.toggleBusy === "1") return;
  button.dataset.toggleBusy = "1";
  button.classList.add("busy");
  const frame = requestAnimationFrame(() => {
    officeWorkerToggleFrames.delete(button);
    if (!button.isConnected || !card.isConnected) return;
    const compact = card.classList.toggle("compact");
    button.setAttribute("aria-expanded", compact ? "false" : "true");
    button.title = compact ? "Çalışma ayrıntılarını göster" : "Çalışma ayrıntılarını gizle";
    const icon = button.querySelector("i");
    icon?.classList.toggle("fa-chevron-down", compact);
    icon?.classList.toggle("fa-chevron-up", !compact);
    setTimeout(() => {
      if (!button.isConnected) return;
      delete button.dataset.toggleBusy;
      button.classList.remove("busy");
    }, 140);
  });
  officeWorkerToggleFrames.set(button, frame);
}

function createOfficeDashboard(team, manager) {
  const root = addMessage("assistant", "", "analyst", manager.engineId);
  root.className = "message-content office-dashboard-host";
  root.innerHTML = `<section class="office-run">
    <header class="office-run-head">
      <i class="fa-solid fa-building-user"></i>
      <div><strong>${escapeHtml(manager.name)} yönetimindeki AI Ofisi</strong><small>${team.length - 1} uzman aynı hedef için çalışacak</small></div>
      <span class="office-run-phase" data-office-phase>Yönetici planlıyor…</span>
    </header>
    <div class="office-staff-grid">
      ${team.map((member) => {
        const role = officeRegistry.roleDefinition(member.role);
        const isManager = member.id === manager.id;
        return `<article class="office-worker-card ${isManager ? "manager" : "compact"}" data-office-card="${escapeHtml(member.id)}">
          <header class="office-worker-head">
            ${officeAvatarHtml(member)}
            <span class="office-worker-meta"><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(role.label)} · ${escapeHtml(member.engineId)}${member.model ? ` · ${escapeHtml(member.model)}` : " · Auto"}</small></span>
            <span class="office-worker-status"><i class="office-worker-state" data-office-state></i><span data-office-state-label>${isManager ? "Planlıyor" : "Görev bekliyor"}</span></span>
            <button class="office-worker-toggle" type="button" data-office-toggle aria-expanded="${isManager ? "true" : "false"}" title="Çalışma ayrıntılarını göster"><i class="fa-solid fa-chevron-${isManager ? "up" : "down"}"></i></button>
          </header>
          <div class="office-worker-body"><div class="message-content office-agent-output" data-office-output="${escapeHtml(member.id)}"></div></div>
        </article>`;
      }).join("")}
    </div>
  </section>`;
  team.forEach((member) => {
    const output = root.querySelector(`[data-office-output="${CSS.escape(member.id)}"]`);
    setRichText(ensureAssistantParts(output).response, member.id === manager.id ? "Görev dağılımı hazırlanıyor…" : "Yöneticiden görev bekliyor…");
  });
  root.querySelectorAll("[data-office-toggle]").forEach((button) => {
    button.addEventListener("click", () => queueOfficeWorkerToggle(button));
  });
  return root;
}

function officeOutput(job, memberId) {
  return job.root.querySelector(`[data-office-output="${CSS.escape(memberId)}"]`);
}

function updateOfficeMemberState(job, memberId, state, label = "") {
  const card = job.root.querySelector(`[data-office-card="${CSS.escape(memberId)}"]`);
  const dot = card?.querySelector("[data-office-state]");
  if (dot) dot.className = `office-worker-state ${state || ""}`;
  const stateLabel = card?.querySelector("[data-office-state-label]");
  const fallback = ({ running: "Çalışıyor", done: "Tamamlandı", error: "Hata", retrying: "Auto ile deneniyor" })[state] || "Bekliyor";
  if (stateLabel) stateLabel.textContent = label || fallback;
  if (card && label) card.title = label;
}

function updateOfficePhase(job, label, detail = "") {
  const phase = job.root.querySelector("[data-office-phase]");
  if (phase) phase.textContent = label;
  const subtitle = job.root.querySelector(".office-run-head small");
  if (subtitle && detail) subtitle.textContent = detail;
  if (activeOfficeJobId === job.id) $("#runStatus").textContent = `AI Ofisi · ${label}`;
}

function officeAgentProfile(role, phase) {
  if (phase === "planning") return "planner";
  if (phase === "synthesis" || ["developer", "frontend", "backend", "designer"].includes(role)) return "coder";
  return "analyst";
}

async function startOfficeAgent(job, { member, prompt, runPath, phase, modelFallback = false }) {
  const container = officeOutput(job, member.id);
  if (!container) throw new Error(`${member.name} için çıktı alanı bulunamadı.`);
  container.innerHTML = "";
  container.classList.remove("assistant-stream");
  streamState.delete(container);
  ensureAssistantParts(container);
  const activityLabel = phase === "planning" ? "Görevi uzmanlıklara bölüyor…" : phase === "synthesis" ? "Sonuçları birleştiriyor…" : "Projeyi inceliyor…";
  setThinking(container, "", { label: activityLabel });
  const runId = crypto.randomUUID();
  container.dataset.runId = runId;
  const readOnlyWorker = ["security", "researcher", "reviewer"].includes(member.role);
  const runApproval = phase === "planning" || readOnlyWorker ? "plan" : approvalMode;
  const meta = {
    projectPath: job.projectPath,
    workingPath: runPath,
    conversationId: `office-${job.id}-${member.id}-${phase}`,
    engineId: member.engineId,
    model: modelFallback ? "auto" : member.model || "auto",
    agentId: officeAgentProfile(member.role, phase),
    startedAt: new Date().toISOString(),
    parentRunId: job.id,
    rootRunId: job.id,
    subagentRole: member.role,
    depth: phase === "worker" ? 1 : 0,
    historyConversationId: job.conversationId,
    status: `${member.name} · ${phase}`,
    promptForStats: phase === "planning" ? "" : job.prompt,
    officeJobId: job.id,
    officeMemberId: member.id,
    officePhase: phase,
    officePrompt: prompt,
    officeRunPath: runPath,
    officeModelFallback: modelFallback,
    skipHistory: true,
    officeError: ""
  };
  runMeta.set(runId, meta);
  job.runIds.add(runId);
  updateOfficeMemberState(job, member.id, modelFallback ? "retrying" : "running", modelFallback ? "Seçilen model açılamadı; Auto ile yeniden deneniyor" : activityLabel);
  const result = await window.agentHub.startAgent({
    runId,
    engineId: member.engineId,
    parentRunId: job.id,
    rootRunId: job.id,
    subagentRole: member.role,
    depth: phase === "worker" ? 1 : 0,
    chatgptAccountId: member.engineId === "codex" ? member.accountId || "" : "",
    agentId: officeAgentProfile(member.role, phase),
    routingPrompt: job.prompt,
    prompt,
    history: [],
    images: phase === "worker" ? job.images.map((image) => image.path) : [],
    projectPath: runPath,
    model: modelFallback ? "" : member.model || "",
    approvalMode: runApproval,
    effort: phase === "synthesis" ? "max" : phase === "planning" ? "high" : selectedEffortFor(modelFallback ? "" : member.model || "", member.engineId, officeAgentProfile(member.role, phase)),
    routingPolicy: "quality",
    experimentalEffort: Boolean(userSettings.experimentalEffort),
    autoSnapshot: Boolean(userSettings.autoSnapshot),
    useWorktrees: false,
    worktreeBase: userSettings.worktreeBase || "main",
    browserSession: false,
    browserUrl: "",
    rules: userSettings.rulesText || "",
    skillsPaths: userSettings.skillsPaths || "",
    allowShell: userSettings.allowShell !== false,
    allowMcp: phase === "planning" ? false : Boolean(userSettings.allowMcp),
    mcpConfig: userSettings.mcpConfig || "",
    useMemory: userSettings.useMemory !== false,
    indexIgnore: userSettings.indexIgnore !== false,
    debugStream: Boolean(userSettings.debugStream)
  });
  if (result.runId !== runId) {
    runMeta.set(result.runId, meta);
    runMeta.delete(runId);
    job.runIds.delete(runId);
    job.runIds.add(result.runId);
    container.dataset.runId = result.runId;
  }
  return result.runId;
}

async function finishOfficeJob(job, { error = "" } = {}) {
  job.finished = true;
  job.runIds.clear();
  updateOfficePhase(job, error ? "Ofis durdu" : "Tamamlandı", error || "Uzman çıktıları yönetici tarafından birleştirildi.");
  if (error) {
    const managerOutput = officeOutput(job, job.manager.id);
    if (managerOutput) setRichText(ensureAssistantParts(managerOutput).response, error);
    toast(error, "error");
  } else {
    notifyAgentDone(true);
  }
  if (activeOfficeJobId === job.id) {
    activeOfficeJobId = null;
    activeRun = null;
    activeAssistant = null;
    setRunning(false);
  }
  saveHistory($("#conversation"), job.projectPath, job.conversationId);
  officeJobs.delete(job.id);
  renderConversations();
}

async function launchOfficeSynthesis(job) {
  if (job.synthesisStarted || job.cancelled) return;
  job.synthesisStarted = true;
  updateOfficePhase(job, "Yönetici birleştiriyor…", `${job.results.length} çalışan çıktısı değerlendiriliyor.`);
  const managerOutput = officeOutput(job, job.manager.id);
  if (managerOutput) {
    managerOutput.innerHTML = "";
    managerOutput.classList.remove("assistant-stream");
  }
  const prompt = officeRegistry.buildSynthesisPrompt({
    task: job.prompt,
    manager: job.manager,
    plan: job.plan,
    results: job.results
  });
  try {
    const runId = await startOfficeAgent(job, { member: job.manager, prompt, runPath: job.projectPath, phase: "synthesis" });
    activeRun = runId;
  } catch (error) {
    await finishOfficeJob(job, { error: `Yönetici sonuçları birleştiremedi: ${error.message}` });
  }
}

function recordOfficeWorkerFailure(job, worker, workspacePath, error) {
  if (job.results.some((item) => item.worker.id === worker.id)) return;
  job.results.push({ worker, workspacePath, answer: "", error: error.message || String(error) });
  const output = officeOutput(job, worker.id);
  if (output) setRichText(ensureAssistantParts(output).response, `Başlatılamadı: ${error.message || error}`);
  updateOfficeMemberState(job, worker.id, "error");
}

async function launchOfficeWorkers(job) {
  if (job.cancelled) return;
  updateOfficePhase(job, "Çalışma alanları hazırlanıyor…", "Her çalışan için güvenli bir proje kopyası oluşturuluyor.");
  let prepared;
  try {
    prepared = await window.agentHub.prepareOfficeWorkspaces({
      projectPath: job.projectPath,
      workers: job.workers.map((worker) => ({ workerId: worker.id, engineId: worker.engineId }))
    });
  } catch (error) {
    await finishOfficeJob(job, { error: error.message });
    return;
  }
  job.officeRoot = prepared.root;
  updateOfficePhase(job, "Uzmanlar çalışıyor…", `${job.workers.length} alt ajan, en fazla 3 eşzamanlı çalışacak.`);
  const byId = new Map(prepared.variants.map((variant) => [variant.workerId, variant]));
  job.workerQueue = job.workers.map((worker) => ({ worker, variant: byId.get(worker.id) }));
  job.activeWorkerCount = 0;
  pumpOfficeWorkers(job);
}

function pumpOfficeWorkers(job) {
  if (!job || job.cancelled || job.finished) return;
  const maxConcurrency = 3;
  while (job.activeWorkerCount < maxConcurrency && job.workerQueue?.length) {
    const { worker, variant } = job.workerQueue.shift();
    if (!variant) {
      recordOfficeWorkerFailure(job, worker, "", new Error("İzole çalışma alanı oluşturulamadı."));
      if (!job.workerQueue.length && job.activeWorkerCount === 0 && job.results.length >= job.workers.length) launchOfficeSynthesis(job);
      continue;
    }
    const assignment = job.plan.assignments.find((item) => item.workerId === worker.id);
    const prompt = officeRegistry.buildWorkerPrompt({ task: job.prompt, worker, assignment, managerName: job.manager.name, workspacePath: variant.projectPath });
    job.activeWorkerCount += 1;
    startOfficeAgent(job, { member: worker, prompt, runPath: variant.projectPath, phase: "worker" }).then(() => {
      job.workspaceByWorker.set(worker.id, variant.projectPath);
    }).catch((error) => {
      job.activeWorkerCount = Math.max(0, job.activeWorkerCount - 1);
      recordOfficeWorkerFailure(job, worker, variant.projectPath, error);
      if (job.results.length >= job.workers.length) launchOfficeSynthesis(job);
      else pumpOfficeWorkers(job);
    });
  }
}

async function handleOfficeAgentFinished(meta, payload, container) {
  const job = officeJobs.get(meta?.officeJobId);
  if (!job || job.cancelled) return;
  job.runIds.delete(payload.runId);
  const answer = String(ensureAssistantParts(container).response.dataset.rawText || "");
  const member = job.team.find((item) => item.id === meta.officeMemberId);
  if (!member) return;
  const explicitModel = member.model && !["auto", "__auto__"].includes(member.model);
  const failureText = `${meta.officeError || ""} ${payload.code && payload.code !== 0 ? `exit ${payload.code}` : ""}`;
  const terminalProviderError = /MODEL_TIMEOUT|PROVIDER_OVERLOADED|AUTH_FAILED/i.test(meta.officeErrorCode || "");
  const explicitlyUnavailable = /--model.*not available|model.*not supported|model.*desteklenmiyor|model.*bulunamadı/i.test(failureText);
  const likelyModelFailure = !terminalProviderError && (explicitlyUnavailable
    || (payload.code === 1 && !meta.officeError));
  if (!meta.officeModelFallback && explicitModel && likelyModelFailure) {
    const failedModel = member.model;
    if (explicitlyUnavailable) {
      member.model = "";
      const configuredMember = officeTeam.find((item) => item.id === member.id);
      if (configuredMember) configuredMember.model = "";
      const teamRecord = activeOfficeTeamRecord();
      const storedMember = teamRecord?.members?.find((item) => item.id === member.id);
      if (storedMember) storedMember.model = "";
      persistOfficeTeams();
    }
    updateOfficeMemberState(job, member.id, "retrying", `${failedModel} kullanılamadı; Auto ile yeniden deneniyor`);
    const cardMeta = job.root.querySelector(`[data-office-card="${CSS.escape(member.id)}"] .office-worker-meta small`);
    if (cardMeta) cardMeta.textContent = `${officeRegistry.roleDefinition(member.role).label} · ${member.engineId} · Auto`;
    setRichText(ensureAssistantParts(container).response, `Seçilen “${failedModel}” modeli bu hesapta açılamadı. Çalışma bir kez Auto modeliyle yeniden başlatılıyor…`);
    const retryRunId = await startOfficeAgent(job, {
      member,
      prompt: meta.officePrompt,
      runPath: meta.officeRunPath,
      phase: meta.officePhase,
      modelFallback: true
    });
    activeRun = retryRunId;
    return;
  }
  if (meta.officePhase === "planning") {
    updateOfficeMemberState(job, member.id, meta.officeError ? "error" : "done");
    job.plan = officeRegistry.parsePlan(answer, job.prompt, job.team);
    setRichText(ensureAssistantParts(container).response, `${job.plan.summary}\n\n${job.plan.assignments.map((item) => `• ${job.team.find((worker) => worker.id === item.workerId)?.name || item.workerId}: ${item.task}`).join("\n")}`);
    await launchOfficeWorkers(job);
    return;
  }
  if (meta.officePhase === "worker") {
    job.activeWorkerCount = Math.max(0, (job.activeWorkerCount || 1) - 1);
    if (!job.results.some((item) => item.worker.id === member.id)) {
      job.results.push({
        worker: member,
        workspacePath: job.workspaceByWorker.get(member.id) || meta.workingPath || "",
        answer,
        error: meta.officeError || (payload.code && payload.code !== 0 ? `Çıkış kodu ${payload.code}` : "")
      });
    }
    updateOfficeMemberState(job, member.id, meta.officeError ? "error" : "done");
    if (job.results.length >= job.workers.length) await launchOfficeSynthesis(job);
    else pumpOfficeWorkers(job);
    return;
  }
  if (meta.officePhase === "synthesis") {
    updateOfficeMemberState(job, member.id, meta.officeError ? "error" : "done");
    await finishOfficeJob(job, { error: meta.officeError || "" });
  }
}

async function startOfficeRun({ prompt, outgoingImages = [] }) {
  if (activeOfficeJobId) return toast("AI Ofisi zaten çalışıyor.", "error");
  if (!$("#projectPath").value) {
    await addNewProject();
    if (!$("#projectPath").value) return;
  }
  if (!detected.length) await detectEngines(true);
  const normalized = officeRegistry.normalizeTeam(officeTeam);
  const manager = normalized.find((member) => member.role === "manager" && member.enabled);
  const configuredWorkers = normalized.filter((member) => member.enabled && member.id !== manager?.id);
  const workers = configuredWorkers.filter(officeMemberReady);
  if (!manager || !officeMemberReady(manager)) return toast("Ofis yöneticisinin AI motoru veya seçilen hesabı bağlı değil. AI Ofisi ayarlarını açın.", "error");
  if (!workers.length) return toast("Çalışabilecek bağlı bir ofis çalışanı yok.", "error");
  const skippedCount = configuredWorkers.length - workers.length;
  if (skippedCount) toast(`${skippedCount} çalışan motor bağlantısı olmadığı için bu görevde atlandı.`, "error");
  const team = [manager, ...workers];
  const projectPath = $("#projectPath").value;
  if (!(await ensureWorkspaceTrusted(projectPath))) return toast("AI Ofisi için çalışma alanına güven verilmedi.", "error");
  const hasOtherRun = [...projectRuns.keys()].some((key) => !key.startsWith(`${baseProjectKey(projectPath)}::`));
  if (!userSettings.parallelRuns && hasOtherRun) return toast("Başka bir projede ajan çalışıyor. Önce onu tamamlayın veya paralel koşuları açın.", "error");
  const conversationId = activeConversationId(projectPath);
  updateCurrentConversationTitle(prompt);
  const userMessage = addMessage("user", prompt);
  addImagesToMessage(userMessage, outgoingImages);
  const root = createOfficeDashboard(team, manager);
  const id = crypto.randomUUID();
  const job = {
    id,
    prompt,
    images: outgoingImages,
    projectPath,
    conversationId,
    root,
    manager,
    workers,
    team,
    plan: null,
    results: [],
    runIds: new Set(),
    workspaceByWorker: new Map(),
    synthesisStarted: false,
    cancelled: false,
    finished: false
  };
  officeJobs.set(id, job);
  activeOfficeJobId = id;
  $("#prompt").value = "";
  selectedImages = [];
  renderAttachmentTray();
  setRunning(true, "AI Ofisi · Yönetici planlıyor…");
  const planningPrompt = officeRegistry.buildPlanningPrompt(prompt, team);
  try {
    const runId = await startOfficeAgent(job, { member: manager, prompt: planningPrompt, runPath: projectPath, phase: "planning" });
    activeRun = runId;
  } catch (error) {
    await finishOfficeJob(job, { error: `Ofis yöneticisi başlatılamadı: ${error.message}` });
  }
}

async function stopOfficeJob(job) {
  if (!job || job.finished) return;
  job.cancelled = true;
  await Promise.all([...job.runIds].map((runId) => window.agentHub.stopAgent(runId).catch(() => false)));
  await finishOfficeJob(job, { error: "AI Ofisi kullanıcı tarafından durduruldu." });
}

async function runPrompt(options = {}) {
  const mobileRequestId = typeof options?.mobileRequestId === "string" ? options.mobileRequestId : "";
  const queuedTaskId = typeof options?.queuedTaskId === "string" ? options.queuedTaskId : "";
  const failMobile = (message) => {
    if (!mobileRequestId) return;
    window.agentHub.updateMobileMessage({ requestId: mobileRequestId, status: "Görev başlatılamadı", error: message, finished: true }).catch(() => {});
  };
  if (activeOfficeJobId && !isRunning) {
    if (mobileRequestId) {
      failMobile("AI Ofisi şu anda çalışıyor. Tamamlanınca yeniden deneyin.");
      return;
    }
    await stopOfficeJob(officeJobs.get(activeOfficeJobId));
    return;
  }
  if (isRunning) {
    if (activeOfficeJobId) {
      if (mobileRequestId) {
        failMobile("AI Ofisi şu anda çalışıyor. Tamamlanınca yeniden deneyin.");
        return;
      }
      await stopOfficeJob(officeJobs.get(activeOfficeJobId));
      return;
    }
    if (mobileRequestId) {
      failMobile("Masaüstünde başka bir görev çalışıyor. Tamamlanınca yeniden deneyin.");
      return;
    }
    if (activeRun) await window.agentHub.stopAgent(activeRun);
    $("#runStatus").textContent = "Durduruluyor…";
    return;
  }
  const typedPrompt = $("#prompt").value.trim();
  if (!typedPrompt && !selectedImages.length) return toast("Bir görev yazın veya resim ekleyin.", "error");
  if (contextFlags.subagents) {
    if (mobileRequestId) {
      failMobile("Alt ajan görevleri şu anda yalnızca masaüstünden başlatılabilir.");
      return;
    }
    const prompt = typedPrompt || "Bu görselleri uzman alt ajanlara bölüştür, sonuçları doğrula ve tek bir çözüm üret.";
    await startOfficeRun({ prompt, outgoingImages: [...selectedImages] });
    return;
  }
  if (contextFlags.office) {
    if (mobileRequestId) {
      failMobile("AI Ofisi görevleri şu anda yalnızca masaüstünden başlatılabilir.");
      return;
    }
    const prompt = typedPrompt || "Bu görselleri inceleyip proje için en iyi ortak sonucu üretin.";
    await startOfficeRun({ prompt, outgoingImages: [...selectedImages] });
    return;
  }
  if (contextFlags.multiAi) {
    if (mobileRequestId) {
      failMobile("Mobil erişim şu anda Çoklu AI modunu desteklemiyor. Masaüstünde bu modu kapatın.");
      return;
    }
    const prompt = typedPrompt || "Bu görselleri incele ve istenen projeyi geliştir.";
    await startMultiAiComparison({ prompt, outgoingImages: [...selectedImages] });
    return;
  }
  const currentProjectKey = projectKey();
  const hasOtherRun = [...projectRuns.keys()].some((key) => key !== currentProjectKey);
  if (!userSettings.parallelRuns && hasOtherRun) {
    return toast("Başka bir projede ajan çalışıyor. Paralel koşular için Ayarlar → Yapılandırma seçeneğini açın.", "error");
  }
  let prompt = typedPrompt || "Bu görseli ayrıntılı biçimde incele ve önemli bulguları açıkla.";
  const agentResolution = agentRegistry.resolveAgent(selectedAgentId, prompt, {
    plan: contextFlags.plan || approvalMode === "plan",
    browser: contextFlags.browser,
    hasImages: selectedImages.length > 0
  });
  let runTarget;
  try {
    runTarget = resolveRunTarget(agentResolution, { hasImages: selectedImages.length > 0 });
  } catch (error) {
    failMobile(error.message);
    if (routingScope === "all") return toast(`${error.message} Bağlantılar bölümünü veya Auto sağlayıcı ayarlarını kontrol edin.`, "error");
    const name = engines.find((item) => item.id === activeEngine)?.name || activeEngine;
    if (activeEngine === "copilot") return toast("Copilot CLI kurulu değil. Bağlantılar → Copilot → «Copilot CLI kur».", "error");
    return toast(`${name} CLI bu bilgisayarda kurulu değil.`, "error");
  }
  if (!$("#projectPath").value) {
    if (mobileRequestId) {
      failMobile("Önce masaüstü TaxCLI'de bir proje seçin.");
      return;
    }
    await addNewProject();
    if (!$("#projectPath").value) return;
    showView("workspace");
  }
  const projectPath = $("#projectPath").value;
  if (!(await ensureWorkspaceTrusted(projectPath))) {
    const message = "Ajanı çalıştırmak için çalışma alanına güven vermen gerekiyor.";
    failMobile(message);
    if (queuedTaskId) {
      activeQueuedTaskId = "";
      await window.agentHub.updateQueuedTask({ taskId: queuedTaskId, patch: { status: "failed", error: message, completedAt: new Date().toISOString() } }).catch(() => {});
      refreshTaskQueue().catch(() => {});
    }
    return;
  }
  const conversationId = activeConversationId(projectPath);
  if (projectPath) recordProjectOpened(projectPath);
  if (contextFlags.plan || approvalMode === "plan") {
    approvalMode = "plan";
    contextFlags.plan = true;
    localStorage.setItem("agenthub:approval", "plan");
  }

  const history = getHistoryForAgent(projectPath, conversationId);
  updateCurrentConversationTitle(typedPrompt || prompt);
  const outgoingImages = [...selectedImages];
  const userMessage = addMessage("user", typedPrompt || prompt);
  addImagesToMessage(userMessage, outgoingImages);
  $("#prompt").value = "";
  selectedImages = [];
  renderAttachmentTray();

  // Browser chip → sandboxed multi-step control loop (agent drives the side webview)
  if (contextFlags.browser) {
    if (mobileRequestId) {
      failMobile("Mobil erişim tarayıcı kontrol modunu henüz desteklemiyor. Masaüstünde Tarayıcı çipini kapatın.");
      return;
    }
    await runBrowserControlledSession({
      typedPrompt: typedPrompt || prompt,
      agentResolution,
      runTarget,
      projectPath,
      history,
      outgoingImages,
      promptForStats: typedPrompt || prompt,
      conversationId
    });
    return;
  }

  if (approvalMode === "plan" || contextFlags.plan) {
    prompt = `[TaxCLI PLAN MODU — zorunlu]
Sen planlama asistanısın. Dosya yazma, shell, deploy veya kod değişikliği YAPMA.
1) Belirsizlik varsa ÖNCE kullanıcıya 3–7 net, numaralı soru sor. Cevap gelene kadar plan uygulama.
2) Görev yeterince netse kısa adımlı bir plan yaz ve sonda açıkça onay iste: "Bu planı uygulamamı ister misin?"
3) Yanıtında yalnızca sorular ve/veya plan; uygulama yok.

Kullanıcı görevi:
${prompt}`;
  }
  activeAssistant = addMessage("assistant", "", agentResolution.resolvedId, runTarget.engineId);
  const routeLabel = agentResolution.automatic ? `Otomatik → ${agentResolution.profile.name}` : agentResolution.profile.name;
  appendThoughtStep(activeAssistant, `${routeLabel} · ${runTarget.summary}${history.length ? ` · ${history.length} mesaj bağlam` : ""}`);
  setRunning(true, `${routeLabel} · ${runTarget.engineName}`);
  const requestedRunId = crypto.randomUUID();
  const runAssistant = activeAssistant;
  activeRun = requestedRunId;
  runAssistant.dataset.runId = requestedRunId;
  runAssistant.dataset.recordId = requestedRunId;
  projectRuns.set(projectKey(projectPath, conversationId), requestedRunId);
  runMeta.set(requestedRunId, {
    projectPath, conversationId, engineId: runTarget.engineId, model: runTarget.model || "auto",
    agentId: agentResolution.resolvedId, startedAt: new Date().toISOString(),
    status: `${routeLabel} · ${runTarget.summary}`, promptForStats: typedPrompt || prompt,
    mobileRequestId, queuedTaskId
  });
  try {
    const result = await window.agentHub.startAgent({
      runId: requestedRunId,
      engineId: runTarget.engineId,
      agentId: agentResolution.requestedId,
      routingPrompt: typedPrompt || prompt,
      prompt,
      history,
      conversationId,
      images: outgoingImages.map((image) => image.path),
      projectPath,
      model: runTarget.model,
      approvalMode,
      effort: runTarget.effort,
      routingPolicy: runTarget.appliedPolicy,
      experimentalEffort: Boolean(userSettings.experimentalEffort),
      autoSnapshot: Boolean(userSettings.autoSnapshot),
      useWorktrees: Boolean(userSettings.useWorktrees),
      worktreeBase: userSettings.worktreeBase || "main",
      browserSession: false,
      browserUrl: "",
      rules: userSettings.rulesText || "",
      skillsPaths: userSettings.skillsPaths || "",
      allowShell: userSettings.allowShell !== false,
      allowMcp: Boolean(userSettings.allowMcp),
      mcpConfig: userSettings.mcpConfig || "",
      useMemory: userSettings.useMemory !== false,
      indexIgnore: userSettings.indexIgnore !== false,
      debugStream: Boolean(userSettings.debugStream)
    });
    if (result.runId !== requestedRunId && runMeta.has(requestedRunId)) {
      runMeta.set(result.runId, runMeta.get(requestedRunId)); runMeta.delete(requestedRunId);
      runAssistant.dataset.runId = result.runId; runAssistant.dataset.recordId = result.runId;
      projectRuns.set(projectKey(projectPath, conversationId), result.runId); activeRun = result.runId;
    }
    if (queuedTaskId) {
      window.agentHub.updateQueuedTask({ taskId: queuedTaskId, patch: { status: "running", runId: result.runId, error: "" } })
        .then((updated) => { taskQueueState = updated.state; renderTaskQueue(); })
        .catch(() => {});
    }
    if (mobileRequestId) {
      window.agentHub.updateMobileMessage({
        requestId: mobileRequestId,
        runId: result.runId,
        status: `${routeLabel} · ${runTarget.engineName} çalışıyor…`
      }).catch(() => {});
    }
    if (result.visionNote && userSettings.visionWarnings !== false) toast(result.visionNote, "error");
    if (result.reviewWarning) toast(result.reviewWarning);
    renderProjects();
    renderConversations();
  } catch (error) {
    runMeta.delete(requestedRunId);
    projectRuns.delete(projectKey(projectPath, conversationId));
    runAssistant.removeAttribute("data-run-id");
    const parts = ensureAssistantParts(runAssistant);
    setRichText(parts.response, error.message);
    finishThinking(runAssistant, "Hata");
    setRunning(false);
    activeRun = null;
    activeAssistant = null;
    if (queuedTaskId) {
      activeQueuedTaskId = "";
      await window.agentHub.updateQueuedTask({ taskId: queuedTaskId, patch: { status: "failed", error: error.message, completedAt: new Date().toISOString() } }).catch(() => {});
      refreshTaskQueue().catch(() => {});
    }
    failMobile(error.message);
    toast(error.message, "error");
  }
}

function formatStorageSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshSnapshots() {
  const host = $("#snapshotList");
  const summary = $("#snapshotSummary");
  if (!host || !summary) return;
  const projectPath = $("#projectPath").value;
  if (!projectPath) {
    summary.textContent = "Snapshot için önce bir proje seçin.";
    host.innerHTML = "";
    return;
  }
  try {
    const snapshots = await window.agentHub.listSnapshots(projectPath);
    summary.textContent = `${snapshots.length} geri yükleme noktası · En fazla 20 snapshot saklanır`;
    host.innerHTML = snapshots.length ? snapshots.map((snapshot) => `<article class="control-row"><span class="control-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><div><strong>${escapeHtml(snapshot.label)}</strong><small>${new Date(snapshot.createdAt).toLocaleString("tr-TR")} · ${snapshot.fileCount} dosya · ${formatStorageSize(snapshot.totalBytes)}${snapshot.skipped?.length ? ` · ${snapshot.skipped.length} hassas/büyük dosya atlandı` : ""}</small></div><span class="control-actions"><button class="s-btn" data-restore-snapshot="${escapeHtml(snapshot.id)}">Geri yükle</button><button class="icon-button danger-text" data-delete-snapshot="${escapeHtml(snapshot.id)}" title="Snapshot’ı sil"><i class="fa-solid fa-trash-can"></i></button></span></article>`).join("") : '<div class="notification-empty">Henüz snapshot yok.</div>';
    $$('[data-restore-snapshot]').forEach((button) => button.addEventListener("click", async () => {
      if ([...projectRuns.keys()].some((key) => key.startsWith(`${baseProjectKey(projectPath)}::`)) || activeOfficeJobId) return toast("Geri yüklemeden önce bu projedeki çalışan görevleri durdurun.", "error");
      const snapshot = snapshots.find((item) => item.id === button.dataset.restoreSnapshot);
      if (!snapshot || !(await askUserConfirmation({
        title: "Proje bu snapshot’a döndürülsün mü?",
        message: `${snapshot.fileCount} dosya geri yüklenecek; snapshot sonrasında oluşturulan normal proje dosyaları kaldırılacak.`,
        note: ".git, node_modules, .aihub ve gizli anahtar dosyaları korunur.",
        confirmLabel: "Geri yükle",
        tone: "warning",
        eyebrow: "SNAPSHOT GERİ ALMA",
        icon: "fa-solid fa-clock-rotate-left"
      }))) return;
      button.disabled = true;
      try {
        const result = await window.agentHub.restoreSnapshot({ projectPath, snapshotId: snapshot.id });
        toast(`${result.restoredCount} dosya geri yüklendi; ${result.removedCount} yeni dosya kaldırıldı. Önceki durum ayrıca korundu.`);
        await Promise.all([refreshSnapshots(), refreshGitCenter()]);
      } catch (error) { toast(`Snapshot geri yüklenemedi: ${error.message}`, "error"); }
      finally { button.disabled = false; }
    }));
    $$('[data-delete-snapshot]').forEach((button) => button.addEventListener("click", async () => {
      if (!(await askUserConfirmation({ title: "Snapshot silinsin mi?", message: "Bu geri yükleme noktası kalıcı olarak kaldırılacak.", confirmLabel: "Sil", tone: "danger", eyebrow: "SNAPSHOT", icon: "fa-solid fa-trash-can" }))) return;
      await window.agentHub.deleteSnapshot({ projectPath, snapshotId: button.dataset.deleteSnapshot });
      await refreshSnapshots();
    }));
  } catch (error) {
    summary.textContent = `Snapshot’lar alınamadı: ${error.message}`;
    host.innerHTML = "";
  }
}

async function createManualSnapshot() {
  const projectPath = $("#projectPath").value;
  if (!projectPath) return toast("Önce bir proje seçin.", "error");
  const button = $("#createSnapshot");
  button.disabled = true;
  try {
    const snapshot = await window.agentHub.createSnapshot({ projectPath, label: "Elle oluşturulan snapshot", reason: "manual" });
    toast(`${snapshot.fileCount} dosyalık snapshot oluşturuldu.`);
    await refreshSnapshots();
  } catch (error) { toast(`Snapshot oluşturulamadı: ${error.message}`, "error"); }
  finally { button.disabled = false; }
}

async function refreshGitCenter() {
  const summary = $("#gitSummary");
  const filesHost = $("#gitFileList");
  const logHost = $("#gitLog");
  if (!summary || !filesHost || !logHost) return;
  const projectPath = $("#projectPath").value;
  if (!projectPath) {
    summary.textContent = "Git için önce bir proje seçin.";
    filesHost.innerHTML = "";
    logHost.innerHTML = "";
    return;
  }
  try {
    const status = await window.agentHub.getGitStatus(projectPath);
    if (!status.repository) {
      summary.innerHTML = 'Bu klasör henüz Git deposu değil. <button class="s-btn" id="initializeGitRepository" type="button">Git deposu oluştur</button>';
      filesHost.innerHTML = "";
      logHost.innerHTML = "";
      $("#initializeGitRepository")?.addEventListener("click", async () => {
        await window.agentHub.initializeGit(projectPath);
        toast("Git deposu oluşturuldu.");
        refreshGitCenter();
      });
      return;
    }
    const staged = status.files.filter((file) => file.staged).length;
    summary.textContent = `${status.branch} dalı · ${status.files.length} değişiklik · ${staged} staged${status.diffStat ? ` · ${status.diffStat.split(/\r?\n/).slice(-1)[0]}` : ""}`;
    filesHost.innerHTML = status.files.length ? status.files.map((file) => `<article class="control-row git-file"><span class="git-status-code">${escapeHtml(`${file.index}${file.worktree}`)}</span><div><strong>${escapeHtml(file.path)}</strong><small>${file.untracked ? "Yeni dosya" : file.staged ? "Stage edildi" : "Değiştirildi"}</small></div><button class="s-btn" data-git-action="${file.staged ? "unstage" : "stage"}" data-git-path="${escapeHtml(file.path)}">${file.staged ? "Unstage" : "Stage"}</button></article>`).join("") : '<div class="notification-empty">Çalışma ağacı temiz.</div>';
    $$('[data-git-action]').forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const payload = { projectPath, paths: [button.dataset.gitPath] };
        if (button.dataset.gitAction === "stage") await window.agentHub.stageGitPaths(payload);
        else await window.agentHub.unstageGitPaths(payload);
        await refreshGitCenter();
      } catch (error) { toast(`Git işlemi başarısız: ${error.message}`, "error"); }
    }));
    logHost.innerHTML = status.log.length ? `<h3>Son commitler</h3>${status.log.map((item) => `<div class="git-log-row"><code>${escapeHtml(item.hash)}</code><span><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.author)} · ${escapeHtml(item.age)}</small></span></div>`).join("")}` : "";
  } catch (error) {
    summary.textContent = `Git durumu alınamadı: ${error.message}`;
    filesHost.innerHTML = "";
    logHost.innerHTML = "";
  }
}

async function commitGitChanges() {
  const projectPath = $("#projectPath").value;
  const message = $("#gitCommitMessage")?.value.trim();
  if (!projectPath || !message) return toast("Proje ve commit mesajı gerekli.", "error");
  try {
    const result = await window.agentHub.commitGit({ projectPath, message });
    $("#gitCommitMessage").value = "";
    toast(result.output || "Commit oluşturuldu.");
    await refreshGitCenter();
  } catch (error) { toast(`Commit oluşturulamadı: ${error.message}`, "error"); }
}

function renderTaskQueue() {
  const summary = $("#taskQueueSummary");
  const host = $("#taskQueueList");
  if (!summary || !host) return;
  const pending = taskQueueState.tasks.filter((task) => task.status === "pending").length;
  const running = taskQueueState.tasks.filter((task) => task.status === "running").length;
  summary.textContent = `${taskQueueState.paused ? "Duraklatıldı" : "Çalışıyor"} · ${pending} bekleyen · ${running} çalışan · ${taskQueueState.tasks.length} toplam`;
  $("#toggleTaskQueue").textContent = taskQueueState.paused ? "Devam ettir" : "Duraklat";
  const labels = { pending: "Bekliyor", running: "Çalışıyor", completed: "Tamamlandı", failed: "Hata", cancelled: "İptal" };
  host.innerHTML = taskQueueState.tasks.length ? taskQueueState.tasks.map((task) => `<article class="control-row queue-task ${task.status}"><span class="queue-state-dot"></span><div><strong>${escapeHtml(task.prompt.slice(0, 120))}</strong><small>${escapeHtml(task.projectName || task.projectPath)} · ${escapeHtml(task.engineId)} · ${labels[task.status] || task.status}${task.error ? ` · ${escapeHtml(task.error)}` : ""}</small></div><span class="control-actions">${task.status === "failed" ? `<button class="s-btn" data-retry-task="${task.id}">Yeniden dene</button>` : ""}${task.status !== "running" ? `<button class="icon-button danger-text" data-remove-task="${task.id}" title="Kuyruktan kaldır"><i class="fa-solid fa-xmark"></i></button>` : ""}</span></article>`).join("") : '<div class="notification-empty">Kuyruk boş.</div>';
  $$('[data-retry-task]').forEach((button) => button.addEventListener("click", async () => {
    await window.agentHub.retryQueuedTask(button.dataset.retryTask);
    await refreshTaskQueue();
    pumpTaskQueue();
  }));
  $$('[data-remove-task]').forEach((button) => button.addEventListener("click", async () => {
    await window.agentHub.removeQueuedTask(button.dataset.removeTask);
    await refreshTaskQueue();
  }));
}

async function refreshTaskQueue() {
  taskQueueState = await window.agentHub.listQueuedTasks();
  renderTaskQueue();
  return taskQueueState;
}

async function enqueueCurrentTask() {
  const prompt = $("#queuedTaskPrompt")?.value.trim();
  const project = projects.find((item) => item.id === selectedProjectId);
  if (!prompt || !project) return toast("Görev metni ve seçili proje gerekli.", "error");
  try {
    const result = await window.agentHub.enqueueTask({
      prompt,
      projectPath: project.path,
      projectName: project.name,
      engineId: activeEngine,
      model: modelByEngine[activeEngine] || "",
      agentId: selectedAgentId
    });
    taskQueueState = result.state;
    $("#queuedTaskPrompt").value = "";
    renderTaskQueue();
    toast("Görev kuyruğa eklendi.");
    pumpTaskQueue();
  } catch (error) { toast(`Görev eklenemedi: ${error.message}`, "error"); }
}

async function pumpTaskQueue() {
  if (taskQueuePumpActive || isRunning || activeOfficeJobId) return;
  await refreshTaskQueue().catch(() => {});
  if (taskQueueState.paused) return;
  const task = taskQueueState.tasks.find((item) => item.status === "pending");
  if (!task) return;
  taskQueuePumpActive = true;
  try {
    const project = projects.find((item) => pathEquals(item.path, task.projectPath));
    if (!project) throw new Error("Görevin proje kaydı artık mevcut değil.");
    await applySelectedProject(project);
    routingScope = "engine";
    activeEngine = engines.some((engine) => engine.id === task.engineId) ? task.engineId : activeEngine;
    selectedAgentId = agentRegistry.normalizeAgentId(task.agentId);
    if (task.model) modelByEngine[activeEngine] = task.model;
    localStorage.setItem("agenthub:engine", activeEngine);
    contextFlags.plan = false;
    contextFlags.browser = false;
    contextFlags.multiAi = false;
    contextFlags.office = false;
    contextFlags.subagents = false;
    renderContextChips();
    renderEngines();
    updateModelButton();
    $("#prompt").value = task.prompt;
    activeQueuedTaskId = task.id;
    const updated = await window.agentHub.updateQueuedTask({ taskId: task.id, patch: { status: "running", runId: "" } });
    taskQueueState = updated.state;
    renderTaskQueue();
    await runPrompt({ queuedTaskId: task.id });
    if (!activeRun && activeQueuedTaskId === task.id) throw new Error("Görev başlatılamadı.");
  } catch (error) {
    if (task?.id) await window.agentHub.updateQueuedTask({ taskId: task.id, patch: { status: "failed", error: error.message, completedAt: new Date().toISOString() } }).catch(() => {});
    activeQueuedTaskId = "";
    toast(`Kuyruk görevi başlatılamadı: ${error.message}`, "error");
    await refreshTaskQueue().catch(() => {});
  } finally {
    taskQueuePumpActive = false;
  }
}

function pathEquals(left, right) {
  return String(left || "").replaceAll("\\", "/").toLowerCase() === String(right || "").replaceAll("\\", "/").toLowerCase();
}

async function refreshSecurityCenter() {
  const projectPath = $("#projectPath").value;
  const [summary, vault, audit] = await Promise.all([
    window.agentHub.getSecuritySummary(projectPath),
    window.agentHub.listVaultSecrets(),
    window.agentHub.listSecurityAudit(80)
  ]);
  workspaceTrustState = projectPath ? await window.agentHub.getWorkspaceTrust(projectPath) : { trusted: false };
  const cards = [
    ["Çalışma alanı güveni", summary.workspaceTrusted],
    ["Tüm CLI'larda merkezi komut engeli", summary.dangerousCommandsBlocked],
    ["Hassas dosya koruması", summary.sensitiveFilesProtected],
    ["Prompt injection kalkanı", summary.promptInjectionGuard],
    ["Ajan süre/çıktı sınırları", summary.processLimits],
    ["Webview izin ve indirme engeli", summary.webviewPermissionsBlocked],
    ["Eklenti alan adı koruması", summary.externalDomainGuard],
    ["Şifreli kasa", summary.encryptedVaultAvailable],
    ["Log maskeleme", summary.logsRedacted],
    ["Zincirli denetim kaydı", summary.auditTamperEvident],
    ["İmzalı güncelleme doğrulama", summary.signedUpdates],
    ["Renderer sandbox", summary.rendererSandbox]
  ];
  $("#securityStatusGrid").innerHTML = cards.map(([label, enabled]) => `<div class="security-status ${enabled ? "enabled" : "warning"}"><i class="fa-solid ${enabled ? "fa-circle-check" : "fa-triangle-exclamation"}"></i><span>${escapeHtml(label)}</span><strong>${enabled ? "Etkin" : "Kontrol gerekli"}</strong></div>`).join("");
  $("#workspaceTrustStatus").textContent = !projectPath ? "Proje seçilmedi" : workspaceTrustState.trusted ? "Bu klasöre güveniliyor" : "Bu klasör henüz güvenilir değil";
  $("#toggleWorkspaceTrust").disabled = !projectPath;
  $("#toggleWorkspaceTrust").textContent = workspaceTrustState.trusted ? "Güveni kaldır" : "Güven ver";
  $("#vaultSecretList").innerHTML = vault.length ? vault.map((item) => `<article class="control-row"><span class="control-icon"><i class="fa-solid fa-key"></i></span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.hint)} · ${item.updatedAt ? new Date(item.updatedAt).toLocaleString("tr-TR") : ""}</small></div><button class="icon-button danger-text" data-delete-vault="${escapeHtml(item.id)}"><i class="fa-solid fa-trash-can"></i></button></article>`).join("") : '<div class="notification-empty">Kasada özel bir gizli bilgi yok. Sağlayıcı API anahtarları ayrıca otomatik şifrelenir.</div>';
  $$('[data-delete-vault]').forEach((button) => button.addEventListener("click", async () => {
    await window.agentHub.deleteVaultSecret(button.dataset.deleteVault);
    refreshSecurityCenter();
  }));
  $("#securityAuditList").innerHTML = audit.length ? audit.map((item) => `<div class="audit-row"><code>${new Date(item.at).toLocaleString("tr-TR")}</code><strong>${escapeHtml(item.type)}${item.integrity === "invalid" ? " · BÜTÜNLÜK HATASI" : ""}</strong><small>${escapeHtml(JSON.stringify(item.details))}</small></div>`).join("") : '<div class="notification-empty">Henüz güvenlik kaydı yok.</div>';
}

async function toggleWorkspaceTrust() {
  const projectPath = $("#projectPath").value;
  if (!projectPath) return;
  if (workspaceTrustState.trusted) {
    if (!(await askUserConfirmation({ title: "Çalışma alanı güveni kaldırılsın mı?", message: "Bu projede ajan ve terminal çalıştırılamayacak.", confirmLabel: "Güveni kaldır", tone: "warning", eyebrow: "GÜVENLİK", icon: "fa-solid fa-shield-halved" }))) return;
    await window.agentHub.revokeWorkspaceTrust(projectPath);
  } else {
    if (!(await askUserConfirmation({ title: "Bu çalışma alanına güvenilsin mi?", message: "Ajanlar proje içindeki dosyaları okuyabilir ve seçili onay moduna göre değiştirebilir.", note: "Sistem klasörleri, gizli dosyalar ve tehlikeli komutlar yine korunur.", confirmLabel: "Güven ver", tone: "warning", eyebrow: "ÇALIŞMA ALANI GÜVENİ", icon: "fa-solid fa-shield-halved" }))) return;
    await window.agentHub.trustWorkspace(projectPath);
  }
  await refreshSecurityCenter();
}

async function ensureWorkspaceTrusted(projectPath) {
  if (!projectPath) return false;
  const state = await window.agentHub.getWorkspaceTrust(projectPath);
  if (state.trusted) return true;
  const accepted = await askUserConfirmation({
    title: "Bu çalışma alanına güvenilsin mi?",
    message: "Ajanın ve terminalin bu proje klasöründe çalışabilmesi için bir kez güven vermen gerekiyor.",
    note: "Güveni daha sonra Güvenlik Merkezi’nden kaldırabilirsin.",
    confirmLabel: "Güven ver",
    tone: "warning",
    eyebrow: "ÇALIŞMA ALANI",
    icon: "fa-solid fa-shield-halved"
  });
  if (!accepted) return false;
  await window.agentHub.trustWorkspace(projectPath);
  return true;
}

async function persistMcpMarketplaceConfig(nextConfig) {
  userSettings.mcpConfig = nextConfig;
  userSettings.allowMcp = true;
  localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
  setField("settingsAllowMcp", true, true);
  setField("settingsMcpConfig", nextConfig);
  const projectPath = $("#projectPath")?.value || "";
  if (projectPath) {
    if (!(await ensureWorkspaceTrusted(projectPath))) throw new Error("MCP yapılandırması için çalışma alanına güven verilmedi.");
    await window.agentHub.applyProjectMcpConfig({ projectPath, config: nextConfig });
  }
  renderMcpMarketplace();
}

function renderMcpMarketplace() {
  const host = $("#mcpMarketplace");
  if (!host) return;
  const installed = new Set(mcpMarketplace.installedIds(userSettings.mcpConfig));
  const riskLabels = { low: "Düşük risk", medium: "Dosya erişimi", high: "Ağ/tarayıcı erişimi" };
  host.innerHTML = mcpMarketplace.catalog.map((item) => `<article class="mcp-store-card ${installed.has(item.id) ? "installed" : ""}"><div class="mcp-store-head"><span class="control-icon"><i class="fa-solid fa-cube"></i></span><div><strong>${escapeHtml(item.name)}</strong><small>Doğrulanmış yayıncı · ${escapeHtml(item.publisher)} · v${escapeHtml(item.version)}</small></div><em class="risk-${item.risk}">${riskLabels[item.risk]}</em></div><p>${escapeHtml(item.description)}</p><div class="mcp-permissions">${item.permissions.map((permission) => `<span>${escapeHtml(permission)}</span>`).join("")}</div><button class="s-btn ${installed.has(item.id) ? "" : "primary"}" data-mcp-toggle="${item.id}">${installed.has(item.id) ? "Kaldır" : "Ekle"}</button></article>`).join("");
  $$('[data-mcp-toggle]').forEach((button) => button.addEventListener("click", async () => {
    const item = mcpMarketplace.catalog.find((entry) => entry.id === button.dataset.mcpToggle);
    if (!item) return;
    if (installed.has(item.id)) {
      try {
        await persistMcpMarketplaceConfig(mcpMarketplace.removeServer(userSettings.mcpConfig, item.id));
        toast(`${item.name} MCP yapılandırmasından kaldırıldı.`);
      } catch (error) { toast(`MCP kaldırılamadı: ${error.message}`, "error"); }
      return;
    }
    const accepted = await askUserConfirmation({
      title: `${item.name} eklensin mi?`,
      message: `İzinler: ${item.permissions.join(", ")}.`,
      note: item.risk === "high" ? "Bu sunucu ağ veya tarayıcı içeriğine erişebilir. Yalnızca güvendiğin projelerde etkinleştir." : "Sunucu yalnızca ajan çalışırken ve MCP etkin olduğunda kullanılır.",
      confirmLabel: "MCP’yi ekle",
      tone: "warning",
      eyebrow: "MCP MAĞAZASI",
      icon: "fa-solid fa-puzzle-piece"
    });
    if (!accepted) return;
    try {
      await persistMcpMarketplaceConfig(mcpMarketplace.addServer(userSettings.mcpConfig, item.id));
      toast(`${item.name} MCP seçili projeye ve desteklenen CLI yapılandırmalarına eklendi.`);
    } catch (error) { toast(`MCP uygulanamadı: ${error.message}`, "error"); }
  }));
}

function renderPlugins() {
  $("#pluginGrid").innerHTML = plugins.map((plugin) => {
    const connected = connectedPlugins.has(plugin.id);
    let action = "Giriş yap";
    if (!plugin.ready) action = "Yakında";
    else if (plugin.auth === "browser") action = "Bağla";
    else if (connected) action = plugin.auth === "local" ? "Kaldır" : "Bağlı";
    else if (plugin.auth === "local") action = "Yükle";
    return `<article class="plugin-card ${connected ? "connected" : ""} ${plugin.ready ? "" : "soon"}"><span class="plugin-logo"><i class="${plugin.icon}"></i></span><div><h3>${plugin.name}</h3><p>${plugin.description}</p></div><button data-plugin="${plugin.id}" ${plugin.ready ? "" : "disabled"}>${action}</button></article>`;
  }).join("");
  $$('[data-plugin]').forEach((button) => button.addEventListener("click", () => openPluginModal(button.dataset.plugin)));
  updateBrowserAvailability();
}

async function refreshPluginStatus() {
  try {
    const status = await window.agentHub.getPluginStatus();
    for (const plugin of plugins) {
      if (plugin.id === "browser") continue;
      if (plugin.auth === "browser") {
        connectedPlugins.delete(plugin.id);
        continue;
      }
      if (status[plugin.id]) connectedPlugins.add(plugin.id);
      else connectedPlugins.delete(plugin.id);
    }
    localStorage.setItem("agenthub:plugins", JSON.stringify([...connectedPlugins]));
    renderPlugins();
    if (status.cloudflare) refreshCloudflareSummary().catch(() => {});
  } catch (error) { toast(`Eklenti durumları alınamadı: ${error.message}`, "error"); }
}

async function refreshCloudflareSummary() {
  const host = $("#cloudflareSummary");
  if (!host) return;
  if (!connectedPlugins.has("cloudflare")) { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;
  host.innerHTML = '<div class="provider-usage-card loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Cloudflare hesapları alınıyor…</span></div>';
  try {
    const result = await window.agentHub.getCloudflareSummary();
    const zones = result.zones || [];
    host.innerHTML = `<header><span><strong><i class="fa-brands fa-cloudflare"></i> Cloudflare özeti</strong><small>${result.accounts?.length || 0} hesap · ${zones.length} alan adı · salt okunur</small></span><button class="s-btn" type="button" data-refresh-cloudflare><i class="fa-solid fa-rotate"></i> Yenile</button></header><div class="cloudflare-zones">${zones.length ? zones.slice(0, 20).map((zone) => `<div class="cloudflare-zone"><span><strong>${escapeHtml(zone.name)}</strong><small>${escapeHtml(zone.plan?.name || zone.account?.name || "Plan bilinmiyor")}</small></span><em>${escapeHtml(zone.paused ? "Duraklatıldı" : zone.status)}</em></div>`).join("") : '<div class="notification-empty">Bu token ile görünen alan adı yok.</div>'}</div>`;
    host.querySelector("[data-refresh-cloudflare]")?.addEventListener("click", refreshCloudflareSummary);
  } catch (error) {
    host.innerHTML = `<header><span><strong>Cloudflare bilgisi alınamadı</strong><small>${escapeHtml(error.message)}</small></span><button class="s-btn" type="button" data-refresh-cloudflare>Yeniden dene</button></header>`;
    host.querySelector("[data-refresh-cloudflare]")?.addEventListener("click", refreshCloudflareSummary);
  }
}

function renderEngines() {
  const byId = Object.fromEntries(detected.map((item) => [item.id, item]));
  const globalReadyCount = engines.filter((engine) => {
    const info = byId[engine.id] || {};
    return info.installed && info.authenticated && (userSettings.autoProviders || []).includes(engine.id);
  }).length;
  const globalChip = `<button class="engine-chip global-engine-chip ${routingScope === "all" ? "active" : ""} ${globalReadyCount ? "installed authed" : ""}" data-engine="all"><i class="fa-solid fa-shuffle"></i><span class="mini-dot"></span>Tüm AI'lar <small>${globalReadyCount}</small></button>`;
  $("#engineStrip").innerHTML = globalChip + engines.map((engine) => {
    const info = byId[engine.id] || {};
    const ready = info.installed && info.authenticated;
    return `<button class="engine-chip ${routingScope === "engine" && engine.id === activeEngine ? "active" : ""} ${info.installed ? "installed" : ""} ${ready ? "authed" : ""}" data-engine="${engine.id}">${renderEngineLogo(engine)}<span class="mini-dot"></span>${engine.name}</button>`;
  }).join("");
  $("#connectionList").innerHTML = engines.map((engine) => {
    const info = byId[engine.id] || {};
    const installed = Boolean(info.installed);
    const authenticated = Boolean(info.authenticated);
    const detail = info.detail || (installed ? "CLI algılandı" : "CLI henüz bulunamadı");
    const isApiKey = info.loginMode === "api-key" || engine.id === "nvidia";
    const needsCursorAgent = engine.id === "cursor" && /Agent CLI/i.test(detail) && !authenticated;
    const cliReady = installed && !needsCursorAgent;
    const loginLabel = isApiKey
      ? "API Key"
      : engine.login;
    const stateLabel = authenticated
      ? "BAĞLI"
      : !cliReady
        ? "CLI YOK"
        : cliReady
          ? "GİRİŞ YOK"
          : "BULUNAMADI";
    const stateClass = authenticated ? "ready" : cliReady ? "installed" : "";
    const installButton = !cliReady && info.installable !== false
      ? `<button data-install-engine="${engine.id}" title="Resmî ${escapeHtml(engine.name)} CLI kurucusunu başlat">CLI kur</button>`
      : "";
    const loginButton = cliReady
      ? `<button data-login="${engine.id}" title="${escapeHtml(loginLabel)}">${escapeHtml(loginLabel)}</button>`
      : "";
    const optionalApiKeyButton = engine.id === "gemini" || (engine.id === "nvidia" && !cliReady)
      ? `<button data-api-key="${engine.id}" title="${engine.id === "gemini" ? "İsteğe bağlı Gemini" : "NVIDIA"} API anahtarı">API Key</button>`
      : "";
    return `<article class="connection">
      <span class="connection-logo">${renderEngineLogo(engine)}</span>
      <div class="connection-info"><strong>${engine.name}</strong><small>${escapeHtml(detail)}</small></div>
      <span class="connection-state ${stateClass}">${stateLabel}</span>
      <div class="connection-actions">
        ${installButton}
        ${loginButton}
        ${optionalApiKeyButton}
      </div>
    </article>`;
  }).join("");

  $$('[data-engine]').forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.engine === "all") {
      routingScope = "all";
      localStorage.setItem("agenthub:routing-scope", routingScope);
    } else {
      routingScope = "engine";
      activeEngine = button.dataset.engine;
      localStorage.setItem("agenthub:routing-scope", routingScope);
      localStorage.setItem("agenthub:engine", activeEngine);
    }
    updateModelButton();
    renderEffortDropdown();
    renderEngines();
  }));
  $$('[data-login]').forEach((button) => button.addEventListener("click", async () => {
    const engineId = button.dataset.login;
    try {
      if (engineId === "nvidia") return openApiKeyModal(engineId);
      const result = await window.agentHub.loginEngine(engineId);
      if (result?.apiKey) return openApiKeyModal(engineId);
      toast(result?.message || "Giriş penceresi açıldı.");
      setTimeout(() => detectEngines(true), 3500);
    } catch (error) { toast(error.message, "error"); }
  }));
  $$('[data-install-engine]').forEach((button) => button.addEventListener("click", async () => {
    const engineId = button.dataset.installEngine;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Açılıyor…';
    try {
      const result = await window.agentHub.installEngine(engineId);
      toast(result?.message || "CLI kurulumu başlatıldı.");
      [5000, 15000, 30000].forEach((delay) => setTimeout(() => detectEngines(true), delay));
    } catch (error) {
      toast(error.message, "error");
      renderEngines();
    }
  }));
  $$('[data-api-key]').forEach((button) => button.addEventListener("click", () => openApiKeyModal(button.dataset.apiKey)));
}

let apiKeyProvider = "nvidia";
async function openApiKeyModal(providerId = "nvidia") {
  apiKeyProvider = providerId;
  $("#apiKeyModalTitle").textContent = providerId === "nvidia" ? "NVIDIA API Anahtarı" : providerId === "gemini" ? "Gemini API Anahtarı" : providerId === "cloudflare" ? "Cloudflare API Tokeni" : "API Anahtarı";
  $("#apiKeyModalCopy").textContent = providerId === "cloudflare"
    ? "Salt okunur Account ve Zone Read izinli bir API token gir. Token Windows güvenli kasasıyla şifrelenir."
    : providerId === "gemini"
    ? "Anahtar TaxCLI içinde saklanır ve GEMINI_API_KEY olarak Gemini CLI’ye verilir. Google AI Studio / Generative Language API anahtarı kullan."
    : "Anahtar bu bilgisayarda saklanır ve OpenCode kimlik deposuna (auth.json) da yazılır; böylece terminalle aynı şekilde çalışır.";
  $("#apiKeyInput").value = "";
  $("#apiKeyInput").placeholder = providerId === "cloudflare" ? "Cloudflare API token" : providerId === "nvidia" ? "nvapi-…" : "API key";
  try {
    const current = await window.agentHub.getProviderKey(providerId);
    if (current.configured) $("#apiKeyModalCopy").textContent = `Kayıtlı anahtar: ${current.hint}. Yeni değer kaydedersen üzerine yazılır.`;
  } catch { /* ignore */ }
  openModal("apiKeyModal");
  $("#apiKeyInput").focus();
}

async function detectEngines(quiet = false) {
  if (engineDetectionPromise) return engineDetectionPromise;
  const button = $("#refreshEngines");
  button?.classList.add("scanning");
  button?.setAttribute("disabled", "true");
  if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Taranıyor…';
  engineDetectionPromise = (async () => {
    try {
      detected = await window.agentHub.detectEngines();
      // Force model lists to reload (especially Copilot live catalog)
      ["codex", "copilot", "claude", "cursor", "opencode", "nvidia", "gemini"].forEach((id) => { delete availableModels[id]; });
      renderEngines();
      if (!quiet) toast("Bağlantılar yenilendi.");
      return detected;
    } catch (error) {
      toast(`Motorlar taranamadı: ${error.message}`, "error");
      return detected;
    }
  })();
  try {
    return await engineDetectionPromise;
  } finally {
    engineDetectionPromise = null;
    button?.classList.remove("scanning");
    button?.removeAttribute("disabled");
    if (button) button.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Yeniden tara';
  }
}

function updateModelButton() {
  if (routingScope === "all") {
    $("#modelButton").innerHTML = `<i class="fa-solid fa-shuffle"></i> Tüm AI'lar · Auto <i class="fa-solid fa-chevron-down"></i>`;
    return;
  }
  const engineName = engines.find((item) => item.id === activeEngine)?.name || activeEngine;
  const selectedId = modelByEngine[activeEngine] || "";
  const match = normalizeModelEntries(availableModels[activeEngine] || []).find((item) => item.id === selectedId);
  const modelLabel = selectedId === "__auto__" ? "Auto" : match?.label || selectedId || "Varsayılan";
  $("#modelButton").innerHTML = `${escapeHtml(engineName)} · ${escapeHtml(modelLabel)} <i class="fa-solid fa-chevron-down"></i>`;
}

function toolMenuRows() {
  return $$("#toolMenu .tool-menu-row").filter((button) => !button.hidden && !button.disabled);
}

function highlightToolMenuRow(button, scroll = false) {
  $$("#toolMenu .tool-menu-row").forEach((item) => item.classList.toggle("is-highlighted", item === button));
  if (scroll) button?.scrollIntoView({ block: "nearest" });
}

function filterToolMenu() {
  const normalize = (value) => value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
  const query = normalize($("#toolMenuSearch").value.trim());
  $$("#toolMenu .tool-menu-row").forEach((button) => {
    button.hidden = !normalize(button.textContent).includes(query);
  });
  $$("#toolMenu .tool-menu-section").forEach((section) => {
    section.hidden = ![...section.querySelectorAll(".tool-menu-row")].some((button) => !button.hidden);
  });
  $("#toolMenuEmpty").hidden = toolMenuRows().length > 0;
  highlightToolMenuRow(toolMenuRows()[0]);
  $("#toolMenu .tool-menu-scroll").scrollTop = 0;
}

function positionToolMenu() {
  const menu = $("#toolMenu");
  if (!menu.classList.contains("open")) return;
  const composer = $("#toolMenuButton").closest(".composer").getBoundingClientRect();
  const gap = 6, margin = 12;
  const above = composer.top - gap - margin;
  menu.style.width = `${Math.min(composer.width, window.innerWidth - margin * 2)}px`;
  menu.style.maxHeight = `${Math.max(0, Math.min(430, above))}px`;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(margin, Math.min(composer.left, window.innerWidth - bounds.width - margin))}px`;
  menu.style.top = `${Math.max(margin, composer.top - gap - bounds.height)}px`;
}

function positionApprovalMenu() {
  const menu = $("#approvalMenu");
  if (!menu.classList.contains("open")) return;
  const trigger = $("#approvalButton").getBoundingClientRect();
  const gap = 8, margin = 12;
  const above = trigger.top - gap - margin;
  const below = window.innerHeight - trigger.bottom - gap - margin;
  const opensAbove = above >= 230 || above >= below;
  menu.style.width = `${Math.min(310, window.innerWidth - margin * 2)}px`;
  menu.style.maxHeight = `${Math.max(0, opensAbove ? above : below)}px`;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(margin, Math.min(trigger.left, window.innerWidth - bounds.width - margin))}px`;
  menu.style.top = `${Math.max(margin, opensAbove ? trigger.top - gap - bounds.height : trigger.bottom + gap)}px`;
}

function syncToolMenuButton() {
  const open = $("#toolMenu").classList.contains("open");
  $("#toolMenuButton").setAttribute("aria-expanded", String(open));
  $("#toolMenuButton i").className = `fa-solid fa-${open ? "minus" : "plus"}`;
  $("#approvalButton").setAttribute("aria-expanded", String($("#approvalMenu").classList.contains("open")));
}

function toggleMenu(id, force) {
  const menu = $(`#${id}`);
  $$(".popup-menu").forEach((item) => { if (item !== menu) item.classList.remove("open"); });
  closeRunTuningMenu();
  menu.classList.toggle("open", force ?? !menu.classList.contains("open"));
  const toolMenuOpen = $("#toolMenu").classList.contains("open");
  syncToolMenuButton();
  if (id === "approvalMenu") positionApprovalMenu();
  if (id === "toolMenu" && toolMenuOpen) {
    $("#toolMenuSearch").value = "";
    filterToolMenu();
    positionToolMenu();
    $("#toolMenuSearch").focus({ preventScroll: true });
  }
}

function openModal(id) { $(`#${id}`).classList.add("open"); }
function closeModal(id) {
  if (id === "confirmModal" && confirmDialogResolve) {
    finishConfirmDialog(false);
    return;
  }
  $(`#${id}`).classList.remove("open");
  if (id === "multiAiModal") toggleMultiAiDropdown(false);
  if (id === "officeModal") discardOfficeTeamDraft();
}

function onboardingReadyEngines() {
  return detected.filter((item) => item.installed && item.authenticated);
}

function renderOnboarding() {
  const content = $("#onboardingContent");
  if (!content) return;
  $$("[data-onboarding-step]").forEach((item) => {
    const index = Number(item.dataset.onboardingStep);
    item.classList.toggle("active", index === onboardingStep);
    item.classList.toggle("done", index < onboardingStep);
  });
  $("#onboardingEyebrow").textContent = `ADIM ${onboardingStep + 1} / 5`;
  $("#onboardingBack").hidden = onboardingStep === 0;
  $("#onboardingNext").textContent = onboardingStep === 4 ? "Kurulumu tamamla" : "Devam et";
  const selectedProject = projects.find((item) => item.id === selectedProjectId) || null;
  const project = selectedProject || projects[0] || null;
  const ready = onboardingReadyEngines();

  if (onboardingStep === 0) {
    $("#onboardingTitle").textContent = "TaxCLI’ye hoş geldin";
    $("#onboardingDescription").textContent = "AI kodlama araçlarını tek, yerel ve güvenli çalışma alanında hazırlayalım.";
    $("#onboardingHint").textContent = "Yaklaşık 2 dakika";
    content.innerHTML = `<div class="wizard-welcome"><div><h3>Yerel profilin</h3><label class="wizard-field">Görünen ad<input id="onboardingDisplayName" maxlength="60" value="${escapeHtml(userSettings.displayName || "Yerel kullanıcı")}" autocomplete="name" /></label><p class="s-note">Bu ad yalnızca TaxCLI arayüzünde kullanılır; bir hesaba gönderilmez.</p></div><div class="wizard-welcome-card"><span class="wizard-privacy-icon"><i class="fa-solid fa-shield-halved"></i></span><strong>Yerel çalışma alanı</strong><small>Projeler bilgisayarında kalır</small></div></div>`;
  } else if (onboardingStep === 1) {
    $("#onboardingTitle").textContent = "AI motorlarını bağla";
    $("#onboardingDescription").textContent = "Kurulu CLI’leri taradık. En az bir motoru kurup hesabına bağlayabilirsin.";
    $("#onboardingHint").textContent = `${ready.length} motor hazır`;
    const byId = Object.fromEntries(detected.map((item) => [item.id, item]));
    content.innerHTML = `<div class="wizard-engine-list">${engines.map((engine) => {
      const info = byId[engine.id] || {};
      const state = info.installed && info.authenticated ? "Hazır" : info.installed ? "Giriş gerekli" : "CLI yok";
      return `<article class="wizard-engine"><span class="connection-logo">${renderEngineLogo(engine)}</span><div><strong>${escapeHtml(engine.name)}</strong><small>${escapeHtml(info.detail || engine.description || "Resmî CLI")}</small></div><span class="wizard-engine-actions"><em class="wizard-state ${state === "Hazır" ? "ready" : ""}">${state}</em>${!info.installed ? `<button class="s-btn" data-wizard-install="${engine.id}">Kur</button>` : !info.authenticated ? `<button class="s-btn" data-wizard-login="${engine.id}">Bağla</button>` : ""}${["gemini", "nvidia"].includes(engine.id) ? `<button class="s-btn" data-wizard-key="${engine.id}">API Key</button>` : ""}</span></article>`;
    }).join("")}</div>`;
    $$('[data-wizard-install]').forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { const result = await window.agentHub.installEngine(button.dataset.wizardInstall); toast(result.message || "Kurulum başlatıldı."); }
      catch (error) { toast(error.message, "error"); }
      finally { button.disabled = false; setTimeout(() => detectEngines(true).then(renderOnboarding), 2500); }
    }));
    $$('[data-wizard-login]').forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { const result = await window.agentHub.loginEngine(button.dataset.wizardLogin); toast(result.message || "Giriş açıldı."); }
      catch (error) { toast(error.message, "error"); }
      finally { button.disabled = false; setTimeout(() => detectEngines(true).then(renderOnboarding), 3500); }
    }));
    $$('[data-wizard-key]').forEach((button) => button.addEventListener("click", () => openApiKeyModal(button.dataset.wizardKey)));
  } else if (onboardingStep === 2) {
    $("#onboardingTitle").textContent = "İlk projeni seç";
    $("#onboardingDescription").textContent = "Ajanlar yalnızca güvendiğin proje klasöründe çalışır. Klasör seçerken güven kaydı otomatik oluşturulur.";
    $("#onboardingHint").textContent = project ? "Proje hazır" : "Proje gerekli";
    const chooseLabel = selectedProject ? "Başka klasör seç" : project ? "Bu projeyi kullan" : "Klasör seç";
    content.innerHTML = `<div class="wizard-project-card"><i class="fa-regular fa-folder-open"></i><div><strong>${escapeHtml(project?.name || "Henüz proje seçilmedi")}</strong><small>${escapeHtml(project?.path || "Bilgisayarından bir proje klasörü seç")}</small></div><button class="s-btn primary" id="onboardingChooseProject" type="button">${chooseLabel}</button></div><p class="s-note">TaxCLI sistem klasörlerini, gizli anahtarları ve sembolik bağlantıları çalışma kopyalarına taşımaz.</p>`;
    $("#onboardingChooseProject")?.addEventListener("click", async () => {
      if (project && !selectedProject) {
        const result = await window.agentHub.selectProject(project.id);
        await applySelectedProject(result.project);
      } else {
        await addNewProject();
      }
      renderOnboarding();
    });
  } else if (onboardingStep === 3) {
    $("#onboardingTitle").textContent = "Güvenli varsayılanları seç";
    $("#onboardingDescription").textContent = "Bu korumaları daha sonra Güvenlik Merkezi ve Yapılandırma ayarlarından değiştirebilirsin.";
    $("#onboardingHint").textContent = "Önerilen ayarlar seçili";
    const selectedApproval = ["ask", "auto_edit", "plan"].includes(approvalMode) ? approvalMode : "ask";
    const approvalOptions = [
      ["ask", "Her işlemde sor", "fa-hand"],
      ["auto_edit", "Otomatik düzenle", "fa-wand-magic-sparkles"],
      ["plan", "Yalnızca oku", "fa-eye"]
    ];
    content.innerHTML = `<div class="wizard-security-list"><label class="wizard-security-row"><span><strong>Otomatik snapshot</strong><small>Dosya değiştiren her ajan koşusundan önce geri yükleme noktası alır.</small></span><input id="onboardingAutoSnapshot" class="s-switch" type="checkbox" ${userSettings.autoSnapshot !== false ? "checked" : ""} /></label><div class="wizard-security-row wizard-security-choice"><span><strong>İşlem onayı</strong><small>Yeni kurulumda komut ve dosya işlemlerini nasıl ele alacağını seç.</small></span><input id="onboardingApproval" type="hidden" value="${selectedApproval}" /><div class="wizard-choice" role="radiogroup" aria-label="İşlem onayı">${approvalOptions.map(([value, label, icon]) => `<button type="button" role="radio" aria-checked="${value === selectedApproval}" class="${value === selectedApproval ? "selected" : ""}" data-wizard-approval="${value}"><i class="fa-solid ${icon}"></i>${label}</button>`).join("")}</div></div><label class="wizard-security-row"><span><strong>MCP araçları</strong><small>Yalnızca mağazadan onayladığın, sabit sürümlü MCP sunucularına izin ver.</small></span><input id="onboardingMcp" class="s-switch" type="checkbox" ${userSettings.allowMcp ? "checked" : ""} /></label></div>`;
    $$('[data-wizard-approval]').forEach((button) => button.addEventListener("click", () => {
      $("#onboardingApproval").value = button.dataset.wizardApproval;
      $$('[data-wizard-approval]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-checked", String(selected));
      });
    }));
  } else {
    $("#onboardingTitle").textContent = "TaxCLI hazır";
    $("#onboardingDescription").textContent = "Seçimlerini kaydedip güvenli çalışma alanını açacağız.";
    $("#onboardingHint").textContent = ready.length ? "Başlamaya hazır" : "Motoru daha sonra bağlayabilirsin";
    content.innerHTML = `<div class="wizard-finish-card"><div class="wizard-finish-line"><i class="fa-solid fa-user"></i><strong>Profil</strong><span>${escapeHtml(userSettings.displayName || "Yerel kullanıcı")}</span></div><div class="wizard-finish-line"><i class="fa-solid fa-microchip"></i><strong>Hazır motorlar</strong><span>${ready.length ? ready.map((item) => escapeHtml(engines.find((engine) => engine.id === item.id)?.name || item.id)).join(", ") : "Henüz bağlı motor yok"}</span></div><div class="wizard-finish-line"><i class="fa-regular fa-folder"></i><strong>Proje</strong><span>${escapeHtml(project?.path || "Seçilmedi")}</span></div><div class="wizard-finish-line"><i class="fa-solid fa-shield-halved"></i><strong>Koruma</strong><span>${userSettings.autoSnapshot !== false ? "Otomatik snapshot" : "Elle snapshot"} · ${escapeHtml(({ ask: "Her işlemde sor", auto_edit: "Otomatik düzenleme", plan: "Yalnızca oku" })[approvalMode] || "Her işlemde sor")}</span></div></div>`;
  }
}

async function saveOnboardingSecurityStep() {
  const autoSnapshot = $("#onboardingAutoSnapshot");
  const approval = $("#onboardingApproval");
  const mcp = $("#onboardingMcp");
  if (autoSnapshot) userSettings.autoSnapshot = autoSnapshot.checked;
  if (mcp) userSettings.allowMcp = mcp.checked;
  if (approval) await setApprovalMode(approval.value, { skipConfirm: true });
  localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
  applyUserSettings();
}

async function advanceOnboarding() {
  if (onboardingStep === 0) {
    const name = $("#onboardingDisplayName")?.value.trim();
    userSettings.displayName = name || "Yerel kullanıcı";
    localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
    applyUserSettings();
  }
  if (onboardingStep === 2 && !$("#projectPath")?.value) return toast("Devam etmek için bir proje klasörü seçin.", "error");
  if (onboardingStep === 3) await saveOnboardingSecurityStep();
  if (onboardingStep < 4) {
    onboardingStep += 1;
    renderOnboarding();
    return;
  }
  localStorage.setItem("taxcli:onboarding-version", ONBOARDING_VERSION);
  closeModal("onboardingModal");
  toast("Kurulum tamamlandı. TaxCLI hazır.");
}

function maybeStartOnboarding() {
  if (localStorage.getItem("taxcli:onboarding-version") === ONBOARDING_VERSION) return;
  onboardingStep = 0;
  renderOnboarding();
  openModal("onboardingModal");
}

function approvalChangeKind(change = {}) {
  const kind = typeof change.kind === "string" ? change.kind : change.kind?.type;
  return ({ add: "Yeni dosya", delete: "Dosya silme", update: "Dosya düzenleme" })[kind] || "Dosya değişikliği";
}

function showNextAgentApproval() {
  if (activeApprovalRequest || !approvalQueue.length) return;
  activeApprovalRequest = approvalQueue.shift();
  const approval = activeApprovalRequest.approval || {};
  const modeLabels = { ask: "Her işlemde sor", auto_edit: "Otomatik düzenleme", plan: "Plan / yalnızca oku" };
  const requestMode = Object.hasOwn(modeLabels, approval.approvalMode) ? approval.approvalMode : null;
  $("#actionApprovalMode").textContent = modeLabels[requestMode] || "İşlem izni";
  const modeNote = $("#actionApprovalModeNote");
  modeNote.hidden = !requestMode || requestMode === approvalMode;
  modeNote.textContent = modeNote.hidden ? "" : `Bu görev “${modeLabels[requestMode]}” modunda başlatıldı. Menüdeki yeni izin seçimi sonraki görevlere uygulanır.`;
  $("#actionApprovalTitle").textContent = approval.title || "İşlem onayı gerekiyor";
  $("#actionApprovalReason").textContent = approval.reason || "Ajan bu işlemi çalıştırmak için izninizi istiyor.";

  const commandBox = $("#actionApprovalCommand");
  const hasCommand = approval.kind === "command" && Boolean(approval.command);
  commandBox.hidden = !hasCommand;
  $("#actionApprovalCommandText").textContent = hasCommand ? approval.command : "";
  $("#actionApprovalCwd").textContent = hasCommand && approval.cwd ? `Konum: ${approval.cwd}` : "";

  const changes = Array.isArray(approval.changes) ? approval.changes : [];
  const fileBox = $("#actionApprovalFiles");
  fileBox.hidden = approval.kind !== "file-change";
  const list = $("#actionApprovalFileList");
  list.innerHTML = "";
  if (approval.kind === "file-change") {
    const rows = changes.length ? changes : [{ path: "Dosya değişikliği ayrıntısı ajan tarafından hazırlanıyor.", kind: "update" }];
    rows.forEach((change) => {
      const row = document.createElement("div");
      row.className = "approval-file";
      const icon = document.createElement("i");
      icon.className = `fa-solid ${approvalChangeKind(change) === "Dosya silme" ? "fa-trash-can" : approvalChangeKind(change) === "Yeni dosya" ? "fa-file-circle-plus" : "fa-file-pen"}`;
      const path = document.createElement("span");
      path.textContent = change.path || "Dosya";
      const kind = document.createElement("em");
      kind.textContent = approvalChangeKind(change);
      row.append(icon, path, kind);
      list.appendChild(row);
    });
  }

  $("#approveAgentAction").disabled = false;
  $("#denyAgentAction").disabled = false;
  openModal("actionApprovalModal");
  $("#approveAgentAction").focus();
}

function enqueueAgentApproval(payload) {
  if (!payload?.runId || !payload?.requestId) return;
  approvalQueue.push(payload);
  showNextAgentApproval();
}

async function resolveAgentApproval(decision) {
  const pending = activeApprovalRequest;
  if (!pending) return;
  $("#approveAgentAction").disabled = true;
  $("#denyAgentAction").disabled = true;
  try {
    const accepted = await window.agentHub.respondToApproval({
      runId: pending.runId,
      requestId: pending.requestId,
      decision
    });
    if (!accepted) throw new Error("Onay isteği artık etkin değil.");
    if (activeApprovalRequest === pending) {
      closeModal("actionApprovalModal");
      activeApprovalRequest = null;
    }
    if (decision === "accept") toast("İşleme bir kez izin verildi.");
    else toast("İşlem reddedildi.", "error");
    showNextAgentApproval();
  } catch (error) {
    $("#approveAgentAction").disabled = false;
    $("#denyAgentAction").disabled = false;
    toast(error.message, "error");
  }
}

function clearAgentApprovals(runId, requestId = null) {
  for (let i = approvalQueue.length - 1; i >= 0; i -= 1) {
    if (approvalQueue[i].runId === runId && (requestId == null || approvalQueue[i].requestId === requestId)) approvalQueue.splice(i, 1);
  }
  if (activeApprovalRequest?.runId !== runId || (requestId != null && activeApprovalRequest.requestId !== requestId)) return;
  activeApprovalRequest = null;
  closeModal("actionApprovalModal");
  showNextAgentApproval();
}

function openPluginModal(pluginId) {
  const plugin = plugins.find((item) => item.id === pluginId);
  if (!plugin) return;
  if (!plugin.ready) return toast(`${plugin.name} yakında. Şimdilik Tarayıcı, GitHub ve NVIDIA kullanılabilir.`, "error");
  selectedPlugin = plugin;
  $("#pluginModalIcon").innerHTML = `<i class="${plugin.icon}"></i>`;
  $("#pluginModalTitle").textContent = plugin.name;
  $("#pluginModalCopy").textContent = connectedPlugins.has(plugin.id)
    ? `${plugin.name} için gerçek oturum doğrulandı.`
    : plugin.auth === "local" ? "Yerel güvenli tarayıcıyı bu çalışma alanına yükle."
    : plugin.auth === "browser" ? `${plugin.name} sistemindeki varsayılan tarayıcıda açılır. TaxCLI, giriş tamamlanmadan bu eklentiyi bağlı göstermez.`
    : plugin.auth === "opencode-provider" ? "OpenCode'un güvenli provider giriş ekranında NVIDIA API anahtarını bağla."
    : plugin.auth === "cloudflare-token" ? "Salt okunur API tokeniyle hesaplarını, alan adlarını, plan ve nameserver durumunu izle."
    : `${plugin.name} sağlayıcısının gerçek OAuth giriş akışını başlat.`;
  $("#confirmPlugin").textContent = plugin.auth === "browser"
    ? "Tarayıcıda bağla"
    : connectedPlugins.has(plugin.id)
      ? (plugin.auth === "local" ? "Eklentiyi kaldır" : "Durumu yenile")
      : (plugin.auth === "local" ? "Yükle" : plugin.auth === "opencode-provider" ? "NVIDIA API bağla" : plugin.auth === "cloudflare-token" ? "API tokeni bağla" : "Giriş yap");
  openModal("pluginModal");
}

function updateBrowserAvailability() {
  $("#toolPluginItems").innerHTML = plugins
    .filter((plugin) => plugin.ready && plugin.id !== "browser")
    .map((plugin) => `<button class="tool-menu-row tool-plugin-row" data-tool-plugin="${plugin.id}"><i class="${plugin.icon}" aria-hidden="true"></i><span>${escapeHtml(plugin.name)}</span><small>${escapeHtml(plugin.description)}</small></button>`)
    .join("");
  $$("[data-tool-plugin]").forEach((button) => button.addEventListener("click", () => {
    toggleMenu("toolMenu", false);
    const plugin = plugins.find((item) => item.id === button.dataset.toolPlugin);
    if (plugin?.auth === "browser" && connectedPlugins.has(plugin.id)) openBrowserPlugin(plugin);
    else openPluginModal(button.dataset.toolPlugin);
  }));
  if ($("#toolMenu").classList.contains("open")) { filterToolMenu(); positionToolMenu(); }
  renderSettingsPlugins();
}

async function openBrowserPlugin(plugin) {
  if (!plugin?.url) return;
  connectedPlugins.delete(plugin.id);
  localStorage.setItem("agenthub:plugins", JSON.stringify([...connectedPlugins]));
  renderPlugins();
  try {
    await window.agentHub.openExternal(plugin.url);
    toast(`${plugin.name} varsayılan tarayıcında açıldı. Giriş doğrulanmadan “Aç” durumu gösterilmeyecek.`);
  } catch (error) {
    toast(`${plugin.name} açılamadı: ${error.message}`, "error");
  }
}

function updateApprovalLabel() {
  const labels = { ask: "Her işlemde sor", auto_edit: "Düzenlemeleri onayla", plan: "Plan / yalnızca oku" };
  $("#approvalLabel").textContent = labels[approvalMode] || labels.ask;
  $("#approvalButton")?.classList.toggle("active-mode", approvalMode === "plan" || contextFlags.plan);
  $$(".approval-option").forEach((btn) => {
    const selected = btn.dataset.approval === approvalMode;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-checked", String(selected));
  });
}

const modelPresets = {
  // Codex models come exclusively from the connected CLI/account's model/list.
  codex: [],
  opencode: [],
  cursor: ["auto"],
  copilot: [
    { id: "auto", label: "Auto · Copilot seçer" },
    { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "mai-code-1-flash", label: "MAI Code 1 Flash" }
  ],
  claude: [
    { id: "opus", label: "Opus · hesabındaki en güncel sürüm" },
    { id: "sonnet", label: "Sonnet · hesabındaki en güncel sürüm" },
    { id: "haiku", label: "Haiku · hesabındaki en güncel sürüm" },
    { id: "fable", label: "Fable · erişim varsa" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
  ],
  gemini: [
    { id: "flash-lite", label: "Flash Lite · Tasarruf" },
    { id: "flash", label: "Flash · Hızlı" },
    { id: "pro", label: "Pro · Kalite" }
  ],
  nvidia: []
};

function normalizeModelEntries(list = []) {
  return list.map((item) => {
    if (typeof item === "string") return { id: item, label: item };
    const id = String(item?.id || item?.value || "").trim();
    if (!id) return null;
    return { id, label: String(item.label || item.name || id).trim() || id };
  }).filter(Boolean);
}

function normalizeAutoModelSelection(value) {
  const selected = String(value || "").trim();
  return /^(?:auto|__auto__)$/i.test(selected) ? "" : selected;
}

function modelOptionsWithoutAuto(models = []) {
  return normalizeModelEntries(models).filter((model) => !/^(?:auto|__auto__)$/i.test(model.id));
}

function renderModelList(query = "") {
  const models = normalizeModelEntries(availableModels[activeEngine] || modelPresets[activeEngine] || []);
  const q = query.toLowerCase().trim();
  const filtered = models.filter((model) => {
    if (!q) return true;
    return model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q);
  });
  const selected = modelByEngine[activeEngine] || "";
  const rows = [
    { id: "__auto__", label: `Auto · ${modelRouter.byId[routingPolicy]?.name || "Dengeli"}`, description: "Bu motor içindeki uygun modeli TaxCLI seçer" },
    { id: "", label: "Sağlayıcı varsayılanı", description: "CLI'nin varsayılan modelini kullanır" },
    ...filtered
  ];
  $("#modelList").innerHTML = rows.map((model) => {
    const failedAt = unavailableModels[model.id] || 0;
    const temporarilyUnavailable = model.id && Date.now() - failedAt < 30 * 60 * 1000;
    const isSelected = selected === model.id;
    const showId = model.id && model.label && model.label !== model.id;
    return `<button data-model-value="${escapeHtml(model.id)}" class="${isSelected ? "selected" : ""}" ${temporarilyUnavailable ? "disabled" : ""} title="${escapeHtml(model.id || "varsayılan")}"><i class="fa-solid ${temporarilyUnavailable ? "fa-triangle-exclamation" : isSelected ? "fa-check" : model.id === "__auto__" ? "fa-wand-magic-sparkles" : "fa-circle"}"></i><span class="model-option-text"><strong>${escapeHtml(model.label || model.id || "Varsayılan model")}</strong>${model.description ? `<small>${escapeHtml(model.description)}</small>` : showId ? `<small>${escapeHtml(model.id)}</small>` : ""}${temporarilyUnavailable ? "<small>yanıt vermedi</small>" : ""}</span></button>`;
  }).join("");
  $$("[data-model-value]").forEach((button) => button.addEventListener("click", () => {
    modelByEngine[activeEngine] = button.dataset.modelValue;
    localStorage.setItem("agenthub:models", JSON.stringify(modelByEngine));
    updateModelButton();
    renderEffortDropdown();
    $("#modelDropdown").classList.remove("open");
  }));
}

async function toggleModelDropdown() {
  const dropdown = $("#modelDropdown");
  if (dropdown.classList.contains("open")) return dropdown.classList.remove("open");
  closeRunTuningMenu();
  dropdown.classList.add("open");
  $("#modelSearch").value = "";
  $("#modelSearch")?.closest(".model-search")?.toggleAttribute("hidden", routingScope === "all");
  if (routingScope === "all") {
    $("#modelList").innerHTML = `<div class="model-empty"><strong>Tüm AI'lar · Auto</strong><br>TaxCLI, izin verdiğiniz bağlı motor ve modeller arasından <b>${escapeHtml(modelRouter.byId[routingPolicy]?.name || "Dengeli")}</b> politikasına göre seçim yapacak.<br><br>Belirli bir model seçmek için yukarıdan önce bir motoru kilitleyin.</div>`;
    dropdown.classList.add("open");
    return;
  }
  $("#modelList").innerHTML = '<div class="model-loading"><i class="fa-solid fa-spinner fa-spin"></i> Modeller yükleniyor…</div>';
  if (["codex", "opencode", "nvidia"].includes(activeEngine)) delete availableModels[activeEngine];
  if (!availableModels[activeEngine]) {
    try {
      if (["codex", "opencode", "nvidia", "cursor", "copilot", "claude", "gemini"].includes(activeEngine)) {
        availableModels[activeEngine] = await window.agentHub.listModels(activeEngine);
        // invalidate stale wrong-shape caches (e.g. unfiltered chat models)
        if (activeEngine === "copilot") {
          localStorage.setItem("agenthub:copilot-model-cache-v4", JSON.stringify(availableModels[activeEngine]));
          localStorage.removeItem("agenthub:copilot-model-cache");
          localStorage.removeItem("agenthub:copilot-model-cache-v2");
          localStorage.removeItem("agenthub:copilot-model-cache-v3");
        } else {
          localStorage.setItem(`agenthub:${activeEngine}-model-cache`, JSON.stringify(availableModels[activeEngine]));
        }
      } else {
        availableModels[activeEngine] = modelPresets[activeEngine] || [];
      }
    } catch (error) {
      if (["codex", "opencode", "nvidia"].includes(activeEngine)) {
        $("#modelList").innerHTML = `<div class="model-empty">${escapeHtml(error.message)}<br>Bağlantıyı kontrol edip model menüsünü yeniden açın.</div>`;
        return;
      }
      let cached = [];
      try {
        cached = JSON.parse(
          localStorage.getItem(activeEngine === "copilot" ? "agenthub:copilot-model-cache-v4" : `agenthub:${activeEngine}-model-cache`)
          || localStorage.getItem(`agenthub:${activeEngine}-model-cache`)
          || "[]"
        );
      } catch { cached = []; }
      if (!cached.length && modelPresets[activeEngine]?.length) cached = modelPresets[activeEngine];
      if (!cached.length) {
        $("#modelList").innerHTML = `<div class="model-empty">${escapeHtml(error.message)}</div>`;
        return;
      }
      availableModels[activeEngine] = cached;
      toast("Canlı model listesi alınamadı; son başarılı liste gösteriliyor.", "error");
    }
  }
  renderModelList();
  $("#modelSearch").focus();
}

const shortcutDefinitions = [
  { id: "newChat", label: "Yeni sohbet", detail: "Aktif projede boş sohbet aç" },
  { id: "focusPrompt", label: "Prompt alanına git", detail: "Yazma alanını odakla" },
  { id: "toggleTerminal", label: "Terminali aç / kapat", detail: "Proje terminalini göster" },
  { id: "toggleSubagents", label: "Alt ajan modunu aç / kapat", detail: "Takım orkestrasyonunu etkinleştir" },
  { id: "openSettings", label: "Ayarları aç", detail: "Kullanıcı ayarlarına git" },
  { id: "openNotifications", label: "Bildirim merkezini aç", detail: "Son görev ve hata bildirimleri" }
];

function shortcutFromEvent(event) {
  const key = event.code === "Backquote" ? "`" : event.code === "Comma" ? "," : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", key].filter(Boolean).join("+");
}

function renderShortcutSettings() {
  const host = $("#shortcutList");
  if (!host) return;
  host.innerHTML = shortcutDefinitions.map((item) => `<div class="shortcut-row"><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><button class="shortcut-capture" type="button" data-shortcut-capture="${item.id}">${escapeHtml(userSettings.shortcuts[item.id] || "Atanmamış")}</button><button class="shortcut-clear" type="button" data-shortcut-clear="${item.id}" title="Kısayolu kaldır"><i class="fa-solid fa-xmark"></i></button></div>`).join("");
  $$('[data-shortcut-capture]').forEach((button) => button.addEventListener("click", () => {
    button.classList.add("recording");
    button.textContent = "Tuşlara bas…";
    button.focus();
  }));
  if ($("#newTaskShortcut")) $("#newTaskShortcut").textContent = (userSettings.shortcuts.newChat || "—").replaceAll("+", " + ");
  if ($("#terminalShortcut")) $("#terminalShortcut").textContent = userSettings.shortcuts.toggleTerminal || "—";
  if ($("#subagentsShortcut")) $("#subagentsShortcut").textContent = userSettings.shortcuts.toggleSubagents || "—";
}

function persistShortcutSettings() {
  localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
  renderShortcutSettings();
}

function toggleNotificationDrawer(force) {
  const drawer = $("#notificationDrawer");
  if (!drawer) return;
  const open = typeof force === "boolean" ? force : drawer.hidden;
  drawer.hidden = !open;
  $("#notificationButton")?.classList.toggle("active", open);
  if (open) {
    notifications.forEach((item) => { item.read = true; });
    persistNotifications();
    renderNotifications();
  }
}

function applyUserSettings() {
  const defaultAgentSelect = $("#settingsDefaultAgent");
  if (defaultAgentSelect && !defaultAgentSelect.options.length) {
    defaultAgentSelect.innerHTML = agentProfiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)}</option>`).join("");
  }
  const autoProvidersHost = $("#settingsAutoProviders");
  if (autoProvidersHost) {
    const enabled = new Set(userSettings.autoProviders || []);
    autoProvidersHost.innerHTML = engines.map((engine) => `<label class="auto-provider-option"><input type="checkbox" data-auto-provider="${engine.id}" ${enabled.has(engine.id) ? "checked" : ""}><span>${renderEngineLogo(engine)}${escapeHtml(engine.name)}</span></label>`).join("");
    $$('[data-auto-provider]').forEach((checkbox) => checkbox.addEventListener("change", () => collectAndSaveSettings(false)));
  }
  setField("settingsDisplayName", userSettings.displayName);
  setField("settingsKeepHistory", userSettings.keepHistory, true);
  setField("settingsLocalHistory", userSettings.localHistory, true);
  setField("settingsHomepage", userSettings.homepage);
  setField("settingsTips", userSettings.tips, true);
  setField("settingsWindowRestore", userSettings.windowRestore);
  setField("settingsSystemNotifications", userSettings.systemNotifications, true);
  setField("settingsInAppNotifications", userSettings.inAppNotifications, true);
  setField("settingsWarningNotifications", userSettings.warningNotifications, true);
  setField("settingsTrayIcon", userSettings.trayIcon, true);
  setField("settingsCompletionSound", userSettings.completionSound, true);
  setField("settingsTheme", userSettings.theme);
  setField("settingsCompactSidebar", userSettings.compactSidebar, true);
  setField("settingsRestoreProject", userSettings.restoreProject, true);
  setField("settingsAutoMemory", userSettings.autoMemory, true);
  setField("settingsDefaultAgent", userSettings.defaultAgent);
  setField("settingsDefaultRoutingScope", userSettings.defaultRoutingScope);
  setField("settingsDefaultRoutingPolicy", userSettings.defaultRoutingPolicy);
  setField("settingsDefaultEngine", userSettings.defaultEngine);
  setField("settingsDefaultApproval", userSettings.defaultApproval);
  setField("settingsParallelRuns", userSettings.parallelRuns, true);
  setField("settingsAutoSnapshot", userSettings.autoSnapshot, true);
  setField("settingsSubagentsEnabled", userSettings.subagentsEnabled, true);
  setField("settingsVisionWarnings", userSettings.visionWarnings, true);
  setField("settingsUseWorktrees", userSettings.useWorktrees, true);
  setField("settingsWorktreeBase", userSettings.worktreeBase);
  setField("settingsRulesText", userSettings.rulesText);
  setField("settingsSkillsPaths", userSettings.skillsPaths);
  setField("settingsAllowShell", userSettings.allowShell, true);
  setField("settingsAllowMcp", userSettings.allowMcp, true);
  setField("settingsMcpConfig", userSettings.mcpConfig);
  setField("settingsBrowserAutoPanel", userSettings.browserAutoPanel, true);
  setField("settingsUseMemory", userSettings.useMemory, true);
  setField("settingsIndexIgnore", userSettings.indexIgnore, true);
  setField("settingsDebugStream", userSettings.debugStream, true);
  setField("settingsExperimentalEffort", userSettings.experimentalEffort, true);
  setField("settingsBetaBadge", userSettings.betaBadge, true);
  const teamSelect = $("#settingsSubagentTeam");
  if (teamSelect) {
    teamSelect.innerHTML = officeTeams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("");
    teamSelect.value = officeTeams.some((team) => team.id === userSettings.subagentTeamId) ? userSettings.subagentTeamId : activeOfficeTeamId;
  }
  renderShortcutSettings();

  const initials = initialsForName(userSettings.displayName);
  $("#profileName").textContent = userSettings.displayName;
  $("#profileAvatar").textContent = initials;
  const avatarLg = $("#profileAvatarLg");
  if (avatarLg) avatarLg.textContent = initials;
  const preview = $("#profileDisplayPreview");
  if (preview) preview.textContent = userSettings.displayName;
  const handle = $("#profileHandlePreview");
  if (handle) {
    const slug = String(userSettings.displayName || "yerel").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18) || "yerel";
    handle.textContent = `@${slug}`;
  }
  $$(".settings-user-name").forEach((element) => { element.textContent = userSettings.displayName; });
  $$(".settings-avatar").forEach((element) => { element.textContent = initials; });
  if ($("#browserUrl") && !isBrowserPaneOpen() && !contextFlags.browser) {
    const cur = $("#browserUrl").value?.trim() || "";
    if (!cur || cur === "https://www.google.com" || cur === "about:blank") {
      $("#browserUrl").value = userSettings.homepage || "https://www.google.com";
    }
  }

  applyTheme(userSettings.theme);
  document.body.classList.toggle("compact-sidebar", Boolean(userSettings.compactSidebar));
  document.body.classList.toggle("beta-badge", Boolean(userSettings.betaBadge));
  if (!userSettings.browserAutoPanel) {
    contextFlags.browser = false;
    closeBrowserPane();
    renderContextChips();
  }
  const tipEl = $("#heroTip");
  if (tipEl) tipEl.hidden = !userSettings.tips;
  window.agentHub.configureApp?.({ trayIcon: Boolean(userSettings.trayIcon) })?.catch(() => { /* Optional on older preload versions. */ });
  refreshUsageUi();
  renderSettingsPlugins();
  renderMcpMarketplace();
}

function collectAndSaveSettings(showConfirmation = true) {
  const val = (id, fallback = "") => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    if (el.type === "checkbox") return el.checked;
    return el.value;
  };
  const next = {
    displayName: String(val("settingsDisplayName", "Yerel kullanıcı")).trim() || "Yerel kullanıcı",
    keepHistory: Boolean(val("settingsKeepHistory", true)),
    localHistory: Boolean(val("settingsLocalHistory", true)),
    homepage: String(val("settingsHomepage", "https://www.google.com")).trim() || "https://www.google.com",
    tips: Boolean(val("settingsTips", true)),
    windowRestore: String(val("settingsWindowRestore", "default")),
    systemNotifications: Boolean(val("settingsSystemNotifications", true)),
    inAppNotifications: Boolean(val("settingsInAppNotifications", true)),
    warningNotifications: Boolean(val("settingsWarningNotifications", false)),
    trayIcon: Boolean(val("settingsTrayIcon", true)),
    completionSound: Boolean(val("settingsCompletionSound", false)),
    theme: String(val("settingsTheme", "dark")),
    compactSidebar: Boolean(val("settingsCompactSidebar", false)),
    restoreProject: Boolean(val("settingsRestoreProject", true)),
    autoMemory: Boolean(val("settingsAutoMemory", true)),
    defaultAgent: agentRegistry.normalizeAgentId(val("settingsDefaultAgent", "auto")),
    defaultRoutingScope: modelRouter.normalizeScope(val("settingsDefaultRoutingScope", "engine")),
    defaultRoutingPolicy: modelRouter.normalizePolicy(val("settingsDefaultRoutingPolicy", "balanced")),
    autoProviders: $$('[data-auto-provider]:checked').map((checkbox) => checkbox.dataset.autoProvider),
    defaultEngine: String(val("settingsDefaultEngine", "codex")),
    defaultApproval: String(val("settingsDefaultApproval", "ask")),
    parallelRuns: Boolean(val("settingsParallelRuns", false)),
    autoSnapshot: Boolean(val("settingsAutoSnapshot", true)),
    subagentsEnabled: Boolean(val("settingsSubagentsEnabled", true)),
    subagentTeamId: String(val("settingsSubagentTeam", activeOfficeTeamId)),
    visionWarnings: Boolean(val("settingsVisionWarnings", true)),
    useWorktrees: Boolean(val("settingsUseWorktrees", false)),
    worktreeBase: String(val("settingsWorktreeBase", "main")).trim() || "main",
    rulesText: String(val("settingsRulesText", "")),
    skillsPaths: String(val("settingsSkillsPaths", "")),
    allowShell: Boolean(val("settingsAllowShell", true)),
    allowMcp: Boolean(val("settingsAllowMcp", false)),
    mcpConfig: String(val("settingsMcpConfig", "")),
    browserAutoPanel: Boolean(val("settingsBrowserAutoPanel", true)),
    useMemory: Boolean(val("settingsUseMemory", true)),
    indexIgnore: Boolean(val("settingsIndexIgnore", true)),
    debugStream: Boolean(val("settingsDebugStream", false)),
    experimentalEffort: Boolean(val("settingsExperimentalEffort", true)),
    betaBadge: Boolean(val("settingsBetaBadge", false)),
    shortcuts: Object.assign({}, defaultShortcuts, userSettings.shortcuts || {})
  };
  try {
    const parsed = new URL(next.homepage);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    if (showConfirmation) toast("Tarayıcı ana sayfası geçerli bir HTTP/HTTPS adresi olmalı.", "error");
    return false;
  }
  const previousSettings = userSettings;
  userSettings = next;
  localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
  if (previousSettings.defaultAgent !== next.defaultAgent) {
    selectedAgentId = next.defaultAgent;
    localStorage.setItem("agenthub:agent", selectedAgentId);
    renderAgentSelector();
  }
  if (previousSettings.defaultRoutingScope !== next.defaultRoutingScope) {
    routingScope = next.defaultRoutingScope;
    localStorage.setItem("agenthub:routing-scope", routingScope);
    renderEngines();
    updateModelButton();
  }
  if (previousSettings.defaultRoutingPolicy !== next.defaultRoutingPolicy) {
    routingPolicy = next.defaultRoutingPolicy;
    localStorage.setItem("agenthub:routing-policy", routingPolicy);
    renderRoutingPolicySelector();
    updateModelButton();
  }
  if (previousSettings.defaultEngine !== next.defaultEngine) {
    activeEngine = next.defaultEngine;
    localStorage.setItem("agenthub:engine", activeEngine);
    updateModelButton();
    renderEffortDropdown();
    renderEngines();
  }
  if (previousSettings.autoProviders.join("|") !== next.autoProviders.join("|")) {
    renderEngines();
    updateModelButton();
  }
  if (previousSettings.defaultApproval !== next.defaultApproval) {
    setApprovalMode(next.defaultApproval, { skipConfirm: true });
  }
  const enabledDesktopNotification = (!previousSettings.systemNotifications && next.systemNotifications)
    || (!previousSettings.warningNotifications && next.warningNotifications);
  if (enabledDesktopNotification && window.Notification?.permission === "default") {
    window.Notification.requestPermission()?.catch(() => { /* Permission is optional. */ });
  }
  if (!previousSettings.autoMemory && next.autoMemory && $("#projectPath").value) {
    createMissingProjectMemory(projects.find((project) => project.id === selectedProjectId), false);
  }
  applyUserSettings();
  if (showConfirmation) toast("Kullanıcı ayarları kaydedildi.");
  return true;
}

function updateSidebarConversation(projectId, conversationId, action) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return;
  const conversation = (conversationsByProject.get(baseProjectKey(project.path)) || []).find((item) => item.id === conversationId);
  if (!conversation) return;
  if (action === "archive" && projectRuns.has(projectKey(project.path, conversationId))) {
    toast("Çalışan sohbeti arşivlemeden önce görevi durdurun.", "error");
    return;
  }
  if (action === "pin") conversation.pinned = !conversation.pinned;
  else if (action === "archive") conversation.archived = !conversation.archived;
  else return;
  persistConversationState(project.path);
  renderProjects();
  const focusTarget = action === "pin"
    ? $$('[data-pin-project-conversation]').find((button) => button.dataset.pinProjectConversation === projectId && button.dataset.conversationId === conversationId)
    : $$('[data-toggle-conversation-archive]').find((button) => button.dataset.toggleConversationArchive === projectId);
  (focusTarget || $$('[data-project-id]').find((button) => button.dataset.projectId === projectId))?.focus({ preventScroll: true });
}

async function performSidebarNavigation(projectId, conversationId = "", createNew = false) {
  try {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    if (project.id !== selectedProjectId) {
      const result = await window.agentHub.selectProject(project.id);
      await applySelectedProject(result.project);
    }
    if (createNew) {
      collapsedProjectIds.delete(String(project.id));
      localStorage.setItem("agenthub:collapsed-projects", JSON.stringify([...collapsedProjectIds]));
      await createConversation();
    } else if (conversationId) {
      await activateConversation(conversationId);
    }
  } catch (error) {
    toast(error.message, "error");
  }
}

async function openSidebarConversation(projectId, conversationId = "", createNew = false) {
  pendingSidebarNavigation = { projectId, conversationId, createNew };
  if (sidebarNavigationBusy) return;
  sidebarNavigationBusy = true;
  try {
    while (pendingSidebarNavigation) {
      const next = pendingSidebarNavigation;
      pendingSidebarNavigation = null;
      await performSidebarNavigation(next.projectId, next.conversationId, next.createNew);
    }
  } finally {
    sidebarNavigationBusy = false;
  }
}

function toggleProjectDropdown(projectId) {
  const id = String(projectId || "");
  if (!id) return;
  if (collapsedProjectIds.has(id)) collapsedProjectIds.delete(id);
  else collapsedProjectIds.add(id);
  localStorage.setItem("agenthub:collapsed-projects", JSON.stringify([...collapsedProjectIds]));
  renderProjects();
}

async function deleteProjectConversation(projectId, conversationId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project || !conversationId) return;
  const key = projectKey(project.path, conversationId);
  if (projectRuns.has(key)) return toast("Çalışan sohbeti silmeden önce görevi durdurun.", "error");
  const items = conversationsByProject.get(baseProjectKey(project.path)) || [];
  const target = items.find((item) => item.id === conversationId);
  if (!target || !(await askUserConfirmation({
    title: `“${target.title}” silinsin mi?`,
    message: "Bu sohbetin mesajları ve yerel geçmiş kaydı kaldırılacak.",
    note: "Proje dosyalarında yapılan değişiklikler geri alınmaz.",
    confirmLabel: "Sohbeti sil",
    tone: "danger",
    eyebrow: "SOHBETİ SİL",
    icon: "fa-regular fa-message"
  }))) return;

  try {
    localStorage.removeItem(historyKey(project.path, conversationId));
    parkedConversations.delete(key);
    await window.agentHub.clearHistoryFile({ projectPath: project.path, conversationId });
    const remaining = items.filter((item) => item.id !== conversationId);
    conversationsByProject.set(baseProjectKey(project.path), remaining);
    const wasActive = activeConversationId(project.path) === conversationId;

    if (wasActive) {
      if (remaining.length) {
        activeConversationByProject.set(baseProjectKey(project.path), remaining[0].id);
        window.agentHub.setActiveHistoryConversation?.({ projectPath: project.path, conversationId: remaining[0].id }).catch(() => {});
      } else {
        activeConversationByProject.delete(baseProjectKey(project.path));
      }
      if (project.id === selectedProjectId) {
        $("#conversation").innerHTML = "";
        $("#workspaceView").classList.remove("has-messages");
        activeRun = null;
        activeAssistant = null;
        if (remaining.length) await restoreConversation(project.path, remaining[0].id);
        else await createConversation("Yeni sohbet", { skipPark: true });
      }
    }
    persistConversationState(project.path);
    renderConversations();
    toast("Sohbet silindi.");
  } catch (error) {
    toast(`Sohbet silinemedi: ${error.message}`, "error");
  }
}

function closeProjectContextMenu(restoreFocus = false) {
  $("#projectContextMenu").classList.remove("open");
  contextProjectBounds = null;
  if (restoreFocus && contextProjectAnchor?.isConnected) contextProjectAnchor.focus({ preventScroll: true });
}

function openProjectContextMenu(event, button) {
  event.preventDefault(); event.stopPropagation();
  contextProjectId = button.dataset.projectId; contextProjectAnchor = button;
  const menu = $("#projectContextMenu");
  menu.classList.add("open");
  const anchor = button.getBoundingClientRect();
  contextProjectBounds = { top: anchor.top, left: anchor.left };
  const keyboard = event.clientX === 0 && event.clientY === 0;
  const width = menu.offsetWidth, height = menu.offsetHeight, gap = 8;
  const left = keyboard ? anchor.right : event.clientX;
  const top = keyboard ? anchor.top : event.clientY;
  menu.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - width - gap))}px`;
  menu.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`;
  menu.querySelector("button")?.focus({ preventScroll: true });
}

function renderProjects() {
  if (!projects.length) {
    $("#projectList").innerHTML = '<div class="project-empty">Henüz proje eklenmedi</div>';
    renderSettingsProjects();
    return;
  }
  $("#projectList").innerHTML = projects.map((project) => {
    const running = [...projectRuns.keys()].some((key) => key.startsWith(`${baseProjectKey(project.path)}::`));
    const selected = project.id === selectedProjectId;
    const collapsed = collapsedProjectIds.has(String(project.id));
    const activeId = activeConversationId(project.path);
    const conversations = conversationsByProject.get(baseProjectKey(project.path)) || [];
    const archivedCount = conversations.filter((conversation) => conversation.archived).length;
    const archiveExpanded = expandedConversationArchives.has(project.id);
    const renderSession = (conversation) => {
      const sessionRunning = projectRuns.has(projectKey(project.path, conversation.id));
      const active = selected && conversation.id === activeId;
      const pinLabel = conversation.pinned ? "Sabitlemeyi kaldır" : "Sohbeti sabitle";
      const archiveLabel = conversation.archived ? "Arşivden çıkar" : "Sohbeti arşivle";
      const controls = conversation.archived
        ? `<button class="conversation-action conversation-delete" data-delete-project-conversation="${escapeHtml(project.id)}" data-delete-conversation-id="${escapeHtml(conversation.id)}" title="Sohbeti sil" aria-label="Sohbeti sil"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>`
        : `<button class="conversation-action ${conversation.pinned ? "is-pinned" : ""}" data-pin-project-conversation="${escapeHtml(project.id)}" data-conversation-id="${escapeHtml(conversation.id)}" title="${pinLabel}" aria-label="${pinLabel}" aria-pressed="${Boolean(conversation.pinned)}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i></button>`;
      return `<div class="conversation-row ${active ? "active" : ""} ${sessionRunning ? "running" : ""} ${conversation.pinned ? "pinned" : ""}"><button class="conversation-item ${active ? "active" : ""} ${sessionRunning ? "running" : ""}" data-project-conversation="${escapeHtml(project.id)}" data-conversation-id="${escapeHtml(conversation.id)}" title="${escapeHtml(conversation.title)}" ${active ? 'aria-current="true"' : ""}><span>${escapeHtml(conversation.title)}</span></button><i class="session-dot" aria-hidden="true"></i><div class="conversation-actions">${controls}<button class="conversation-action" data-archive-project-conversation="${escapeHtml(project.id)}" data-conversation-id="${escapeHtml(conversation.id)}" title="${archiveLabel}" aria-label="${archiveLabel}"><i class="fa-solid ${conversation.archived ? "fa-box-open" : "fa-box-archive"}" aria-hidden="true"></i></button></div></div>`;
    };
    const sessions = conversations.filter((conversation) => !conversation.archived)
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      .map(renderSession).join("");
    const archive = archivedCount ? `<button class="conversation-archive-toggle" data-toggle-conversation-archive="${escapeHtml(project.id)}" aria-expanded="${archiveExpanded}"><i class="fa-solid fa-chevron-${archiveExpanded ? "down" : "right"}" aria-hidden="true"></i>Arşivlenenler <span>${archivedCount}</span></button>${archiveExpanded ? conversations.filter((conversation) => conversation.archived).map(renderSession).join("") : ""}` : "";
    return `<div class="project-group ${selected ? "active" : ""} ${running ? "running" : ""} ${collapsed ? "collapsed" : ""}">
      <div class="project-row">
        <button class="project ${selected ? "active" : ""}" data-project-id="${escapeHtml(project.id)}" title="${escapeHtml(project.path)}"><i class="fa-regular fa-folder${collapsed ? "" : "-open"} folder-icon" aria-hidden="true"></i><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.path)}</small></span></button>
        <div class="project-row-actions"><button class="project-toggle" data-toggle-project="${escapeHtml(project.id)}" title="${collapsed ? "Sohbetleri göster" : "Sohbetleri gizle"}" aria-label="${collapsed ? "Sohbetleri göster" : "Sohbetleri gizle"}" aria-expanded="${!collapsed}"><i class="fa-solid fa-chevron-${collapsed ? "right" : "down"} project-chevron" aria-hidden="true"></i></button>
        <button class="project-new-chat" data-new-project-conversation="${escapeHtml(project.id)}" title="Bu projede yeni sohbet" aria-label="Bu projede yeni sohbet"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></div>
      </div>
      <div class="conversation-list">${sessions}${archive}</div>
    </div>`;
  }).join("");
  $$('[data-project-id]').forEach((button) => button.addEventListener("click", async () => {
    await openSidebarConversation(button.dataset.projectId);
  }));
  $$('[data-project-conversation]').forEach((button) => button.addEventListener("click", async () => {
    await openSidebarConversation(button.dataset.projectConversation, button.dataset.conversationId);
  }));
  $$('[data-toggle-project]').forEach((button) => button.addEventListener("click", () => toggleProjectDropdown(button.dataset.toggleProject)));
  $$('[data-pin-project-conversation]').forEach((button) => button.addEventListener("click", () => {
    updateSidebarConversation(button.dataset.pinProjectConversation, button.dataset.conversationId, "pin");
  }));
  $$('[data-archive-project-conversation]').forEach((button) => button.addEventListener("click", () => {
    updateSidebarConversation(button.dataset.archiveProjectConversation, button.dataset.conversationId, "archive");
  }));
  $$('[data-toggle-conversation-archive]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.toggleConversationArchive;
    if (expandedConversationArchives.has(id)) expandedConversationArchives.delete(id);
    else expandedConversationArchives.add(id);
    renderProjects();
    $$('[data-toggle-conversation-archive]').find((item) => item.dataset.toggleConversationArchive === id)?.focus({ preventScroll: true });
  }));
  $$('[data-delete-project-conversation]').forEach((button) => button.addEventListener("click", async () => {
    await deleteProjectConversation(button.dataset.deleteProjectConversation, button.dataset.deleteConversationId);
  }));
  $$('[data-new-project-conversation]').forEach((button) => button.addEventListener("click", async () => {
    await openSidebarConversation(button.dataset.newProjectConversation, "", true);
  }));
  $$('[data-project-id]').forEach((button) => button.addEventListener("contextmenu", (event) => {
    openProjectContextMenu(event, button);
  }));
  renderSettingsProjects();
}

function renderSettingsProjects() {
  $("#settingsProjectList").innerHTML = projects.length ? projects.map((project) => `<div class="project-setting"><i class="fa-regular fa-folder"></i><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.path)}</small></span><button data-remove-project="${escapeHtml(project.id)}" title="Listeden kaldır"><i class="fa-solid fa-trash-can"></i></button></div>`).join("") : '<div class="model-empty">Kayıtlı proje yok.</div>';
  $$('[data-remove-project]').forEach((button) => button.addEventListener("click", () => removeProjectRecord(button.dataset.removeProject)));
}

async function removeProjectRecord(projectId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project || !(await askUserConfirmation({
    title: `${project.name} listeden kaldırılsın mı?`,
    message: "Proje TaxCLI sidebar’ından ve kayıtlı projeler listesinden kaldırılacak.",
    note: "Klasör ve proje dosyaları bilgisayarında korunur.",
    confirmLabel: "Listeden kaldır",
    tone: "warning",
    eyebrow: "PROJEYİ KALDIR",
    icon: "fa-regular fa-folder-open"
  }))) return;
  const state = await window.agentHub.removeProject(projectId);
  projects = state.projects;
  selectedProjectId = state.selectedId;
  applySelectedProject(projects.find((item) => item.id === selectedProjectId) || null);
  toast("Proje listeden kaldırıldı; klasör ve dosyalar korunuyor.");
}

async function applySelectedProject(project) {
  const nextPath = project?.path || "";
  const previousPath = $("#projectPath").value;
  if (baseProjectKey(previousPath) !== baseProjectKey(nextPath)) parkCurrentConversation();
  selectedProjectId = project?.id || null;
  $("#projectPath").value = nextPath;
  $("#projectName").textContent = project?.name || "Proje seçilmedi";
  await loadProjectConversations(nextPath);
  await restoreConversation(nextPath, activeConversationId(nextPath));
  if (nextPath) recordProjectOpened(nextPath);
  renderProjects();
  renderConversations();
  window.agentHub.updateMobileContext?.(mobileContext()).catch(() => {});
  showView("workspace");
}

async function loadProjects() {
  try {
    const state = await window.agentHub.listProjects();
    projects = state.projects || [];
    const shouldRestore = userSettings.windowRestore === "last"
      || (userSettings.windowRestore === "default" && userSettings.restoreProject);
    selectedProjectId = shouldRestore ? (state.selectedId || projects[0]?.id || null) : null;
    const selected = shouldRestore ? (projects.find((project) => project.id === selectedProjectId) || projects[0] || null) : null;
    await Promise.all(projects.map((project) => loadProjectConversations(project.path, { ensureOne: project.id === selected?.id })));
    if (selected && selected.id !== state.selectedId) await window.agentHub.selectProject(selected.id);
    await applySelectedProject(selected);
  } catch (error) { toast(`Projeler yüklenemedi: ${error.message}`, "error"); renderProjects(); }
}

async function addNewProject() {
  const result = await window.agentHub.addProject();
  if (!result) return null;
  projects = result.state.projects;
  await applySelectedProject(result.project);
  if (userSettings.autoMemory) {
    await createMissingProjectMemory(result.project, false);
  }
  toast(`${result.project.name} proje listesine kaydedildi.`);
  return result.project;
}

async function createMissingProjectMemory(project, showConfirmation = true) {
  const projectPath = project?.path || $("#projectPath").value;
  if (!projectPath) {
    if (showConfirmation) toast("Önce bir proje seçin.", "error");
    return false;
  }
  try {
    const result = await window.agentHub.generateMemory({
      projectPath,
      name: project?.name || $("#projectName").textContent,
      rules: userSettings.rulesText || ""
    });
    if (showConfirmation) toast(`${result.files.length} hafıza dosyası kontrol edildi; eksikler oluşturuldu.`);
    return true;
  } catch (error) {
    if (showConfirmation) toast(`Proje hafızası oluşturulamadı: ${error.message}`, "error");
    return false;
  }
}

$$('.nav-item').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("#addProject").addEventListener("click", addNewProject);
$("#contextOpenFolder").addEventListener("click", async () => {
  const project = projects.find((item) => item.id === contextProjectId);
  $("#projectContextMenu").classList.remove("open");
  if (!project) return;
  try {
    await window.agentHub.openPath(project.path);
  } catch (error) {
    toast(error.message, "error");
  }
});
$("#contextOpenTerminal").addEventListener("click", async () => {
  if (contextProjectId && contextProjectId !== selectedProjectId) {
    const result = await window.agentHub.selectProject(contextProjectId);
    await applySelectedProject(result.project);
  }
  $("#projectContextMenu").classList.remove("open");
  openTerminal();
});
$("#contextRemoveProject").addEventListener("click", async () => {
  $("#projectContextMenu").classList.remove("open");
  if (contextProjectId) await removeProjectRecord(contextProjectId);
});
$("#refreshEngines").addEventListener("click", () => detectEngines(false));
function renderUpdateState(event) {
  const phase = event.phase || event.type;
  const status = $("#updateStatus");
  if (status) {
    if (event.supported === false) status.textContent = event.message;
    else if (phase === "checking") status.textContent = "GitHub sürümleri kontrol ediliyor…";
    else if (phase === "available" || phase === "downloading") status.textContent = "TaxCLI " + event.version + " arka planda indiriliyor…";
    else if (phase === "not-available") status.textContent = "TaxCLI " + event.currentVersion + " güncel · Otomatik kontrol açık";
    else if (phase === "downloaded") status.textContent = "TaxCLI " + event.version + " hazır · Kurmak için yeniden başlat";
    else if (phase === "error") status.textContent = "Güncelleme başarısız: " + (event.error || "Daha sonra yeniden denenecek.");
    if (event.type === "progress") status.textContent = "Güncelleme indiriliyor: %" + event.percent;
  }
  $("#checkForUpdates").disabled = phase === "checking" || phase === "downloading";
  $("#downloadUpdate").hidden = !(phase === "error" && event.version);
  $("#downloadUpdate").disabled = phase === "downloading";
  $("#installUpdate").hidden = phase !== "downloaded";
}
$("#checkForUpdates")?.addEventListener("click", async () => {
  const button = $("#checkForUpdates"); button.disabled = true;
  try { renderUpdateState(await window.agentHub.checkForUpdates()); }
  catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
});
$("#downloadUpdate")?.addEventListener("click", async () => {
  const button = $("#downloadUpdate"); button.disabled = true;
  try { renderUpdateState(await window.agentHub.downloadUpdate()); }
  catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
});
$("#installUpdate")?.addEventListener("click", async () => {
  if (runMeta.size || activeOfficeJobId || multiAiPreparing) return toast("Çalışan görev tamamlandıktan sonra güncellemeyi kurabilirsin.", "error");
  if (!(await askUserConfirmation({ title: "Güncelleme kurulsun mu?", message: "TaxCLI yeniden başlatılacak ve indirilen sürüm kurulacak.", confirmLabel: "Kur ve yeniden başlat", tone: "info", eyebrow: "GÜNCELLEME HAZIR", icon: "fa-solid fa-cloud-arrow-down" }))) return;
  try { await window.agentHub.installUpdate(); } catch (error) { toast(error.message, "error"); }
});
window.agentHub.onUpdateEvent?.((event) => {
  renderUpdateState(event);
  if (event.type === "downloaded") pushNotification({ type: "update", title: "TaxCLI " + event.version + " hazır", message: "Güncelleme arka planda indirildi. Uygun olduğunda Ayarlar → Genel bölümünden kurup yeniden başlatabilirsin." });
});
window.agentHub.getUpdateStatus?.().then(renderUpdateState).catch(() => {});

$("#newTask").addEventListener("click", () => createConversation());
$$('[data-prompt]').forEach((button) => button.addEventListener("click", () => {
  $("#prompt").value = button.dataset.prompt;
  renderAgentSelector();
  $("#prompt").focus();
}));
$("#sendButton").addEventListener("click", runPrompt);
$("#runTuningButton")?.addEventListener("click", (event) => {
  event.stopPropagation();
  if ($("#runTuningDropdown")?.classList.contains("open")) closeRunTuningMenu();
  else { openRunTuningMenu(); if (event.detail === 0) $("[data-tuning-menu]")?.focus(); }
});
$("#runTuningButton")?.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  openRunTuningMenu();
  const rows = $$("[data-tuning-menu]");
  rows[event.key === "ArrowUp" ? rows.length - 1 : 0]?.focus();
});
$$("[data-tuning-item]").forEach((item) => {
  item.addEventListener("pointerenter", () => showRunTuningSubmenu(item.dataset.tuningItem));
  item.querySelector("[data-tuning-menu]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    showRunTuningSubmenu(item.dataset.tuningItem, event.detail === 0);
  });
});
$("#runTuningDropdown")?.addEventListener("click", (event) => event.stopPropagation());
$("#runTuningDropdown")?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRunTuningMenu(true); return; }
  if (event.key === "Tab") { closeRunTuningMenu(); return; }
  const submenu = event.target.closest(".tuning-submenu");
  const category = event.target.closest("[data-tuning-menu]");
  if (category && event.key === "ArrowRight") { event.preventDefault(); showRunTuningSubmenu(category.dataset.tuningMenu, true); return; }
  if (submenu && event.key === "ArrowLeft") {
    event.preventDefault();
    const row = submenu.parentElement.querySelector("[data-tuning-menu]");
    showRunTuningSubmenu("");
    row?.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const options = submenu ? [...submenu.querySelectorAll("button:not(:disabled)")] : $$("[data-tuning-menu]");
  const current = options.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
  options[next]?.focus();
});
$("#runTuningDropdown")?.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !$("#runTuningDropdown").contains(event.relatedTarget) && event.relatedTarget !== $("#runTuningButton")) closeRunTuningMenu();
});
window.addEventListener("resize", positionRunTuningMenus);
window.addEventListener("scroll", positionRunTuningMenus, true);
$("#modelButton").addEventListener("click", (event) => { event.stopPropagation(); toggleModelDropdown(); });
$("#modelDropdown").addEventListener("click", (event) => event.stopPropagation());
$("#modelSearch").addEventListener("input", (event) => { if (routingScope !== "all") renderModelList(event.target.value); });
$("#approvalButton").addEventListener("click", (event) => { event.stopPropagation(); toggleMenu("approvalMenu"); });
$("#approvalButton").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleMenu("approvalMenu", false);
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  toggleMenu("approvalMenu", true);
  const options = $$("#approvalMenu .approval-option");
  (options.find((button) => button.classList.contains("selected")) || options[0])?.focus();
});
$("#approvalMenu").addEventListener("click", (event) => event.stopPropagation());
$("#approvalMenu").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation();
    toggleMenu("approvalMenu", false);
    $("#approvalButton").focus({ preventScroll: true });
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const options = $$("#approvalMenu .approval-option");
  const index = options.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options[next]?.focus();
});
$$("[data-approval]").forEach((button) => button.addEventListener("click", () => {
  setApprovalMode(button.dataset.approval);
  toggleMenu("approvalMenu", false);
}));
document.body.appendChild($("#toolMenu"));
document.body.appendChild($("#approvalMenu"));
$("#toolMenuButton").addEventListener("click", (event) => { event.stopPropagation(); toggleMenu("toolMenu"); });
$("#toolMenu").addEventListener("click", (event) => event.stopPropagation());
$("#toolMenuSearch").addEventListener("input", () => { filterToolMenu(); positionToolMenu(); });
$("#toolMenu").addEventListener("pointermove", (event) => {
  const button = event.target.closest(".tool-menu-row");
  if (button && !button.hidden) highlightToolMenuRow(button);
});
$("#toolMenu").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation();
    toggleMenu("toolMenu", false);
    $("#toolMenuButton").focus({ preventScroll: true });
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  const rows = toolMenuRows();
  if (!rows.length) return;
  const focused = event.target.closest(".tool-menu-row");
  const index = rows.indexOf(focused || $("#toolMenu .is-highlighted"));
  if (event.key === "Enter") {
    if (event.target !== $("#toolMenuSearch")) return;
    event.preventDefault();
    (rows[index] || rows[0]).click();
    return;
  }
  event.preventDefault();
  const next = rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
  highlightToolMenuRow(next, true);
  if (focused) next.focus({ preventScroll: true });
});
$("#toolMenu").addEventListener("focusout", () => {
  setTimeout(() => {
    if ($("#toolMenu").classList.contains("open") && !$("#toolMenu").contains(document.activeElement) && document.activeElement !== $("#toolMenuButton")) toggleMenu("toolMenu", false);
  }, 0);
});
window.addEventListener("resize", positionToolMenu);
window.addEventListener("resize", positionApprovalMenu);
const toolMenuResizeObserver = new ResizeObserver(() => { positionToolMenu(); positionApprovalMenu(); });
toolMenuResizeObserver.observe($("#toolMenuButton").closest(".composer"));
toolMenuResizeObserver.observe($("#toolMenuButton").closest(".workspace-main"));
window.addEventListener("scroll", (event) => {
  if (!$("#toolMenu").contains(event.target)) positionToolMenu();
  if (!$("#approvalMenu").contains(event.target)) positionApprovalMenu();
}, true);
$("#openWorkflowTool").addEventListener("click", async () => {
  toggleMenu("toolMenu", false);
  showView("workbench");
  await window.TaxCliWorkbench.show("recipes").catch((error) => toast(error.message, "error"));
});
$("#addPlanModeTool")?.addEventListener("click", () => {
  toggleMenu("toolMenu", false);
  setApprovalMode("plan", { skipConfirm: true });
  contextFlags.plan = true;
  renderContextChips();
  toast("Plan modu eklendi — yalnızca okuma / plan.");
  $("#prompt").focus();
});
$("#addBrowserTool")?.addEventListener("click", () => {
  toggleMenu("toolMenu", false);
  if (userSettings.browserAutoPanel === false) {
    return toast("Tarayıcı kontrolü Ayarlar → Tarayıcı bölümünde kapalı.", "error");
  }
  contextFlags.browser = true;
  activeBrowserPluginId = "";
  connectedPlugins.add("browser");
  try {
    const raw = JSON.parse(localStorage.getItem("agenthub:plugins") || "[]");
    const merged = new Set([...(Array.isArray(raw) ? raw : []), "browser"]);
    localStorage.setItem("agenthub:plugins", JSON.stringify([...merged]));
  } catch {
    localStorage.setItem("agenthub:plugins", JSON.stringify(["browser"]));
  }
  renderContextChips();
  renderPlugins();
  toast("Tarayıcı chip eklendi — mesaj gönderince sağ panel açılır.");
  $("#prompt").focus();
});
$("#closeBrowserPane")?.addEventListener("click", () => {
  closeBrowserPane();
  contextFlags.browser = false;
  renderContextChips();
});
$("#openBrowserExternal")?.addEventListener("click", async () => {
  const url = getBrowserCurrentUrl() || $("#browserUrl")?.value || userSettings.homepage;
  if (!url) return toast("Açılacak adres yok.", "error");
  try {
    await window.agentHub.openExternal(url);
    toast("Sistem tarayıcısında açıldı. Giriş/bot doğrulaması için orayı kullan.");
  } catch (error) { toast(error.message, "error"); }
});
$("#addImageTool").addEventListener("click", async () => {
  toggleMenu("toolMenu", false);
  try {
    const images = await window.agentHub.chooseImages();
    const added = pushSelectedImages(images);
    if (added) $("#prompt").focus();
  } catch (error) { toast(error.message, "error"); }
});
$("#openMultiAiTool")?.addEventListener("click", openMultiAiModal);
$("#addSubagentsTool")?.addEventListener("click", () => { toggleMenu("toolMenu", false); toggleSubagentMode(); });
$("#startMultiAi")?.addEventListener("click", applyMultiAiMode);
$("#openOfficeTool")?.addEventListener("click", openOfficeModal);
$("#activateOfficeMode")?.addEventListener("click", activateOfficeMode);
$("#saveOfficeTeam")?.addEventListener("click", () => saveOfficeTeam());
$("#createOfficeTeam")?.addEventListener("click", createOfficeTeam);
$("#officeSearch")?.addEventListener("input", renderOfficeHub);
$$('[data-office-tab]').forEach((button) => button.addEventListener("click", () => {
  officePageTab = button.dataset.officeTab;
  $$('[data-office-tab]').forEach((item) => {
    const selected = item.dataset.officeTab === officePageTab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  $$('[data-office-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.officePanel === officePageTab));
}));
$("#addChatGptAccount")?.addEventListener("click", () => connectChatGptAccount(""));

function nextOfficeMemberDefaults() {
  const roleOrder = ["frontend", "backend", "developer", "designer", "researcher", "security", "reviewer"];
  const roleCounts = new Map(roleOrder.map((role) => [role, officeTeam.filter((member) => member.role === role).length]));
  const role = [...roleOrder].sort((a, b) => (roleCounts.get(a) - roleCounts.get(b)) || roleOrder.indexOf(a) - roleOrder.indexOf(b))[0];
  const readyEngines = readyComparisonEngines();
  const engineCounts = new Map(engines.map((engine) => [engine.id, officeTeam.filter((member) => member.engineId === engine.id).length]));
  const engineId = [...readyEngines].sort((a, b) => (engineCounts.get(a.id) || 0) - (engineCounts.get(b.id) || 0))[0]?.id || "codex";
  const definition = officeRegistry.roleDefinition(role);
  return { role, engineId, name: definition.label.replace(/ geliştirici| denetçisi| yöneticisi/gi, " Uzmanı") };
}

$("#addOfficeMember")?.addEventListener("click", () => {
  if ($$('[data-office-member]').length) collectOfficeTeamFromEditor();
  if (officeTeam.length >= 8) return toast("AI Ofisi en fazla 8 kişilik olabilir.", "error");
  const id = `agent-${crypto.randomUUID().slice(0, 8)}`;
  const defaults = nextOfficeMemberDefaults();
  officeTeam.push(officeRegistry.normalizeMember({
    id,
    name: defaults.name || `Uzman ${officeTeam.length}`,
    role: defaults.role,
    engineId: defaults.engineId,
    enabled: true,
    avatarPreset: OFFICE_AVATAR_PRESETS[officeTeam.length % OFFICE_AVATAR_PRESETS.length].id
  }, officeTeam.length));
  renderOfficeRoster();
});
$("#resetOfficeTeam")?.addEventListener("click", async () => {
  if (!(await askUserConfirmation({
    title: "Kadroyu varsayılana döndür?",
    message: "Takımdaki isimler, roller ve çalışan ayarları başlangıç kadrosuyla değiştirilecek.",
    note: "Takım adı ve açıklaması korunur. Kaydetmeden kapatırsan değişiklik uygulanmaz.",
    confirmLabel: "Kadroyu sıfırla",
    tone: "warning",
    eyebrow: "KADROYU SIFIRLA",
    icon: "fa-solid fa-rotate-left"
  }))) return;
  officeTeam = officeRegistry.normalizeTeam(officeRegistry.defaultTeam);
  renderOfficeRoster();
});
$$(".theme-card").forEach((card) => card.addEventListener("click", () => {
  if (card.disabled || card.classList.contains("soon")) return;
  userSettings.theme = card.dataset.theme;
  const themeInput = $("#settingsTheme");
  if (themeInput) themeInput.value = card.dataset.theme;
  localStorage.setItem("agenthub:user-settings", JSON.stringify({ ...userSettings }));
  applyTheme(userSettings.theme);
  toast(`Tema: ${card.dataset.theme}`);
}));
$("#resetUsageStats")?.addEventListener("click", async () => {
  if (!(await askUserConfirmation({
    title: "Kullanım istatistikleri sıfırlansın mı?",
    message: "Çalışma süresi, proje, ajan çalıştırma, token ve dosya değişikliği sayaçları sıfırlanacak.",
    confirmLabel: "İstatistikleri sıfırla",
    tone: "warning",
    eyebrow: "İSTATİSTİKLER",
    icon: "fa-solid fa-chart-column"
  }))) return;
  usageStats = { sessionStarted: Date.now(), totalMs: 0, projectsOpened: [], runs: 0, tokensEst: 0, edits: 0 };
  usageTracker.clear();
  persistUsage();
  refreshUsageUi();
  toast("İstatistikler sıfırlandı.");
});
$("#clearModelCache")?.addEventListener("click", () => {
  ["codex", "opencode", "nvidia", "cursor", "copilot", "claude", "gemini"].forEach((id) => {
    localStorage.removeItem(`agenthub:${id}-model-cache`);
    delete availableModels[id];
  });
  localStorage.removeItem("agenthub:copilot-model-cache-v2");
  localStorage.removeItem("agenthub:copilot-model-cache-v3");
  localStorage.removeItem("agenthub:copilot-model-cache-v4");
  localStorage.removeItem("agenthub:unavailable-models");
  unavailableModels = {};
  toast("Model önbelleği temizlendi.");
});
$("#refreshProviderUsage")?.addEventListener("click", () => refreshProviderUsage(true));
$("#usagePeriod")?.addEventListener("change", refreshUsageUi);
$("#usageProviderFilter")?.addEventListener("change", refreshUsageUi);
function downloadUsageFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#exportUsageJson")?.addEventListener("click", () => downloadUsageFile(`taxcli-usage-${new Date().toISOString().slice(0, 10)}.json`, usageTracker.export(), "application/json"));
$("#exportUsageCsv")?.addEventListener("click", () => {
  const rows = usageTracker.getState().runs;
  const columns = ["timestamp", "engineId", "model", "inputTokens", "outputTokens", "totalTokens", "billing", "durationMs", "success", "error", "fileEdits"];
  const csv = [columns.join(","), ...rows.map((run) => columns.map((key) => {
    const value = key === "billing" ? `${run.billing?.amount ?? ""} ${run.billing?.unit || ""}` : key === "fileEdits" ? run.fileEdits?.count || 0 : run[key] ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(","))].join("\n");
  downloadUsageFile(`taxcli-usage-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
});
$("#shortcutList")?.addEventListener("click", (event) => {
  const clear = event.target.closest("[data-shortcut-clear]");
  if (!clear) return;
  userSettings.shortcuts[clear.dataset.shortcutClear] = "";
  persistShortcutSettings();
});
$("#resetShortcuts")?.addEventListener("click", () => { userSettings.shortcuts = { ...defaultShortcuts }; persistShortcutSettings(); toast("Kısayollar varsayılana döndü."); });
$("#notificationButton")?.addEventListener("click", (event) => { event.stopPropagation(); toggleNotificationDrawer(); });
$("#clearNotifications")?.addEventListener("click", () => { notifications = []; persistNotifications(); renderNotifications(); });
$("#providerUsageGrid")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-cursor-usage]");
  if (button) window.agentHub.openExternal(button.dataset.url || "https://cursor.com/dashboard/spending");
});
$("#saveRulesSettings")?.addEventListener("click", () => collectAndSaveSettings(true));
$("#saveToolsSettings")?.addEventListener("click", () => collectAndSaveSettings(true));
$("#createSnapshot")?.addEventListener("click", createManualSnapshot);
$("#refreshGitCenter")?.addEventListener("click", refreshGitCenter);
$("#commitGitChanges")?.addEventListener("click", commitGitChanges);
$("#enqueueTask")?.addEventListener("click", enqueueCurrentTask);
$("#toggleTaskQueue")?.addEventListener("click", async () => {
  taskQueueState = await window.agentHub.setTaskQueuePaused(!taskQueueState.paused);
  renderTaskQueue();
  if (!taskQueueState.paused) pumpTaskQueue();
});
$("#clearCompletedTasks")?.addEventListener("click", async () => {
  taskQueueState = await window.agentHub.clearCompletedTasks();
  renderTaskQueue();
});
$("#refreshSecurityCenter")?.addEventListener("click", () => refreshSecurityCenter().catch((error) => toast(error.message, "error")));
$("#toggleWorkspaceTrust")?.addEventListener("click", () => toggleWorkspaceTrust().catch((error) => toast(error.message, "error")));
$("#saveVaultSecret")?.addEventListener("click", async () => {
  const label = $("#vaultSecretLabel")?.value.trim();
  const secret = $("#vaultSecretValue")?.value.trim();
  if (!label || !secret) return toast("Gizli bilgi adı ve değeri gerekli.", "error");
  const id = `${label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "secret"}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await window.agentHub.setVaultSecret({ id, label, secret });
    $("#vaultSecretLabel").value = "";
    $("#vaultSecretValue").value = "";
    toast("Gizli bilgi şifreli kasaya eklendi.");
    await refreshSecurityCenter();
  } catch (error) { toast(`Gizli bilgi kaydedilemedi: ${error.message}`, "error"); }
});
$("#clearSecurityAudit")?.addEventListener("click", async () => {
  if (!(await askUserConfirmation({ title: "Denetim kayıtları temizlensin mi?", message: "Yerel güvenlik olay geçmişi silinecek.", confirmLabel: "Kayıtları temizle", tone: "warning", eyebrow: "GÜVENLİK KAYITLARI", icon: "fa-solid fa-shield-halved" }))) return;
  await window.agentHub.clearSecurityAudit();
  await refreshSecurityCenter();
});
$("#exportSecurityAudit")?.addEventListener("click", async () => {
  const content = await window.agentHub.exportSecurityAudit();
  downloadUsageFile(`taxcli-security-audit-${new Date().toISOString().slice(0, 10)}.json`, content, "application/json");
});
$("#rebuildIndexHint")?.addEventListener("click", () => {
  createMissingProjectMemory(projects.find((project) => project.id === selectedProjectId));
});
$("#profileMenuButton").addEventListener("click", (event) => { event.stopPropagation(); toggleMenu("profileMenu"); });
$$("[data-view-target]").forEach((button) => button.addEventListener("click", () => { showView(button.dataset.viewTarget); $$(".popup-menu").forEach((menu) => menu.classList.remove("open")); }));
$("#clearHistory").addEventListener("click", async () => {
  if (projectRuns.has(projectKey())) return toast("Bu sohbetin çalışan görevini önce durdurun.", "error");
  const projectPath = $("#projectPath").value;
  const conversationId = activeConversationId(projectPath);
  try {
    localStorage.removeItem(historyKey(projectPath, conversationId));
    parkedConversations.delete(projectKey(projectPath, conversationId));
    if (projectPath) await window.agentHub.clearHistoryFile({ projectPath, conversationId });
    const baseKey = baseProjectKey(projectPath);
    const remaining = (conversationsByProject.get(baseKey) || []).filter((item) => item.id !== conversationId);
    conversationsByProject.set(baseKey, remaining);
    $("#conversation").innerHTML = "";
    $("#workspaceView").classList.remove("has-messages");
    toggleMenu("profileMenu", false);
    if (remaining.length) {
      activeConversationByProject.set(baseKey, remaining[0].id);
      persistConversationState(projectPath);
      await restoreConversation(projectPath, remaining[0].id);
    } else {
      activeConversationByProject.delete(baseKey);
      await createConversation("Yeni sohbet", { skipPark: true });
    }
    renderConversations();
    toast("Sohbet silindi; diğer proje sohbetleri korundu.");
  } catch (error) {
    toast(`Konuşma geçmişi temizlenemedi: ${error.message}`, "error");
  }
});
$("#confirmPlugin").addEventListener("click", async () => {
  if (!selectedPlugin) return;
  try {
    if (selectedPlugin.id === "browser") {
      if (connectedPlugins.has("browser")) {
        connectedPlugins.delete("browser");
        contextFlags.browser = false;
        closeBrowserPane();
        renderContextChips();
      } else {
        if (userSettings.browserAutoPanel === false) {
          return toast("Önce Ayarlar → Tarayıcı bölümünden tarayıcı kontrolünü açın.", "error");
        }
        connectedPlugins.add("browser");
        contextFlags.browser = true;
        renderContextChips();
      }
      localStorage.setItem("agenthub:plugins", JSON.stringify([...connectedPlugins]));
      closeModal("pluginModal");
      renderPlugins();
      return toast(`Tarayıcı ${connectedPlugins.has("browser") ? "etkin" : "kaldırıldı"}.`);
    }
    if (selectedPlugin.auth === "browser") {
      closeModal("pluginModal");
      await openBrowserPlugin(selectedPlugin);
      return;
    }
    if (selectedPlugin.auth === "cloudflare-token") {
      closeModal("pluginModal");
      openApiKeyModal("cloudflare");
      return;
    }
    if (selectedPlugin.auth === "config" || !selectedPlugin.ready) {
      return toast(`${selectedPlugin.name} yakında. Şimdilik Tarayıcı, GitHub ve NVIDIA kullanılabilir.`, "error");
    }
    if (!connectedPlugins.has(selectedPlugin.id)) {
      const result = await window.agentHub.loginPlugin(selectedPlugin.id);
      if (result.unavailable) return toast(result.message, "error");
      if (result.apiKey) {
        closeModal("pluginModal");
        return openApiKeyModal(selectedPlugin.id);
      }
      if (result.pending) toast(result.message || "Gerçek giriş penceresi açıldı. Tamamladıktan sonra durumu yenileyin.");
    }
    await refreshPluginStatus();
    closeModal("pluginModal");
    if (connectedPlugins.has(selectedPlugin.id)) toast(`${selectedPlugin.name} oturumu doğrulandı.`);
  } catch (error) { toast(error.message, "error"); }
});
$("#saveApiKey").addEventListener("click", async () => {
  try {
    await window.agentHub.setProviderKey({ providerId: apiKeyProvider, apiKey: $("#apiKeyInput").value });
    delete availableModels[apiKeyProvider];
    localStorage.removeItem(`agenthub:${apiKeyProvider}-model-cache`);
    closeModal("apiKeyModal");
    toast(`${apiKeyProvider.toUpperCase()} API anahtarı kaydedildi.`);
    if (apiKeyProvider !== "cloudflare") await detectEngines(true);
    await refreshPluginStatus();
    if (apiKeyProvider === "cloudflare") {
      pushNotification({ type: "cloudflare", title: "Cloudflare bağlandı", message: "Hesap ve alan adı durumu artık Eklentiler ayarlarında izlenebilir." });
      await refreshCloudflareSummary();
    }
  } catch (error) { toast(error.message, "error"); }
});
$("#clearApiKey").addEventListener("click", async () => {
  try {
    await window.agentHub.clearProviderKey(apiKeyProvider);
    delete availableModels[apiKeyProvider];
    localStorage.removeItem(`agenthub:${apiKeyProvider}-model-cache`);
    $("#apiKeyInput").value = "";
    toast("API anahtarı silindi.");
    await refreshPluginStatus();
    await detectEngines(true);
    await refreshPluginStatus();
  } catch (error) { toast(error.message, "error"); }
});
$("#approveAgentAction").addEventListener("click", () => resolveAgentApproval("accept"));
$("#denyAgentAction").addEventListener("click", () => resolveAgentApproval("decline"));
$("#acceptConfirmDialog")?.addEventListener("click", () => finishConfirmDialog(true));
$("#cancelConfirmDialog")?.addEventListener("click", () => finishConfirmDialog(false));
$("#onboardingBack")?.addEventListener("click", () => {
  if (onboardingStep <= 0) return;
  onboardingStep -= 1;
  renderOnboarding();
});
$("#onboardingNext")?.addEventListener("click", () => advanceOnboarding().catch((error) => toast(error.message, "error")));
$$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop && !["actionApprovalModal", "onboardingModal"].includes(backdrop.id)) closeModal(backdrop.id);
}));
function navigateBrowser() {
  let url = $("#browserUrl").value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url) ? `http://${url}` : `https://${url}`;
  if (!navigateAgentBrowser(url, { force: true })) toast("Yalnızca geçerli HTTP/HTTPS adresleri açılabilir.", "error");
}
async function openTerminal() {
  const projectPath = $("#projectPath").value;
  if (!projectPath) return toast("Önce bir proje seçin.", "error");
  if (!(await ensureWorkspaceTrusted(projectPath))) return toast("Terminal için çalışma alanına güven verilmedi.", "error");
  $("#terminalDrawer").classList.add("open");
  $("#terminalCwd").textContent = projectPath;
  if (!terminalId) {
    $("#terminalOutput").textContent = "Terminal başlatılıyor…\n";
    try {
      const result = await window.agentHub.startTerminal(projectPath);
      terminalId = result.terminalId;
      $("#terminalOutput").textContent = "";
    } catch (error) { $("#terminalOutput").textContent = `${error.message}\n`; }
  }
  $("#terminalInput").focus();
}

async function closeTerminal() {
  $("#terminalDrawer").classList.remove("open");
  if (terminalId) await window.agentHub.stopTerminal(terminalId);
  terminalId = null;
}

$("#openTerminalTool").addEventListener("click", () => { toggleMenu("toolMenu", false); openTerminal(); });
$("#terminalClose").addEventListener("click", closeTerminal);
$("#terminalInput").addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" || !terminalId) return;
  const command = event.target.value;
  event.target.value = "";
  $("#terminalOutput").textContent += `PS> ${command}\n`;
  await window.agentHub.writeTerminal(terminalId, `${command}\r\n`);
});
window.agentHub.onTerminalEvent((payload) => {
  if (payload.terminalId !== terminalId) return;
  if (payload.type === "output") {
    $("#terminalOutput").textContent += payload.data;
    $("#terminalOutput").scrollTop = $("#terminalOutput").scrollHeight;
  }
  if (payload.type === "error") $("#terminalOutput").textContent += `\n${payload.message}\n`;
  if (payload.type === "closed") terminalId = null;
});
$("#browserGo").addEventListener("click", navigateBrowser);
$("#browserUrl").addEventListener("keydown", (event) => { if (event.key === "Enter") navigateBrowser(); });
$("#browserBack").addEventListener("click", () => { if ($("#agentBrowser").canGoBack()) $("#agentBrowser").goBack(); });
$("#browserForward").addEventListener("click", () => { if ($("#agentBrowser").canGoForward()) $("#agentBrowser").goForward(); });
$("#browserReload").addEventListener("click", () => $("#agentBrowser").reload());
$("#agentBrowser").addEventListener("did-navigate", (event) => { $("#browserUrl").value = event.url; });
$("#agentBrowser").addEventListener("did-navigate-in-page", (event) => { $("#browserUrl").value = event.url; });
$("#agentBrowser").addEventListener("will-navigate", async (event) => {
  if (!activeBrowserPluginId || browserPluginAllowsUrl(activeBrowserPluginId, event.url)) return;
  event.preventDefault();
  if (await confirmBrowserPluginNavigation(event.url)) navigateAgentBrowser(event.url, { force: true });
  else toast("Eklentinin izin listesi dışındaki gezinme engellendi.", "error");
});
$("#saveSettings").addEventListener("click", () => collectAndSaveSettings(true));
$$("#userSettingsView input[type='checkbox'],#userSettingsView select").forEach((control) => control.addEventListener("change", () => collectAndSaveSettings(false)));
$("#settingsDisplayName")?.addEventListener("input", (event) => {
  const displayName = event.target.value.trim() || "Yerel kullanıcı";
  const initials = initialsForName(displayName);
  const preview = $("#profileDisplayPreview");
  const avatar = $("#profileAvatarLg");
  const handle = $("#profileHandlePreview");
  if (preview) preview.textContent = displayName;
  if (avatar) avatar.textContent = initials;
  if (handle) {
    const slug = displayName.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/gi, "").slice(0, 18) || "yerel";
    handle.textContent = `@${slug}`;
  }
});
$("#settingsHomepage")?.addEventListener("change", () => collectAndSaveSettings(true));
$("#settingsWorktreeBase")?.addEventListener("change", () => collectAndSaveSettings(false));
$("#settingsBack").addEventListener("click", () => showView("workspace"));
$("#settingsClose").addEventListener("click", () => showView("workspace"));
$("#startMobileAccess")?.addEventListener("click", createMobilePairing);
$("#refreshMobileQr")?.addEventListener("click", async () => {
  try {
    const status = await window.agentHub.refreshMobilePairing(mobileContext());
    renderMobileAccess(status, { showPairing: true });
    toast("Yeni tek kullanımlık QR kodu oluşturuldu.");
  } catch (error) {
    toast(`QR kodu yenilenemedi: ${error.message}`, "error");
  }
});
$("#revokeMobileSessions")?.addEventListener("click", async () => {
  if (!(await askUserConfirmation({
    title: "Tüm mobil oturumlar kapatılsın mı?",
    message: "Eşleştirilmiş telefonların TaxCLI erişimi hemen sonlandırılacak.",
    note: "Yeniden bağlanmak için masaüstünden yeni QR kodu okutmak gerekir.",
    confirmLabel: "Oturumları kapat",
    tone: "danger",
    eyebrow: "MOBİL ERİŞİM",
    icon: "fa-solid fa-mobile-screen-button"
  }))) return;
  try {
    const status = await window.agentHub.revokeMobileSessions();
    renderMobileAccess(status);
    toast("Tüm mobil oturumlar kapatıldı.");
  } catch (error) {
    toast(`Mobil oturumlar kapatılamadı: ${error.message}`, "error");
  }
});
$("#stopMobileAccess")?.addEventListener("click", async () => {
  try {
    const status = await window.agentHub.stopMobileAccess();
    renderMobileAccess(status);
    toast("Mobil erişim kapatıldı.");
  } catch (error) {
    toast(`Mobil erişim kapatılamadı: ${error.message}`, "error");
  }
});
$$("[data-settings-section]").forEach((button) => button.addEventListener("click", () => {
  showSettingsSection(button.dataset.settingsSection);
}));
$("#settingsSearch").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLocaleLowerCase("tr-TR");
  $$("[data-settings-section]").forEach((button) => {
    const panel = document.querySelector(`[data-settings-panel~="${button.dataset.settingsSection}"]`);
    const searchableText = `${button.textContent} ${panel?.textContent || ""}`.toLocaleLowerCase("tr-TR");
    button.classList.toggle("search-hidden", Boolean(query && !searchableText.includes(query)));
  });
  // Hide category labels that have no visible buttons after them
  $$(".settings-nav-label").forEach((label) => {
    let el = label.nextElementSibling;
    let any = false;
    while (el && !el.classList.contains("settings-nav-label")) {
      if (el.matches?.("[data-settings-section]") && !el.classList.contains("search-hidden")) any = true;
      el = el.nextElementSibling;
    }
    label.classList.toggle("search-hidden", Boolean(query && !any));
  });
  const activeButton = $("[data-settings-section].active:not(.search-hidden)");
  const firstMatch = $("[data-settings-section]:not(.search-hidden)");
  if (query && !activeButton && firstMatch) showSettingsSection(firstMatch.dataset.settingsSection);
});
$("#clearAllData").addEventListener("click", async () => {
  if (projectRuns.size) return toast("Yerel verileri temizlemeden önce çalışan ajanları durdurun.", "error");
  if (!(await askUserConfirmation({
    title: "Tüm yerel veriler silinsin mi?",
    message: "TaxCLI ayarları, eklenti tercihleri, takımlar ve konuşma geçmişi bu bilgisayardan kaldırılacak.",
    note: "Bu işlem geri alınamaz. Proje klasörlerindeki kaynak dosyalar silinmez.",
    confirmLabel: "Tüm verileri sil",
    tone: "danger",
    eyebrow: "KALICI İŞLEM",
    icon: "fa-solid fa-trash-can"
  }))) return;
  try {
    await window.agentHub.clearLocalData();
    localStorage.clear();
    location.reload();
  } catch (error) {
    toast(`Yerel veriler temizlenemedi: ${error.message}`, "error");
  }
});
$("#minimizeWindow").addEventListener("click", () => window.agentHub.minimizeWindow());
$("#maximizeWindow").addEventListener("click", () => window.agentHub.maximizeWindow());
$("#closeWindow").addEventListener("click", () => window.agentHub.closeWindow());
document.addEventListener("click", (event) => {
  $$(".popup-menu").forEach((menu) => menu.classList.remove("open"));
  syncToolMenuButton();
  $("#modelDropdown")?.classList.remove("open");
  closeRunTuningMenu();
  $("#projectContextMenu")?.classList.remove("open");
  if (!event.target.closest(".multi-ai-selector")) toggleMultiAiDropdown(false);
  if (!event.target.closest("#notificationDrawer") && !event.target.closest("#notificationButton")) toggleNotificationDrawer(false);
});
$("#multiAiModelsButton").addEventListener("click", () => toggleMultiAiDropdown($("#multiAiModelsDropdown").hidden));
$("#multiAiModelsDropdown").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); toggleMultiAiDropdown(false, true); }
  if (event.target.id === "multiAiModelSearch" && event.key === "ArrowDown") {
    event.preventDefault(); $$('[data-multi-model-row]:not([hidden]) input:not(:disabled)')[0]?.focus();
  }
});
$("#projectContextMenu").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); closeProjectContextMenu(true); }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length].focus();
  }
});
document.addEventListener("scroll", () => {
  if (!contextProjectBounds) return;
  const anchor = contextProjectAnchor?.getBoundingClientRect();
  if (!contextProjectAnchor?.isConnected || anchor.top !== contextProjectBounds.top || anchor.left !== contextProjectBounds.left) closeProjectContextMenu();
}, true);
window.addEventListener("resize", () => closeProjectContextMenu());
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); runPrompt(); }
});
$("#prompt").addEventListener("input", renderAgentSelector);
$$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
document.addEventListener("keydown", (event) => {
  const recorder = $(".shortcut-capture.recording");
  if (recorder) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { recorder.classList.remove("recording"); renderShortcutSettings(); return; }
    const value = shortcutFromEvent(event);
    if (!value) return;
    const conflict = Object.entries(userSettings.shortcuts).find(([id, shortcut]) => id !== recorder.dataset.shortcutCapture && shortcut === value);
    if (conflict) return toast(`Bu kısayol “${shortcutDefinitions.find((item) => item.id === conflict[0])?.label || conflict[0]}” için kullanılıyor.`, "error");
    userSettings.shortcuts[recorder.dataset.shortcutCapture] = value;
    recorder.classList.remove("recording");
    persistShortcutSettings();
    toast(`Kısayol kaydedildi: ${value}`);
    return;
  }
  if ($("#confirmModal")?.classList.contains("open")) {
    if (event.key === "Escape") { event.preventDefault(); finishConfirmDialog(false); }
    if (event.key === "Enter") { event.preventDefault(); finishConfirmDialog(true); }
    return;
  }
  const shortcut = shortcutFromEvent(event);
  const action = Object.entries(userSettings.shortcuts || {}).find(([, value]) => value && value === shortcut)?.[0];
  if (!action) return;
  event.preventDefault();
  if (action === "newChat") createConversation();
  if (action === "focusPrompt") { showView("workspace"); $("#prompt")?.focus(); }
  if (action === "toggleTerminal") $("#terminalDrawer").classList.contains("open") ? closeTerminal() : openTerminal();
  if (action === "toggleSubagents") toggleSubagentMode();
  if (action === "openSettings") showView("userSettings");
  if (action === "openNotifications") toggleNotificationDrawer();
});

window.agentHub.onMobilePrompt?.(async (payload) => {
  const requestId = String(payload?.requestId || "");
  const prompt = String(payload?.prompt || "").trim();
  const reject = (message) => window.agentHub.updateMobileMessage({
    requestId,
    status: "Görev başlatılamadı",
    error: message,
    finished: true
  }).catch(() => {});
  if (!requestId || !prompt) return;
  const target = payload.target;
  if (!target?.projectPath || !target.engineId) return reject("Telefonda bir proje ve sağlayıcı seçin.");
  if (!userSettings.parallelRuns && runMeta.size) return reject("Başka bir görev çalışıyor. Tamamlanmasını bekleyin veya masaüstünde paralel koşuları açın.");
  try {
    const trust = await window.agentHub.getWorkspaceTrust(target.projectPath);
    if (!trust.trusted) return reject("Bu projeye önce masaüstünden güven verin.");
    await window.agentHub.updateMobileMessage({ requestId, status: "Görev hazırlanıyor…" });
    await executeWorkbenchAgent({ displayProjectPath: target.projectPath, projectPath: target.projectPath,
      engineId: target.engineId, model: target.model || "__auto__", approvalMode: target.approvalMode,
      agentId: "coder", prompt, history: payload.history || [], background: true,
      title: prompt.slice(0, 60), mobileRequestId: requestId });
  } catch (error) { await reject(error.message); }
});

window.agentHub.onAgentEvent(async (payload) => {
  let comparisonActivity = "";
  if (payload.type === "output") {
    const normalized = payload.event?.kind === "json" ? summarizeStructuredEvent(payload.event.data || {}) : {};
    comparisonActivity = normalized.error || normalized.toolDetail || normalized.tool || normalized.status || normalized.delta || normalized.response || normalized.thinkingDelta || normalized.thinking || payload.event?.text || "Çıktı alınıyor…";
  }
  comparisonProgress.event(payload, comparisonActivity);
  if (payload.type === "approval-resolved") { clearAgentApprovals(payload.runId, payload.requestId); return; }
  if (payload.type === "approval-request") enqueueAgentApproval(payload);
  if (payload.type === "finished") clearAgentApprovals(payload.runId);
  let container = findRunContainer(payload.runId);
  if (!container && activeRun === payload.runId && activeAssistant) container = activeAssistant;
  if (!container && !runMeta.has(payload.runId) && activeAssistant && (!activeRun || activeRun === payload.runId)) {
    container = activeAssistant;
    if (payload.runId) {
      activeRun = payload.runId;
      container.dataset.runId = payload.runId;
      runMeta.set(payload.runId, {
        projectPath: $("#projectPath").value,
        conversationId: activeConversationId(),
        status: "Düşünüyor…"
      });
      projectRuns.set(projectKey(), payload.runId);
    }
  }
  if (!container) return;

  const meta = runMeta.get(payload.runId);
  const mobileRequestId = meta?.mobileRequestId || "";
  if (meta?.officeJobId && payload.type === "error") {
    meta.officeError = String(payload.message || "Ajan hatası");
    meta.officeErrorCode = String(payload.code || "");
  }
  if (meta?.queuedTaskId && payload.type === "error") meta.queueError = String(payload.message || "Ajan hatası");
  const isCurrent = projectKey(
    meta?.projectPath || $("#projectPath").value,
    meta?.conversationId || activeConversationId(meta?.projectPath)
  ) === projectKey();
  applyAgentPayload(container, payload, isCurrent);
  if (meta?.projectPath) scheduleHistorySave(meta.projectPath, meta.historyConversationId || meta.conversationId);
  if (meta?.officeJobId) {
    const job = officeJobs.get(meta.officeJobId);
    if (job) {
      const activity = payload.type === "started"
        ? "Başlatıldı; proje bağlamı hazırlanıyor"
        : payload.type === "approval-request"
          ? "Kullanıcı onayı bekliyor"
          : payload.type === "error"
            ? friendlyErrorText(payload.message || "Ajan hatası").slice(0, 110)
            : payload.type === "finished"
              ? "Çalışma tamamlandı"
              : payload.type === "status"
                ? (payload.message || "Çalışıyor")
                : (meta.status && !/Düşünüyor/i.test(meta.status) ? meta.status : "Yanıt ve araç etkinliği bekleniyor");
      updateOfficeMemberState(job, meta.officeMemberId, payload.type === "error" ? "error" : payload.type === "finished" ? "done" : "running", activity);
    }
  }
  if (mobileRequestId) {
    const answer = String(ensureAssistantParts(container).response.dataset.rawText || "");
    const status = payload.type === "approval-request"
      ? "İşlem onayı bekleniyor…"
      : payload.type === "status"
        ? (payload.message || "Çalışıyor…")
        : payload.type === "finished"
          ? "Tamamlandı"
          : payload.type === "error"
            ? "Ajan hatası"
            : "Yanıt hazırlanıyor…";
    window.agentHub.updateMobileMessage({
      requestId: mobileRequestId,
      answer,
      status,
      error: payload.type === "error" ? String(payload.message || "Ajan hatası") : undefined,
      finished: payload.type === "finished"
    }).catch(() => {});
  }
  if (meta?.officeJobId && payload.type === "finished") {
    handleOfficeAgentFinished(meta, payload, container).catch((error) => {
      const job = officeJobs.get(meta.officeJobId);
      if (job) finishOfficeJob(job, { error: `Ofis akışı tamamlanamadı: ${error.message}` });
    });
  }
  if (meta?.queuedTaskId && payload.type === "finished") {
    const cancelled = payload.code == null;
    const failed = Boolean(meta.queueError) || (!cancelled && Number(payload.code) !== 0);
    const status = cancelled ? "cancelled" : failed ? "failed" : "completed";
    await window.agentHub.updateQueuedTask({
      taskId: meta.queuedTaskId,
      patch: {
        status,
        error: failed ? (meta.queueError || `Çıkış kodu ${payload.code}`) : "",
        runId: payload.runId,
        completedAt: new Date().toISOString()
      }
    }).catch(() => {});
    activeQueuedTaskId = "";
    await refreshTaskQueue().catch(() => {});
    setTimeout(() => pumpTaskQueue(), 250);
  }
  if (isCurrent) $("#conversation").scrollTop = $("#conversation").scrollHeight;
});

async function executeWorkbenchAgent(options) {
  const displayPath = options.displayProjectPath || $("#projectPath").value;
  if (!displayPath) throw new Error("Önce bir proje seç.");
  if (!(await ensureWorkspaceTrusted(displayPath))) throw new Error("Çalışma alanına güven verilmedi.");
  const engineId = options.engineId || activeEngine;
  const model = options.model === "__auto__" ? "" : options.model ?? (modelByEngine[engineId] === "__auto__" ? "" : modelByEngine[engineId]) ?? "";
  const baseKey = baseProjectKey(displayPath);
  const existing = options.conversationId && (conversationsByProject.get(baseKey) || []).find((item) => item.id === options.conversationId);
  if (options.conversationId && !existing) throw new Error("Karşılaştırma sohbeti bulunamadı.");
  const conversation = existing || newConversationMeta(options.title || "Geliştirme görevi");
  if (!existing) {
    conversation.engineId = engineId;
    conversationsByProject.set(baseKey, [conversation, ...(conversationsByProject.get(baseKey) || [])]);
  }
  const key = projectKey(displayPath, conversation.id);
  const holder = existing
    ? parkedConversations.get(key) || (projectKey() === key ? $("#conversation") : null)
    : document.createElement("div");
  if (!holder) throw new Error("Karşılaştırma çıktıları bulunamadı.");
  if (!existing) {
    (options.history || []).forEach((message) => renderStoredMessage(message, holder));
    addMessageToRoot(holder, "user", options.prompt, engineId);
  }
  const assistant = addMessageToRoot(holder, "assistant", "", engineId, options.agentId || "coder");
  if (existing && options.role === "judge") labelComparisonOutput(assistant, "judge", `Hakem · ${model || "Auto"}`);
  const runId = crypto.randomUUID();
  if (options.role === "judge" && multiAiPreparing) {
    multiAiCurrentRun = runId;
    comparisonProgress.update("judge", { status: "running", runId, conversationId: conversation.id, message: "Çözümler bağımsız hakem tarafından değerlendiriliyor…" });
  }
  assistant.dataset.runId = runId;
  assistant.dataset.recordId = runId;
  if (!existing) parkedConversations.set(key, holder);
  const completed = new Promise((resolve) => runMeta.set(runId, { projectPath: displayPath, conversationId: conversation.id, engineId, model: model || "auto", agentId: options.agentId || "coder", startedAt: new Date().toISOString(), status: "Çalışıyor…", promptForStats: options.prompt, mobileRequestId: options.mobileRequestId || "", waitResolve: resolve }));
  projectRuns.set(projectKey(displayPath, conversation.id), runId);
  if (!options.background) {
    if (!existing || projectKey() !== key) parkCurrentConversation();
    activeConversationByProject.set(baseKey, conversation.id);
    await restoreConversation(displayPath, conversation.id);
    activeRun = runId; activeAssistant = assistant;
    showView("workspace"); setRunning(true, `${engineId} çalışıyor…`);
  }
  renderConversations();
  try {
    const result = await window.agentHub.startAgent({
      runId, conversationId: conversation.id, engineId, model,
      mobileRequestId: options.mobileRequestId || "",
      replayId: options.replayId || "",
      agentId: options.agentId || "coder", prompt: options.prompt, history: options.history || [],
      images: options.images || [], projectPath: options.projectPath || displayPath,
      effort: options.effort || selectedEffortFor(model, engineId, options.agentId || "coder"),
      routingPolicy: options.routingPolicy || routingPolicy,
      approvalMode: options.approvalMode || approvalMode,
      experimentalEffort: options.experimentalEffort ?? Boolean(userSettings.experimentalEffort),
      autoSnapshot: options.autoSnapshot ?? Boolean(userSettings.autoSnapshot),
      allowShell: options.allowShell ?? userSettings.allowShell !== false,
      allowMcp: options.allowMcp ?? false, mcpConfig: options.mcpConfig || "", useWorktrees: false,
      useMemory: options.useMemory ?? userSettings.useMemory !== false,
      rules: options.rules ?? userSettings.rulesText ?? "", skillsPaths: options.skillsPaths ?? userSettings.skillsPaths ?? "",
      knowledgeIds: options.role === "judge" ? [] : options.knowledgeIds,
      indexIgnore: true, arenaId: options.arenaId || "", workbenchRole: options.role || "agent", recipeId: options.recipeId || ""
    });
    if (result.runId !== runId) {
      runMeta.set(result.runId, runMeta.get(runId)); runMeta.delete(runId);
      assistant.dataset.runId = result.runId; assistant.dataset.recordId = result.runId;
      projectRuns.set(projectKey(displayPath, conversation.id), result.runId);
    }
    const outcome = await completed;
    if (result.reviewWarning) toast(result.reviewWarning);
    saveHistory(parkedConversations.get(projectKey(displayPath, conversation.id)) || $("#conversation"), displayPath, conversation.id);
    return { ...outcome, runId: result.runId };
  } catch (error) {
    runMeta.delete(runId); projectRuns.delete(projectKey(displayPath, conversation.id));
    assistant.removeAttribute("data-run-id");
    setRichText(ensureAssistantParts(assistant).response, error.message); finishThinking(assistant, "Başlatılamadı");
    if (!options.background) { setRunning(false); activeRun = null; activeAssistant = null; }
    throw error;
  }
}

async function forkConversationAt(message = null, engineId = activeEngine, title = "Alternatif dal") {
  const projectPath = $("#projectPath").value;
  if (!projectPath) throw new Error("Önce bir proje seç.");
  const root = $("#conversation"), articles = [...root.querySelectorAll(":scope > .message")];
  const index = message ? articles.indexOf(message) : articles.length - 1;
  if (index < 0) throw new Error("Dallandırılacak sohbet mesajı yok.");
  const messages = collectMessagesFromRoot(root);
  const parentId = activeConversationId(projectPath);
  await window.agentHub.saveHistoryFile({ projectPath, conversationId: parentId, title: currentConversationMeta()?.title, messages });
  const sourceRunId = articles.slice(0, index + 1).reverse().map((article) => article.querySelector(".message-content")?.dataset.recordId).find(Boolean) || "";
  const branch = await window.agentHub.workbenchRequest("branch-create", { projectPath, parentId, forkAt: index + 1, engineId, title, sourceRunId });
  await loadProjectConversations(projectPath);
  await activateConversation(branch.conversationId);
  toast("İzole konuşma dalı oluşturuldu. Değişiklikleri Geliştirme merkezi → Dallar’dan uygulayabilirsin.");
}

$("#conversation").addEventListener("click", async (event) => {
  const article = event.target.closest(".message");
  if (!article) return;
  if (event.target.closest(".wb-review-message")) {
    const recordId = article.querySelector(".message-content")?.dataset.recordId;
    if (!recordId) return toast("Bu eski mesaj için çalışma kaydı bulunmuyor.", "error");
    showView("workbench");
    try { await window.TaxCliWorkbench.openRun(recordId); } catch (error) { toast(error.message, "error"); }
  }
  if (event.target.closest(".wb-fork-message")) {
    article.querySelector(".wb-fork-options")?.remove();
    const options = document.createElement("div"); options.className = "wb-fork-options";
    options.innerHTML = `<select aria-label="Dal sağlayıcısı">${engines.map((engine) => `<option value="${engine.id}" ${engine.id === activeEngine ? "selected" : ""}>${escapeHtml(engine.name)}</option>`).join("")}</select><input aria-label="Dal adı" placeholder="Dal adı" value="Alternatif dal" maxlength="80" /><button type="button" class="ghost-button">Dal oluştur</button>`;
    article.querySelector(".message-body").appendChild(options);
    options.querySelector("button").addEventListener("click", async (click) => {
      click.target.disabled = true;
      try { await forkConversationAt(article, options.querySelector("select").value, options.querySelector("input").value || "Alternatif dal"); options.remove(); }
      catch (error) { toast(error.message, "error"); click.target.disabled = false; }
    });
  }
});

window.TaxCliWorkbench.init({
  project: () => $("#projectPath").value, engines: () => engines, toast,
  run: executeWorkbenchAgent, openArena: openMultiAiModal,
  fork: forkConversationAt,
  openConversation: activateConversation,
  reloadConversations: () => loadProjectConversations($("#projectPath").value),
  confirm: (title, message, confirmLabel) => askUserConfirmation({ title, message, confirmLabel, tone: "info" })
});

renderPlugins();
renderEngines();
renderNotifications();
persistOfficeTeams();
renderOfficeHub();
try { Object.assign(modelByEngine, JSON.parse(localStorage.getItem("agenthub:models") || "{}")); } catch { /* Ignore invalid model preferences. */ }
// Migrate only retired *-codex aliases; current Sol/Terra/Luna/Astra IDs are valid choices.
engines.forEach((engine) => {
  if (!(engine.id in modelByEngine)) modelByEngine[engine.id] = "__auto__";
});
if (/(?:-codex(?:-mini)?|codex-mini-latest|composer|cursor)/i.test(String(modelByEngine.codex))) modelByEngine.codex = "__auto__";
localStorage.setItem("agenthub:models", JSON.stringify(modelByEngine));
updateModelButton();
renderEffortDropdown();
updateApprovalLabel();
renderContextChips();
applyUserSettings();
window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener?.("change", () => {
  if (userSettings.theme === "system") applyTheme("system");
});
setupComposerImageDrop();
Promise.all([loadProjects(), detectEngines(true)]).then(async () => {
  await refreshTaskQueue().catch(() => {});
  pumpTaskQueue();
  maybeStartOnboarding();
});
refreshPluginStatus();
rotateTip();
setInterval(() => { if (userSettings.tips) rotateTip(); }, 12000);
setInterval(() => { accumulateSessionTime(); }, 60000);
window.addEventListener("beforeunload", () => {
  accumulateSessionTime();
  if ($("#projectPath").value) saveHistory($("#conversation"), $("#projectPath").value);
});
