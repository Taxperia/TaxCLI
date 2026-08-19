const engines = [
  { id: "codex", name: "Codex", initial: "C", logo: "assets/engines/codex.svg", logoClass: "invert-dark", login: "ChatGPT ile giriş" },
  { id: "opencode", name: "OpenCode", initial: "O", logo: "assets/engines/opencode.svg", logoClass: "mono-light", login: "OpenCode'u aç" },
  { id: "cursor", name: "Cursor Agent", initial: "Cu", logo: "assets/engines/cursor.svg", logoClass: "mono-light", login: "Cursor ile giriş" },
  { id: "copilot", name: "Copilot", initial: "Co", logo: "assets/engines/copilot.svg", logoClass: "mono-light", login: "GitHub ile giriş" },
  { id: "gemini", name: "Gemini", initial: "G", logo: "assets/engines/gemini.svg", login: "Google ile giriş" },
  { id: "nvidia", name: "NVIDIA", initial: "NV", logo: "assets/engines/nvidia.svg", login: "NVIDIA API bağla" }
];

function renderEngineLogo(engine) {
  return `<img class="engine-logo ${engine.logoClass || ""}" src="${engine.logo}" alt="" aria-hidden="true">`;
}

const plugins = [
  { id:"browser", name:"Tarayıcı", icon:"fa-solid fa-globe", auth:"local", ready:true, description:"Tüm modeller için güvenli web tarayıcısı" },
  { id:"github", name:"GitHub", icon:"fa-brands fa-github", auth:"github-cli", ready:true, description:"Kod, issue ve pull request'ler" },
  { id:"nvidia", name:"NVIDIA API", icon:"fa-solid fa-microchip", auth:"opencode-provider", ready:true, description:"Ücretsiz NVIDIA modellerini OpenCode ajanında kullan" },
  { id:"canva", name:"Canva", icon:"fa-solid fa-palette", auth:"config", ready:false, description:"Tasarımlar oluştur ve düzenle" },
  { id:"figma", name:"Figma", icon:"fa-brands fa-figma", auth:"config", ready:false, description:"Tasarım dosyaları ve prototipler" },
  { id:"notion", name:"Notion", icon:"fa-solid fa-n", auth:"config", ready:false, description:"Belgeler ve proje bilgisi" },
  { id:"drive", name:"Google Drive", icon:"fa-brands fa-google-drive", auth:"config", ready:false, description:"Dosyalar ve çalışma belgeleri" },
  { id:"slack", name:"Slack", icon:"fa-brands fa-slack", auth:"config", ready:false, description:"Kanallar ve ekip iletişimi" },
  { id:"supabase", name:"Supabase", icon:"fa-solid fa-database", auth:"config", ready:false, description:"Veritabanı ve backend araçları" },
  { id:"cloudflare", name:"Cloudflare", icon:"fa-brands fa-cloudflare", auth:"config", ready:false, description:"Dağıtım, DNS ve güvenlik" },
  { id:"vercel", name:"Vercel", icon:"fa-solid fa-caret-up", auth:"config", ready:false, description:"Önizleme ve production dağıtımları" }
];

let activeEngine = "codex";
let detected = [];
let activeRun = null;
let activeAssistant = null;
let isRunning = false;
const modelByEngine = {};
let approvalMode = localStorage.getItem("agenthub:approval") || "ask";
let effortLevel = localStorage.getItem("agenthub:effort") || "medium";
/** @type {{ plan: boolean, browser: boolean }} */
const contextFlags = { plan: false, browser: false };
let selectedPlugin = null;
let storedPluginIds = [];
try { storedPluginIds = JSON.parse(localStorage.getItem("agenthub:plugins") || "[]"); } catch { storedPluginIds = []; }
const connectedPlugins = new Set(storedPluginIds.filter((id) => id === "browser"));
const availableModels = {};
let unavailableModels = {};
try { unavailableModels = JSON.parse(localStorage.getItem("agenthub:unavailable-models") || "{}"); } catch { unavailableModels = {}; }
let userSettings = {};
try { userSettings = JSON.parse(localStorage.getItem("agenthub:user-settings") || "{}"); } catch { userSettings = {}; }
const defaultSettings = {
  displayName: "Yerel kullanıcı",
  initials: "TA",
  keepHistory: true,
  localHistory: true,
  homepage: "https://www.google.com",
  tips: true,
  windowRestore: "default",
  systemNotifications: true,
  warningNotifications: false,
  trayIcon: true,
  completionSound: false,
  theme: "brand",
  compactSidebar: false,
  restoreProject: true,
  autoMemory: true,
  defaultEngine: "codex",
  defaultApproval: "ask",
  parallelRuns: false,
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
userSettings = Object.assign({}, defaultSettings, userSettings);
if (!localStorage.getItem("agenthub:approval") && userSettings.defaultApproval) {
  approvalMode = userSettings.defaultApproval;
}
if (!localStorage.getItem("agenthub:engine") && userSettings.defaultEngine) {
  activeEngine = userSettings.defaultEngine;
} else {
  try { activeEngine = localStorage.getItem("agenthub:engine") || activeEngine; } catch { /* ignore */ }
}

/** @type {{ sessionStarted: number, totalMs: number, projectsOpened: string[], runs: number, tokensEst: number, edits: number }} */
let usageStats = {};
try { usageStats = JSON.parse(localStorage.getItem("agenthub:usage-stats") || "{}"); } catch { usageStats = {}; }
usageStats = Object.assign({ sessionStarted: Date.now(), totalMs: 0, projectsOpened: [], runs: 0, tokensEst: 0, edits: 0 }, usageStats);
if (!usageStats.sessionStarted) usageStats.sessionStarted = Date.now();
const tips = [
  "Codex, OpenCode, Cursor, Copilot ve Gemini arasında motor değiştir.",
  "+ menüsünden Plan veya Tarayıcı modunu composer’a ekle.",
  "Onay modu: Her işlemde sor · Düzenlemeleri onayla · Plan.",
  "Resim için + / Ctrl+V / sürükle-bırak; vision’suz modellerde yol uyarısı çıkar.",
  "Bağlantılar’dan CLI kurup oturum aç; modeller canlı listeden gelir."
];
let tipIndex = 0;
let projects = [];
let selectedProjectId = null;
let contextProjectId = null;
let terminalId = null;
let selectedImages = [];
/** @type {WeakMap<Element, { files: Map<string, any>, thoughtCount: number, collapsed: boolean }>} */
const streamState = new WeakMap();
const parkedConversations = new Map();
/** @type {Map<string, { projectPath: string, status: string }>} */
const runMeta = new Map();
/** @type {Map<string, string>} projectPath -> active runId */
const projectRuns = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

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

function recordUsageRun(promptText = "", replyText = "") {
  usageStats.runs = (usageStats.runs || 0) + 1;
  const est = Math.ceil((String(promptText).length + String(replyText).length) / 4);
  usageStats.tokensEst = (usageStats.tokensEst || 0) + est;
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
  const projectCount = new Set([...(usageStats.projectsOpened || []), ...projects.map((p) => p.path)]).size;
  const tokens = usageStats.tokensEst || 0;
  const runs = usageStats.runs || 0;
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
  const grid = $("#usageStatsGrid");
  const profileGrid = $("#profileStatsGrid");
  const cards = [
    { label: "Kullanım süresi", value: formatHours(totalMs) },
    { label: "Açılan projeler", value: String(projectCount) },
    { label: "Koşan ajan", value: String(runs) },
    { label: "Tahmini token", value: tokens.toLocaleString("tr-TR") },
    { label: "Tahmini kredi", value: `~${Math.max(1, Math.round(tokens / 1000))} cr` }
  ];
  const html = cards.map((c) => `<div class="stat-card"><strong>${escapeHtml(c.value)}</strong><small>${escapeHtml(c.label)}</small></div>`).join("");
  if (grid) grid.innerHTML = html;
  if (profileGrid) profileGrid.innerHTML = html;
}

function effortLevelsForModel(modelId = "", engineId = activeEngine) {
  const id = String(modelId || "").toLowerCase();
  if (/max|ultra|opus|o3|gpt-5\.5|gpt-5\.6|sonnet-4|gemini-3\.1-pro/i.test(id)) {
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
    renderContextChips();
  }));
  $("#approvalButton")?.classList.toggle("active-mode", approvalMode === "plan" || contextFlags.plan);
}

function setApprovalMode(next, { skipConfirm = false } = {}) {
  if (next === "auto_edit" && !skipConfirm && !window.confirm("Bu mod, seçili ajanın proje dosyalarını ek onay almadan düzenlemesine izin verir. Devam edilsin mi?")) return;
  approvalMode = next;
  localStorage.setItem("agenthub:approval", approvalMode);
  if (next === "plan") contextFlags.plan = true;
  else if (contextFlags.plan && next !== "plan") contextFlags.plan = false;
  updateApprovalLabel();
  renderContextChips();
  $$(".approval-option").forEach((btn) => btn.classList.toggle("selected", btn.dataset.approval === approvalMode));
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
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
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

/**
 * Open the side browser. Only navigate when:
 * - a new target URL is provided, OR
 * - the pane is closed (first open uses target / current / homepage).
 * Never force google reset if user already has a live page.
 */
function openBrowserPane(url, { navigate = "auto" } = {}) {
  const layout = $("#workspaceLayout");
  const pane = $("#browserPane");
  if (!layout || !pane) return;
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
        url: raw.url || fallbackUrl,
        title: raw.title || "",
        domain: raw.domain || "",
        headings: Array.isArray(raw.headings) ? raw.headings : [],
        links: Array.isArray(raw.links) ? raw.links : [],
        buttons: Array.isArray(raw.buttons) ? raw.buttons : [],
        rows: Array.isArray(raw.rows) ? raw.rows : [],
        hostnames: Array.isArray(raw.hostnames) ? raw.hostnames : [],
        text: String(raw.text || "").slice(0, maxChars),
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
  projectPath,
  history = [],
  images = [],
  browserLoop = false,
  promptForStats = "",
  container = null
}) {
  const target = container || activeAssistant;
  if (!target) throw new Error("Asistan kutusu yok");
  const result = await window.agentHub.startAgent({
    engineId: activeEngine,
    prompt,
    history,
    images,
    projectPath,
    model: modelByEngine[activeEngine] || "",
    approvalMode: approvalMode === "plan" ? "plan" : (browserLoop ? "auto_edit" : approvalMode),
    effort: effortLevel,
    experimentalEffort: Boolean(userSettings.experimentalEffort),
    useWorktrees: Boolean(userSettings.useWorktrees),
    worktreeBase: userSettings.worktreeBase || "main",
    browserSession: true,
    browserUrl: getBrowserCurrentUrl(),
    rules: userSettings.rulesText || "",
    allowShell: userSettings.allowShell !== false,
    allowMcp: Boolean(userSettings.allowMcp),
    debugStream: Boolean(userSettings.debugStream)
  });
  activeRun = result.runId;
  target.dataset.runId = result.runId;
  projectRuns.set(projectKey(projectPath), result.runId);
  const waitPromise = new Promise((resolve) => {
    runMeta.set(result.runId, {
      projectPath,
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
  projectPath,
  history,
  outgoingImages,
  promptForStats
}) {
  openBrowserPane(null, { navigate: "auto" });
  const extracted = extractBrowserTarget(typedPrompt);
  if (extracted) {
    openBrowserPane(extracted, { navigate: "force" });
    await waitWebviewSettled(10000);
    await sleep(600);
  }

  activeAssistant = addMessage("assistant");
  appendThoughtStep(activeAssistant, "Sandbox tarayıcı hazırlanıyor…");
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
        projectPath,
        history: loop === 1 ? history : [],
        images: loop === 1 ? outgoingImages.map((image) => image.path) : [],
        browserLoop: true,
        promptForStats: loop === 1 ? promptForStats : "",
        container
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
    recordUsageRun(promptForStats, finalText || "");
    saveHistory($("#conversation"), projectPath);
    projectRuns.delete(projectKey(projectPath));
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
  }
}

function applyTheme(theme = userSettings.theme) {
  // Migrate legacy "dark" (eski yeşil koyu) users once: first install of brand skin
  if (theme === "dark" && !localStorage.getItem("agenthub:theme-v2")) {
    // keep pure dark only if user explicitly set after v2; old default dark was the green app
    theme = "brand";
    userSettings.theme = "brand";
    localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
  }
  localStorage.setItem("agenthub:theme-v2", "1");

  document.body.classList.remove("theme-light", "theme-dark", "theme-brand", "theme-zinc");
  let resolved = theme;
  if (theme === "system") {
    resolved = window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "brand";
  }
  // brand = TaxCLI yeşil ana · dark/zinc = saf dark · light = açık
  if (resolved === "light") {
    document.body.classList.add("theme-light");
  } else if (resolved === "dark" || resolved === "zinc") {
    document.body.classList.add("theme-zinc", "theme-dark");
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
  list.innerHTML = levels.map((level) => {
    const titles = { low: "Düşük", medium: "Orta", high: "Yüksek", ultra: "Ultra", max: "Maks" };
    return `<button type="button" data-effort="${level}" class="${effortLevel === level ? "selected" : ""}"><i class="fa-solid ${effortLevel === level ? "fa-check" : "fa-circle"}"></i><span class="model-option-text"><strong>${titles[level] || level}</strong></span></button>`;
  }).join("");
  $$("[data-effort]").forEach((button) => button.addEventListener("click", () => {
    effortLevel = button.dataset.effort;
    localStorage.setItem("agenthub:effort", effortLevel);
    updateEffortButton();
    $("#effortDropdown")?.classList.remove("open");
  }));
  updateEffortButton();
}

function updateEffortButton() {
  const btn = $("#effortButton");
  if (!btn) return;
  btn.innerHTML = `Efor · ${effortLevel} <i class="fa-solid fa-chevron-down"></i>`;
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
}

function showView(view) {
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
      if (content && activePanel && activePanel.offsetHeight < 8) {
        activePanel.style.display = "block";
        activePanel.style.visibility = "visible";
        activePanel.style.opacity = "1";
        activePanel.style.height = "auto";
      }
    });
    refreshUsageUi();
    renderSettingsPlugins();
  }
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

function projectKey(projectPath = $("#projectPath").value) {
  return String(projectPath || "").trim() || "__none__";
}

function setRichText(container, text) {
  container.dataset.rawText = String(text || "");
  container.innerHTML = markdownToHtml(container.dataset.rawText);
}

function appendRichText(container, text) {
  setRichText(container, `${container.dataset.rawText || ""}${text || ""}`);
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
    const rejected = (message.match(/'([^']+)'\s+model is not supported/i) || [])[1];
    if (/not supported when using Codex with a ChatGPT account/i.test(message)) {
      return {
        error: rejected
          ? `'${rejected}' ChatGPT oturumuyla Codex’te desteklenmiyor. Model menüsünden gpt-5.4 / gpt-5.6-luna dene.`
          : "Seçilen model ChatGPT oturumuyla Codex’te desteklenmiyor. gpt-5.4 veya gpt-5.6-luna dene."
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
  const stats = `<span class="diff-stats">${existing.added ? `<em class="add">+${existing.added}</em>` : ""}${existing.removed ? `<em class="del">-${existing.removed}</em>` : ""}${!existing.added && !existing.removed ? "<em>düzenleniyor</em>" : ""}</span>`;
  card.innerHTML = `
    <header><span class="diff-lang">${escapeHtml(existing.language)}</span><strong title="${escapeHtml(key)}">${escapeHtml(shortPath(key))}</strong>${stats}</header>
    <div class="diff-body">${existing.diff ? renderDiffHtml(existing.diff) : '<div class="diff-line ctx"><code>Değişiklikler uygulanıyor…</code></div>'}</div>`;
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
  if (/not supported when using Codex with a ChatGPT account/i.test(message)) {
    return rejected
      ? `'${rejected}' ChatGPT oturumuyla desteklenmiyor. gpt-5.4 veya gpt-5.6-luna dene.`
      : String(message);
  }
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
      text = "Gemini: -y ve --approval-mode birlikte kullanılamaz. TaxCLI yalnızca --approval-mode=yolo kullanır; uygulamayı yenile.";
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
    friendly = "Gemini bayrak çakışması giderildi. Uygulamayı yeniden başlatıp tekrar dene.";
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

function addMessage(role, content = "") {
  $("#workspaceView").classList.add("has-messages");
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `<span class="message-avatar">${role === "user" ? "SEN" : engines.find((item) => item.id === activeEngine)?.initial || "AI"}</span><div class="message-body"><div class="message-head">${role === "user" ? "Sen" : engines.find((item) => item.id === activeEngine)?.name || "Ajan"}<time>${nowLabel()}</time></div><div class="message-content"></div></div>`;
  const messageContent = article.querySelector(".message-content");
  if (role === "assistant") {
    const parts = ensureAssistantParts(messageContent);
    if (content) setRichText(parts.response, content);
  } else {
    setRichText(messageContent, content);
  }
  $("#conversation").appendChild(article);
  $("#conversation").scrollTop = $("#conversation").scrollHeight;
  return messageContent;
}

function setRunning(running, statusText = "") {
  isRunning = running;
  $("#sendButton").classList.toggle("running", running);
  $("#sendButton").textContent = running ? "■" : "↑";
  $("#sendButton").title = running ? "Durdur" : "Gönder";
  $("#runStatus").textContent = statusText || (running ? "Çalışıyor…" : "");
  renderProjects();
}

function historyKey(projectPath = $("#projectPath").value) {
  return `agenthub:history:${projectPath || "default"}`;
}

function collectMessagesFromRoot(root = $("#conversation")) {
  return [...root.querySelectorAll(".message")].map((message) => {
    const contentEl = message.querySelector(".message-content");
    const role = message.classList.contains("user") ? "user" : "assistant";
    if (role === "assistant" && contentEl?.classList.contains("assistant-stream")) {
      const activity = serializeActivity(contentEl);
      const content = responseRawText(contentEl).trim().slice(0, 12000);
      return { role, content, activity };
    }
    return {
      role,
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
    const content = addMessage(hydrated.role, hydrated.content || "");
    if (hydrated.role === "assistant" && hydrated.activity?.length) restoreActivity(content, hydrated.activity);
    return content;
  }
  const article = document.createElement("article");
  article.className = `message ${hydrated.role}`;
  article.innerHTML = `<span class="message-avatar">${hydrated.role === "user" ? "SEN" : "AI"}</span><div class="message-body"><div class="message-head">${hydrated.role === "user" ? "Sen" : "Ajan"}<time></time></div><div class="message-content"></div></div>`;
  const content = article.querySelector(".message-content");
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

function readLocalHistory(projectPath = $("#projectPath").value) {
  try {
    const messages = JSON.parse(localStorage.getItem(historyKey(projectPath)) || "[]");
    return Array.isArray(messages) ? messages.filter((item) => item?.content?.trim() || item?.activity?.length).slice(-40) : [];
  } catch {
    return [];
  }
}

function getHistoryForAgent(projectPath = $("#projectPath").value) {
  const live = collectMessagesFromRoot($("#conversation"));
  const source = live.length ? live : readLocalHistory(projectPath);
  const noise = /(?:529|yoğunluk hatası|yanıt vermedi|PROVIDER_OVERLOADED|MODEL_TIMEOUT|Çalışma durduruldu|Ajan \d+ koduyla|sağlayıcı yoğun|API anahtarı|Bağlam alındı|Sonraki isteklerde buna göre|Görev tamamlandı\.?\s*$)/i;
  return source
    .filter((item) => item?.content?.trim() && !noise.test(item.content))
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 1800) }));
}

function saveHistory(root = $("#conversation"), projectPath = $("#projectPath").value) {
  if (!userSettings.localHistory) return;
  const messages = collectMessagesFromRoot(root).slice(-40);
  localStorage.setItem(historyKey(projectPath), JSON.stringify(messages));
  if (projectPath && pathIsAbsolute(projectPath)) {
    window.agentHub.saveHistoryFile({ projectPath, messages }).catch(() => { /* Ignore disk history errors. */ });
  }
}

function pathIsAbsolute(value) {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(String(value || ""));
}

async function loadHistory(into = $("#conversation"), projectPath = $("#projectPath").value) {
  into.innerHTML = "";
  if (into === $("#conversation")) $("#workspaceView").classList.remove("has-messages");
  if (!userSettings.localHistory) return;
  let local = readLocalHistory(projectPath);
  let disk = [];
  if (pathIsAbsolute(projectPath)) {
    try { disk = await window.agentHub.loadHistoryFile(projectPath); } catch { disk = []; }
  }
  const score = (messages = []) => messages.reduce((sum, item) => sum + (item.activity?.length || 0) * 10 + (String(item.content || "").length > 0 ? 1 : 0), 0);
  let messages = score(disk) > score(local) ? disk : local;
  if (!messages.length) messages = disk.length ? disk : local;
  if (messages.length) localStorage.setItem(historyKey(projectPath), JSON.stringify(messages.slice(-40)));
  messages.forEach((message) => renderStoredMessage(message, into));
  if (into === $("#conversation") && messages.length) $("#workspaceView").classList.add("has-messages");
}

function parkCurrentConversation() {
  const key = projectKey();
  if (key === "__none__" && !$("#conversation").childNodes.length) return;
  if ($("#projectPath").value) saveHistory($("#conversation"), $("#projectPath").value);
  const holder = document.createElement("div");
  holder.dataset.projectKey = key;
  while ($("#conversation").firstChild) holder.appendChild($("#conversation").firstChild);
  parkedConversations.set(key, holder);
}

async function restoreConversation(projectPath) {
  const key = projectKey(projectPath);
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
    await loadHistory($("#conversation"), projectPath);
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
    appendThoughtStep(container, "Düşünüyor…");
    if (isCurrent) $("#runStatus").textContent = "Düşünüyor…";
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
    addEventRow(container, payload.message, true);
    // Only mark models unavailable on true timeouts — not temporary NVIDIA 529 overload.
    if (payload.code === "MODEL_TIMEOUT" && ["opencode", "nvidia"].includes(payload.engineId)) {
      if (payload.model) unavailableModels[payload.model] = Date.now();
      localStorage.setItem("agenthub:unavailable-models", JSON.stringify(unavailableModels));
      if (payload.engineId === "opencode") modelByEngine.opencode = "opencode/deepseek-v4-flash-free";
      localStorage.setItem("agenthub:models", JSON.stringify(modelByEngine));
      if (isCurrent && activeEngine === "opencode") updateModelButton();
      if (isCurrent) toast("Yanıtsız model 30 dakika pasifleştirildi; çalışan DeepSeek ücretsiz modele geçildi.", "error");
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
      if (payload.code == null) {
        setRichText(parts.response, "Çalışma durduruldu.");
      } else if (payload.code === 41) {
        setRichText(parts.response, "Gemini kimlik doğrulama hatası. Bağlantılar → Gemini → API Key.");
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
        setRichText(parts.response, `Ajan ${payload.code} koduyla sonlandı.`);
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
          stopped: payload.code == null
        });
      } catch { /* ignore */ }
      meta.waitResolve = null;
    }
    if (meta?.promptForStats != null && !meta?.browserLoop) {
      recordUsageRun(meta.promptForStats, replyText);
    } else if (!meta?.browserLoop) {
      recordUsageRun("", replyText);
    }
    if (fileList.length) {
      usageStats.edits = (usageStats.edits || 0) + fileList.length;
      persistUsage();
    }
    if (path && !meta?.browserLoop) {
      projectRuns.delete(projectKey(path));
      const holder = parkedConversations.get(projectKey(path));
      saveHistory(holder || $("#conversation"), path);
    }
    runMeta.delete(payload.runId);
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

async function runPrompt() {
  if (isRunning) {
    if (activeRun) await window.agentHub.stopAgent(activeRun);
    $("#runStatus").textContent = "Durduruluyor…";
    return;
  }
  const typedPrompt = $("#prompt").value.trim();
  if (!typedPrompt && !selectedImages.length) return toast("Bir görev yazın veya resim ekleyin.", "error");
  let prompt = typedPrompt || "Bu görseli ayrıntılı biçimde incele ve önemli bulguları açıkla.";
  const installed = detected.find((item) => item.id === activeEngine)?.installed;
  if (!installed) {
    const name = engines.find((item) => item.id === activeEngine)?.name || activeEngine;
    if (activeEngine === "copilot") {
      return toast("Copilot CLI kurulu değil. Bağlantılar → Copilot → «Copilot CLI kur».", "error");
    }
    return toast(`${name} CLI bu bilgisayarda kurulu değil.`, "error");
  }
  if (!$("#projectPath").value) {
    await addNewProject();
    if (!$("#projectPath").value) return;
    showView("workspace");
  }
  const projectPath = $("#projectPath").value;
  if (projectPath) {
    const opened = usageStats.projectsOpened || [];
    if (!opened.includes(projectPath)) {
      usageStats.projectsOpened = [...opened, projectPath].slice(-80);
      persistUsage();
    }
  }
  if (contextFlags.plan || approvalMode === "plan") {
    approvalMode = "plan";
    contextFlags.plan = true;
    localStorage.setItem("agenthub:approval", "plan");
  }

  const history = getHistoryForAgent(projectPath);
  const outgoingImages = [...selectedImages];
  const userMessage = addMessage("user", typedPrompt || prompt);
  addImagesToMessage(userMessage, outgoingImages);
  $("#prompt").value = "";
  selectedImages = [];
  renderAttachmentTray();

  // Browser chip → sandboxed multi-step control loop (agent drives the side webview)
  if (contextFlags.browser) {
    await runBrowserControlledSession({
      typedPrompt: typedPrompt || prompt,
      projectPath,
      history,
      outgoingImages,
      promptForStats: typedPrompt || prompt
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
  if (userSettings.rulesText?.trim()) {
    prompt = `${userSettings.rulesText.trim()}\n\n${prompt}`;
  }
  activeAssistant = addMessage("assistant");
  appendThoughtStep(activeAssistant, history.length ? `Önceki ${history.length} mesajla devam…` : "Düşünüyor…");
  setRunning(true, history.length ? `Bağlam: ${history.length} mesaj` : "Düşünüyor…");
  try {
    const result = await window.agentHub.startAgent({
      engineId: activeEngine,
      prompt,
      history,
      images: outgoingImages.map((image) => image.path),
      projectPath,
      model: modelByEngine[activeEngine] || "",
      approvalMode,
      effort: effortLevel,
      experimentalEffort: Boolean(userSettings.experimentalEffort),
      useWorktrees: Boolean(userSettings.useWorktrees),
      worktreeBase: userSettings.worktreeBase || "main",
      browserSession: false,
      browserUrl: "",
      rules: userSettings.rulesText || "",
      allowShell: userSettings.allowShell !== false,
      allowMcp: Boolean(userSettings.allowMcp),
      debugStream: Boolean(userSettings.debugStream)
    });
    activeRun = result.runId;
    activeAssistant.dataset.runId = result.runId;
    projectRuns.set(projectKey(projectPath), result.runId);
    runMeta.set(result.runId, {
      projectPath,
      status: history.length ? `Bağlam: ${history.length} mesaj` : "Düşünüyor…",
      promptForStats: typedPrompt || prompt
    });
    if (result.visionNote && userSettings.visionWarnings !== false) toast(result.visionNote, "error");
    renderProjects();
  } catch (error) {
    const parts = ensureAssistantParts(activeAssistant);
    setRichText(parts.response, error.message);
    finishThinking(activeAssistant, "Hata");
    setRunning(false);
    activeAssistant = null;
    toast(error.message, "error");
  }
}

function renderPlugins() {
  $("#pluginGrid").innerHTML = plugins.map((plugin) => {
    const connected = connectedPlugins.has(plugin.id);
    let action = "Giriş yap";
    if (!plugin.ready) action = "Yakında";
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
      if (status[plugin.id]) connectedPlugins.add(plugin.id);
      else connectedPlugins.delete(plugin.id);
    }
    renderPlugins();
  } catch (error) { toast(`Eklenti durumları alınamadı: ${error.message}`, "error"); }
}

function renderEngines() {
  const byId = Object.fromEntries(detected.map((item) => [item.id, item]));
  $("#engineStrip").innerHTML = engines.map((engine) => {
    const info = byId[engine.id] || {};
    const ready = info.installed && info.authenticated;
    return `<button class="engine-chip ${engine.id === activeEngine ? "active" : ""} ${info.installed ? "installed" : ""} ${ready ? "authed" : ""}" data-engine="${engine.id}">${renderEngineLogo(engine)}<span class="mini-dot"></span>${engine.name}</button>`;
  }).join("");
  $("#connectionList").innerHTML = engines.map((engine) => {
    const info = byId[engine.id] || {};
    const installed = Boolean(info.installed);
    const authenticated = Boolean(info.authenticated);
    const detail = info.detail || (installed ? "CLI algılandı" : "CLI henüz bulunamadı");
    const isApiKey = info.loginMode === "api-key" || engine.id === "nvidia" || engine.id === "gemini";
    const needsCursorAgent = engine.id === "cursor" && /Agent CLI/i.test(detail) && !authenticated;
    const needsCopilotCli = engine.id === "copilot" && !installed;
    const loginLabel = isApiKey
      ? "API Key"
      : needsCursorAgent
        ? "Agent CLI kur"
        : needsCopilotCli
          ? "Copilot CLI kur"
          : engine.login;
    const stateLabel = authenticated
      ? "BAĞLI"
      : needsCursorAgent || needsCopilotCli
        ? "CLI YOK"
        : installed
          ? "GİRİŞ YOK"
          : "BULUNAMADI";
    const stateClass = authenticated ? "ready" : (installed || needsCursorAgent || needsCopilotCli) ? "installed" : "";
    return `<article class="connection">
      <span class="connection-logo">${renderEngineLogo(engine)}</span>
      <div class="connection-info"><strong>${engine.name}</strong><small>${escapeHtml(detail)}</small></div>
      <span class="connection-state ${stateClass}">${stateLabel}</span>
      <div class="connection-actions">
        <button data-login="${engine.id}" ${installed || isApiKey || needsCursorAgent || needsCopilotCli ? "" : "disabled"} title="${loginLabel}">${loginLabel}</button>
      </div>
    </article>`;
  }).join("");

  $$('[data-engine]').forEach((button) => button.addEventListener("click", () => {
    activeEngine = button.dataset.engine;
    localStorage.setItem("agenthub:engine", activeEngine);
    updateModelButton();
    renderEffortDropdown();
    renderEngines();
  }));
  $$('[data-login]').forEach((button) => button.addEventListener("click", async () => {
    const engineId = button.dataset.login;
    try {
      if (engineId === "nvidia" || engineId === "gemini") return openApiKeyModal(engineId);
      const result = await window.agentHub.loginEngine(engineId);
      if (result?.apiKey) return openApiKeyModal(engineId);
      toast(result?.message || "Giriş penceresi açıldı.");
      setTimeout(() => detectEngines(true), 3500);
    } catch (error) { toast(error.message, "error"); }
  }));
}

let apiKeyProvider = "nvidia";
async function openApiKeyModal(providerId = "nvidia") {
  apiKeyProvider = providerId;
  $("#apiKeyModalTitle").textContent = providerId === "nvidia" ? "NVIDIA API Anahtarı" : providerId === "gemini" ? "Gemini API Anahtarı" : "API Anahtarı";
  $("#apiKeyModalCopy").textContent = providerId === "gemini"
    ? "Anahtar aihub içinde saklanır ve GEMINI_API_KEY olarak Gemini CLI’ye verilir. Google AI Studio / Generative Language API anahtarı kullan."
    : "Anahtar bu bilgisayarda saklanır ve OpenCode kimlik deposuna (auth.json) da yazılır; böylece terminalle aynı şekilde çalışır.";
  $("#apiKeyInput").value = "";
  try {
    const current = await window.agentHub.getProviderKey(providerId);
    if (current.configured) $("#apiKeyModalCopy").textContent = `Kayıtlı anahtar: ${current.hint}. Yeni değer kaydedersen üzerine yazılır.`;
  } catch { /* ignore */ }
  openModal("apiKeyModal");
  $("#apiKeyInput").focus();
}

async function detectEngines(quiet = false) {
  const button = $("#refreshEngines");
  button?.classList.add("scanning");
  button?.setAttribute("disabled", "true");
  if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Taranıyor…';
  try {
    detected = await window.agentHub.detectEngines();
    // Force model lists to reload (especially Copilot live catalog)
    ["copilot", "cursor", "opencode", "nvidia"].forEach((id) => { delete availableModels[id]; });
    renderEngines();
    if (!quiet) toast("Bağlantılar yenilendi.");
  } catch (error) { toast(`Motorlar taranamadı: ${error.message}`, "error"); }
  finally {
    button?.classList.remove("scanning");
    button?.removeAttribute("disabled");
    if (button) button.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Yeniden tara';
  }
}

function updateModelButton() {
  const engineName = engines.find((item) => item.id === activeEngine)?.name || activeEngine;
  const selectedId = modelByEngine[activeEngine] || "";
  const match = normalizeModelEntries(availableModels[activeEngine] || []).find((item) => item.id === selectedId);
  const modelLabel = match?.label || selectedId || "Varsayılan";
  $("#modelButton").innerHTML = `${escapeHtml(engineName)} · ${escapeHtml(modelLabel)} <i class="fa-solid fa-chevron-down"></i>`;
}

function toggleMenu(id, force) {
  const menu = $(`#${id}`);
  $$(".popup-menu").forEach((item) => { if (item !== menu) item.classList.remove("open"); });
  menu.classList.toggle("open", force ?? !menu.classList.contains("open"));
}

function openModal(id) { $(`#${id}`).classList.add("open"); }
function closeModal(id) { $(`#${id}`).classList.remove("open"); }

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
    : plugin.auth === "opencode-provider" ? "OpenCode'un güvenli provider giriş ekranında NVIDIA API anahtarını bağla."
    : `${plugin.name} sağlayıcısının gerçek OAuth giriş akışını başlat.`;
  $("#confirmPlugin").textContent = connectedPlugins.has(plugin.id)
    ? (plugin.auth === "local" ? "Eklentiyi kaldır" : "Durumu yenile")
    : (plugin.auth === "local" ? "Yükle" : plugin.auth === "opencode-provider" ? "NVIDIA API bağla" : "Giriş yap");
  openModal("pluginModal");
}

function updateBrowserAvailability() {
  $("#toolPluginItems").innerHTML = plugins
    .filter((plugin) => connectedPlugins.has(plugin.id) && plugin.id !== "browser")
    .map((plugin) => `<button data-tool-plugin="${plugin.id}"><i class="${plugin.icon}"></i>${plugin.name}</button>`)
    .join("");
  $$("[data-tool-plugin]").forEach((button) => button.addEventListener("click", () => {
    toggleMenu("toolMenu", false);
    openPluginModal(button.dataset.toolPlugin);
  }));
  renderSettingsPlugins();
}

function updateApprovalLabel() {
  const labels = { ask: "Her işlemde sor", auto_edit: "Düzenlemeleri onayla", plan: "Plan / yalnızca oku" };
  $("#approvalLabel").textContent = labels[approvalMode] || labels.ask;
  $("#approvalButton")?.classList.toggle("active-mode", approvalMode === "plan" || contextFlags.plan);
  $$(".approval-option").forEach((btn) => btn.classList.toggle("selected", btn.dataset.approval === approvalMode));
}

const modelPresets = {
  codex: ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.4-mini"],
  opencode: ["openai/gpt-5.6-codex", "anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro"],
  cursor: ["auto"],
  copilot: [
    "auto",
    "claude-sonnet-4.6",
    "gpt-5.4",
    "claude-haiku-4.5",
    "gpt-5.3-codex",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "mai-code-1-flash"
  ],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview", "gemini-3.1-pro-preview"],
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

function renderModelList(query = "") {
  const models = normalizeModelEntries(availableModels[activeEngine] || []);
  const q = query.toLowerCase().trim();
  const filtered = models.filter((model) => {
    if (!q) return true;
    return model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q);
  });
  const selected = modelByEngine[activeEngine] || "";
  if (!filtered.length) {
    $("#modelList").innerHTML = '<div class="model-empty">Model bulunamadı.</div>';
    return;
  }
  const rows = [{ id: "", label: "Varsayılan model" }, ...filtered];
  $("#modelList").innerHTML = rows.map((model) => {
    const failedAt = unavailableModels[model.id] || 0;
    const temporarilyUnavailable = model.id && Date.now() - failedAt < 30 * 60 * 1000;
    const isSelected = selected === model.id;
    const showId = model.id && model.label && model.label !== model.id;
    return `<button data-model-value="${escapeHtml(model.id)}" class="${isSelected ? "selected" : ""}" ${temporarilyUnavailable ? "disabled" : ""} title="${escapeHtml(model.id || "varsayılan")}"><i class="fa-solid ${temporarilyUnavailable ? "fa-triangle-exclamation" : isSelected ? "fa-check" : "fa-circle"}"></i><span class="model-option-text"><strong>${escapeHtml(model.label || model.id || "Varsayılan model")}</strong>${showId ? `<small>${escapeHtml(model.id)}</small>` : ""}${temporarilyUnavailable ? "<small>yanıt vermedi</small>" : ""}</span></button>`;
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
  dropdown.classList.add("open");
  $("#modelSearch").value = "";
  $("#modelList").innerHTML = '<div class="model-loading"><i class="fa-solid fa-spinner fa-spin"></i> Modeller yükleniyor…</div>';
  if (!availableModels[activeEngine]) {
    try {
      if (["opencode", "nvidia", "cursor", "copilot"].includes(activeEngine)) {
        availableModels[activeEngine] = await window.agentHub.listModels(activeEngine);
        // invalidate stale wrong-shape caches (e.g. unfiltered chat models)
        if (activeEngine === "copilot") {
          localStorage.setItem("agenthub:copilot-model-cache-v2", JSON.stringify(availableModels[activeEngine]));
          localStorage.removeItem("agenthub:copilot-model-cache");
        } else {
          localStorage.setItem(`agenthub:${activeEngine}-model-cache`, JSON.stringify(availableModels[activeEngine]));
        }
      } else {
        availableModels[activeEngine] = modelPresets[activeEngine] || [];
      }
    } catch (error) {
      let cached = [];
      try {
        cached = JSON.parse(
          localStorage.getItem(activeEngine === "copilot" ? "agenthub:copilot-model-cache-v2" : `agenthub:${activeEngine}-model-cache`)
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

function applyUserSettings() {
  setField("settingsDisplayName", userSettings.displayName);
  setField("settingsInitials", userSettings.initials);
  setField("settingsKeepHistory", userSettings.keepHistory, true);
  setField("settingsLocalHistory", userSettings.localHistory, true);
  setField("settingsHomepage", userSettings.homepage);
  setField("settingsTips", userSettings.tips, true);
  setField("settingsWindowRestore", userSettings.windowRestore);
  setField("settingsSystemNotifications", userSettings.systemNotifications, true);
  setField("settingsWarningNotifications", userSettings.warningNotifications, true);
  setField("settingsTrayIcon", userSettings.trayIcon, true);
  setField("settingsCompletionSound", userSettings.completionSound, true);
  setField("settingsTheme", userSettings.theme);
  setField("settingsCompactSidebar", userSettings.compactSidebar, true);
  setField("settingsRestoreProject", userSettings.restoreProject, true);
  setField("settingsAutoMemory", userSettings.autoMemory, true);
  setField("settingsDefaultEngine", userSettings.defaultEngine);
  setField("settingsDefaultApproval", userSettings.defaultApproval);
  setField("settingsParallelRuns", userSettings.parallelRuns, true);
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

  $("#profileName").textContent = userSettings.displayName;
  $("#profileAvatar").textContent = userSettings.initials;
  const avatarLg = $("#profileAvatarLg");
  if (avatarLg) avatarLg.textContent = userSettings.initials;
  const preview = $("#profileDisplayPreview");
  if (preview) preview.textContent = userSettings.displayName;
  const handle = $("#profileHandlePreview");
  if (handle) {
    const slug = String(userSettings.displayName || "yerel").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18) || "yerel";
    handle.textContent = `@${slug}`;
  }
  $$(".settings-user-name").forEach((element) => { element.textContent = userSettings.displayName; });
  $$(".settings-avatar").forEach((element) => { element.textContent = userSettings.initials; });
  if ($("#browserUrl") && !isBrowserPaneOpen() && !contextFlags.browser) {
    const cur = $("#browserUrl").value?.trim() || "";
    if (!cur || cur === "https://www.google.com" || cur === "about:blank") {
      $("#browserUrl").value = userSettings.homepage || "https://www.google.com";
    }
  }

  applyTheme(userSettings.theme);
  document.body.classList.toggle("compact-sidebar", Boolean(userSettings.compactSidebar));
  document.body.classList.toggle("beta-badge", Boolean(userSettings.betaBadge));
  const tipEl = $("#heroTip");
  if (tipEl) tipEl.style.display = userSettings.tips ? "" : "none";
  refreshUsageUi();
  renderSettingsPlugins();
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
    initials: String(val("settingsInitials", "TA")).trim().toUpperCase().slice(0, 3) || "TA",
    keepHistory: Boolean(val("settingsKeepHistory", true)),
    localHistory: Boolean(val("settingsLocalHistory", true)),
    homepage: String(val("settingsHomepage", "https://www.google.com")).trim() || "https://www.google.com",
    tips: Boolean(val("settingsTips", true)),
    windowRestore: String(val("settingsWindowRestore", "default")),
    systemNotifications: Boolean(val("settingsSystemNotifications", true)),
    warningNotifications: Boolean(val("settingsWarningNotifications", false)),
    trayIcon: Boolean(val("settingsTrayIcon", true)),
    completionSound: Boolean(val("settingsCompletionSound", false)),
    theme: String(val("settingsTheme", "brand")),
    compactSidebar: Boolean(val("settingsCompactSidebar", false)),
    restoreProject: Boolean(val("settingsRestoreProject", true)),
    autoMemory: Boolean(val("settingsAutoMemory", true)),
    defaultEngine: String(val("settingsDefaultEngine", "codex")),
    defaultApproval: String(val("settingsDefaultApproval", "ask")),
    parallelRuns: Boolean(val("settingsParallelRuns", false)),
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
    betaBadge: Boolean(val("settingsBetaBadge", false))
  };
  try {
    const parsed = new URL(next.homepage);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    if (showConfirmation) toast("Tarayıcı ana sayfası geçerli bir HTTP/HTTPS adresi olmalı.", "error");
    return false;
  }
  userSettings = next;
  localStorage.setItem("agenthub:user-settings", JSON.stringify(userSettings));
  applyUserSettings();
  if (showConfirmation) toast("Kullanıcı ayarları kaydedildi.");
  return true;
}

function renderProjects() {
  if (!projects.length) {
    $("#projectList").innerHTML = '<div class="project-empty">Henüz proje eklenmedi</div>';
    renderSettingsProjects();
    return;
  }
  $("#projectList").innerHTML = projects.map((project) => {
    const running = projectRuns.has(projectKey(project.path));
    return `<button class="project ${project.id === selectedProjectId ? "active" : ""} ${running ? "running" : ""}" data-project-id="${escapeHtml(project.id)}"><i class="fa-regular fa-folder folder-icon"></i><span><strong>${escapeHtml(project.name)}${running ? '<em class="project-run-badge">çalışıyor</em>' : ""}</strong><small>${escapeHtml(project.path)}</small></span></button>`;
  }).join("");
  $$('[data-project-id]').forEach((button) => button.addEventListener("click", async () => {
    try {
      const result = await window.agentHub.selectProject(button.dataset.projectId);
      applySelectedProject(result.project);
    } catch (error) { toast(error.message, "error"); }
  }));
  $$('[data-project-id]').forEach((button) => button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    contextProjectId = button.dataset.projectId;
    const menu = $("#projectContextMenu");
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 205)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 125)}px`;
    menu.classList.add("open");
  }));
  renderSettingsProjects();
}

function renderSettingsProjects() {
  $("#settingsProjectList").innerHTML = projects.length ? projects.map((project) => `<div class="project-setting"><i class="fa-regular fa-folder"></i><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.path)}</small></span><button data-remove-project="${escapeHtml(project.id)}" title="Listeden kaldır"><i class="fa-solid fa-trash-can"></i></button></div>`).join("") : '<div class="model-empty">Kayıtlı proje yok.</div>';
  $$('[data-remove-project]').forEach((button) => button.addEventListener("click", () => removeProjectRecord(button.dataset.removeProject)));
}

async function removeProjectRecord(projectId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project || !window.confirm(`${project.name} proje listesinden kaldırılsın mı? Proje dosyaları silinmeyecek.`)) return;
  const state = await window.agentHub.removeProject(projectId);
  projects = state.projects;
  selectedProjectId = state.selectedId;
  applySelectedProject(projects.find((item) => item.id === selectedProjectId) || null);
  toast("Proje listeden kaldırıldı; klasör ve dosyalar korunuyor.");
}

async function applySelectedProject(project) {
  const nextPath = project?.path || "";
  const previousPath = $("#projectPath").value;
  if (projectKey(previousPath) !== projectKey(nextPath)) parkCurrentConversation();
  selectedProjectId = project?.id || null;
  $("#projectPath").value = nextPath;
  $("#projectName").textContent = project?.name || "Proje seçilmedi";
  await restoreConversation(nextPath);
  renderProjects();
  showView("workspace");
}

async function loadProjects() {
  try {
    const state = await window.agentHub.listProjects();
    projects = state.projects || [];
    selectedProjectId = userSettings.restoreProject ? (state.selectedId || projects[0]?.id || null) : null;
    const selected = userSettings.restoreProject ? (projects.find((project) => project.id === selectedProjectId) || projects[0] || null) : null;
    if (selected && selected.id !== state.selectedId) await window.agentHub.selectProject(selected.id);
    applySelectedProject(selected);
  } catch (error) { toast(`Projeler yüklenemedi: ${error.message}`, "error"); renderProjects(); }
}

async function addNewProject() {
  const result = await window.agentHub.addProject();
  if (!result) return null;
  projects = result.state.projects;
  applySelectedProject(result.project);
  toast(`${result.project.name} proje listesine kaydedildi.`);
  return result.project;
}

$$('.nav-item').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("#addProject").addEventListener("click", addNewProject);
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
$("#checkForUpdates")?.addEventListener("click", async () => {
  const button = $("#checkForUpdates");
  const status = $("#updateStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = "Güncellemeler kontrol ediliyor…";
  try {
    const result = await window.agentHub.checkForUpdates();
    if (!result.supported) {
      if (status) status.textContent = result.message;
    } else if (result.latestVersion === result.currentVersion) {
      if (status) status.textContent = `TaxCLI ${result.currentVersion} güncel`;
    } else if (status) {
      status.textContent = `TaxCLI ${result.latestVersion} indiriliyor…`;
    }
  } catch (error) {
    if (status) status.textContent = "Güncelleme kontrolü başarısız";
    toast(error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
});
window.agentHub.onUpdateEvent?.((event) => {
  const status = $("#updateStatus");
  if (!status) return;
  if (event.type === "checking") status.textContent = "Güncellemeler kontrol ediliyor…";
  if (event.type === "available") status.textContent = `TaxCLI ${event.version} indiriliyor…`;
  if (event.type === "not-available") status.textContent = `TaxCLI ${event.version} güncel`;
  if (event.type === "progress") status.textContent = `Güncelleme indiriliyor: %${event.percent}`;
  if (event.type === "downloaded") status.textContent = `TaxCLI ${event.version} kurulmaya hazır`;
  if (event.type === "error") status.textContent = "Güncelleme kontrolü başarısız";
});
$("#newTask").addEventListener("click", () => {
  if (isRunning) return toast("Önce çalışan görevi durdurun.", "error");
  $("#conversation").innerHTML = "";
  $("#workspaceView").classList.remove("has-messages");
  parkedConversations.delete(projectKey());
  if (!userSettings.keepHistory) localStorage.removeItem(historyKey());
  showView("workspace");
  $("#prompt").focus();
});
$$('[data-prompt]').forEach((button) => button.addEventListener("click", () => { $("#prompt").value = button.dataset.prompt; $("#prompt").focus(); }));
$("#sendButton").addEventListener("click", runPrompt);
$("#modelButton").addEventListener("click", (event) => { event.stopPropagation(); toggleModelDropdown(); });
$("#modelDropdown").addEventListener("click", (event) => event.stopPropagation());
$("#modelSearch").addEventListener("input", (event) => renderModelList(event.target.value));
$("#effortButton")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const dropdown = $("#effortDropdown");
  const open = dropdown?.classList.contains("open");
  $$(".popup-menu").forEach((menu) => menu.classList.remove("open"));
  $("#modelDropdown")?.classList.remove("open");
  if (!open) {
    renderEffortDropdown();
    dropdown?.classList.add("open");
  }
});
$("#effortDropdown")?.addEventListener("click", (event) => event.stopPropagation());
$("#approvalButton").addEventListener("click", (event) => { event.stopPropagation(); toggleMenu("approvalMenu"); });
$$("[data-approval]").forEach((button) => button.addEventListener("click", () => {
  setApprovalMode(button.dataset.approval);
  toggleMenu("approvalMenu", false);
}));
$("#toolMenuButton").addEventListener("click", (event) => { event.stopPropagation(); toggleMenu("toolMenu"); });
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
  contextFlags.browser = true;
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
$$(".theme-card").forEach((card) => card.addEventListener("click", () => {
  if (card.disabled || card.classList.contains("soon")) return;
  userSettings.theme = card.dataset.theme;
  const themeInput = $("#settingsTheme");
  if (themeInput) themeInput.value = card.dataset.theme;
  localStorage.setItem("agenthub:user-settings", JSON.stringify({ ...userSettings }));
  applyTheme(userSettings.theme);
  toast(`Tema: ${card.dataset.theme}`);
}));
$("#resetUsageStats")?.addEventListener("click", () => {
  if (!window.confirm("Kullanım istatistikleri sıfırlansın mı?")) return;
  usageStats = { sessionStarted: Date.now(), totalMs: 0, projectsOpened: [], runs: 0, tokensEst: 0, edits: 0 };
  persistUsage();
  refreshUsageUi();
  toast("İstatistikler sıfırlandı.");
});
$("#clearModelCache")?.addEventListener("click", () => {
  ["opencode", "nvidia", "cursor"].forEach((id) => {
    localStorage.removeItem(`agenthub:${id}-model-cache`);
    delete availableModels[id];
  });
  toast("Model önbelleği temizlendi.");
});
$("#saveRulesSettings")?.addEventListener("click", () => collectAndSaveSettings(true));
$("#saveToolsSettings")?.addEventListener("click", () => collectAndSaveSettings(true));
$("#rebuildIndexHint")?.addEventListener("click", () => {
  const projectPath = $("#projectPath").value;
  if (!projectPath) return toast("Önce bir proje seçin.", "error");
  toast("Proje hafızası bir sonraki ajan koşusunda yenilenir.");
});
$("#profileMenuButton").addEventListener("click", (event) => { event.stopPropagation(); toggleMenu("profileMenu"); });
$$("[data-view-target]").forEach((button) => button.addEventListener("click", () => { showView(button.dataset.viewTarget); $$(".popup-menu").forEach((menu) => menu.classList.remove("open")); }));
$("#clearHistory").addEventListener("click", () => {
  localStorage.removeItem(historyKey());
  $("#conversation").innerHTML = "";
  $("#workspaceView").classList.remove("has-messages");
  toggleMenu("profileMenu", false);
  toast("Bu projenin konuşma geçmişi temizlendi.");
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
        connectedPlugins.add("browser");
        contextFlags.browser = true;
        renderContextChips();
      }
      localStorage.setItem("agenthub:plugins", JSON.stringify([...connectedPlugins]));
      closeModal("pluginModal");
      renderPlugins();
      return toast(`Tarayıcı ${connectedPlugins.has("browser") ? "etkin" : "kaldırıldı"}.`);
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
    closeModal("apiKeyModal");
    toast(`${apiKeyProvider.toUpperCase()} API anahtarı kaydedildi.`);
    await detectEngines(true);
    await refreshPluginStatus();
  } catch (error) { toast(error.message, "error"); }
});
$("#clearApiKey").addEventListener("click", async () => {
  try {
    await window.agentHub.clearProviderKey(apiKeyProvider);
    $("#apiKeyInput").value = "";
    toast("API anahtarı silindi.");
    await detectEngines(true);
    await refreshPluginStatus();
  } catch (error) { toast(error.message, "error"); }
});
$$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.classList.remove("open"); }));
function navigateBrowser() {
  let url = $("#browserUrl").value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url) ? `http://${url}` : `https://${url}`;
  if (!navigateAgentBrowser(url, { force: true })) toast("Yalnızca geçerli HTTP/HTTPS adresleri açılabilir.", "error");
}
async function openTerminal() {
  const projectPath = $("#projectPath").value;
  if (!projectPath) return toast("Önce bir proje seçin.", "error");
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
$("#saveSettings").addEventListener("click", () => collectAndSaveSettings(true));
$$("#userSettingsView input[type='checkbox'],#userSettingsView select").forEach((control) => control.addEventListener("change", () => collectAndSaveSettings(false)));
$("#settingsBack").addEventListener("click", () => showView("workspace"));
$$("[data-settings-section]").forEach((button) => button.addEventListener("click", () => {
  showSettingsSection(button.dataset.settingsSection);
}));
$("#settingsSearch").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLocaleLowerCase("tr-TR");
  $$("[data-settings-section]").forEach((button) => {
    button.classList.toggle("search-hidden", query && !button.textContent.toLocaleLowerCase("tr-TR").includes(query));
  });
  // Hide category labels that have no visible buttons after them
  $$(".settings-nav-label").forEach((label) => {
    let el = label.nextElementSibling;
    let any = false;
    while (el && !el.classList.contains("settings-nav-label")) {
      if (el.matches?.("[data-settings-section]") && !el.classList.contains("search-hidden")) any = true;
      el = el.nextElementSibling;
    }
    label.style.display = query && !any ? "none" : "";
  });
});
$("#clearAllData").addEventListener("click", () => {
  if (!window.confirm("Tüm yerel TaxCLI ayarları, eklenti tercihleri ve konuşma geçmişi silinsin mi?")) return;
  localStorage.clear();
  location.reload();
});
$("#minimizeWindow").addEventListener("click", () => window.agentHub.minimizeWindow());
$("#maximizeWindow").addEventListener("click", () => window.agentHub.maximizeWindow());
$("#closeWindow").addEventListener("click", () => window.agentHub.closeWindow());
document.addEventListener("click", () => {
  $$(".popup-menu").forEach((menu) => menu.classList.remove("open"));
  $("#modelDropdown")?.classList.remove("open");
  $("#effortDropdown")?.classList.remove("open");
  $("#projectContextMenu")?.classList.remove("open");
});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); runPrompt(); }
});
$$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "n") { event.preventDefault(); showView("workspace"); $("#prompt").focus(); }
  if (event.ctrlKey && event.code === "Backquote") { event.preventDefault(); $("#terminalDrawer").classList.contains("open") ? closeTerminal() : openTerminal(); }
});

window.agentHub.onAgentEvent((payload) => {
  let container = findRunContainer(payload.runId);
  if (!container && activeRun === payload.runId && activeAssistant) container = activeAssistant;
  if (!container && !runMeta.has(payload.runId) && activeAssistant && (!activeRun || activeRun === payload.runId)) {
    container = activeAssistant;
    if (payload.runId) {
      activeRun = payload.runId;
      container.dataset.runId = payload.runId;
      runMeta.set(payload.runId, { projectPath: $("#projectPath").value, status: "Düşünüyor…" });
      projectRuns.set(projectKey(), payload.runId);
    }
  }
  if (!container) return;

  const meta = runMeta.get(payload.runId);
  const isCurrent = projectKey(meta?.projectPath || $("#projectPath").value) === projectKey();
  applyAgentPayload(container, payload, isCurrent);
  if (isCurrent) $("#conversation").scrollTop = $("#conversation").scrollHeight;
});

renderPlugins();
renderEngines();
try { Object.assign(modelByEngine, JSON.parse(localStorage.getItem("agenthub:models") || "{}")); } catch { /* Ignore invalid model preferences. */ }
// ChatGPT Codex rejects sol and retired *-codex IDs; pin a supported default.
if (!modelByEngine.codex || /\b(sol|codex)(-mini)?\b/i.test(String(modelByEngine.codex))) {
  modelByEngine.codex = "gpt-5.4";
  localStorage.setItem("agenthub:models", JSON.stringify(modelByEngine));
}
updateModelButton();
renderEffortDropdown();
updateApprovalLabel();
renderContextChips();
applyUserSettings();
setupComposerImageDrop();
loadProjects();
detectEngines();
refreshPluginStatus();
rotateTip();
setInterval(() => { if (userSettings.tips) rotateTip(); }, 12000);
setInterval(() => { accumulateSessionTime(); }, 60000);
window.addEventListener("beforeunload", () => {
  accumulateSessionTime();
  if ($("#projectPath").value) saveHistory($("#conversation"), $("#projectPath").value);
});