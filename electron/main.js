const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { autoUpdater } = require("electron-updater");

const ENGINE_COMMANDS = {
  codex: {
    command: "codex",
    aliases: [],
    loginArgs: ["login"],
    authArgs: ["login", "status"],
    accountLabel: "ChatGPT"
  },
  opencode: {
    command: "opencode",
    aliases: [],
    loginArgs: ["auth", "login"],
    authArgs: ["auth", "list"],
    accountLabel: "OpenCode"
  },
  cursor: {
    command: "cursor-agent",
    aliases: ["agent", "cursor"],
    loginArgs: ["login"],
    authArgs: ["status"],
    accountLabel: "Cursor"
  },
  copilot: {
    command: "copilot",
    aliases: [],
    loginArgs: ["login"],
    authArgs: ["auth", "status"],
    accountLabel: "GitHub"
  },
  gemini: {
    command: "gemini",
    aliases: [],
    loginArgs: [],
    authArgs: ["--version"],
    accountLabel: "Google"
  },
  nvidia: {
    command: "opencode",
    aliases: [],
    loginArgs: ["auth", "login"],
    authArgs: ["auth", "list"],
    accountLabel: "NVIDIA"
  }
};

const activeRuns = new Map();
const activeTerminals = new Map();
const modelCache = new Map();
const modelRequests = new Map();
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
let updateCheckTimer = null;

function sendUpdateEvent(type, payload = {}) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update:event", { type, ...payload });
  }
}

async function checkForUpdates() {
  if (!app.isPackaged) return { supported: false, message: "Güncelleme kontrolü yalnızca kurulu sürümde çalışır." };
  const result = await autoUpdater.checkForUpdates();
  return {
    supported: true,
    currentVersion: app.getVersion(),
    latestVersion: result?.updateInfo?.version || app.getVersion()
  };
}

function configureAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => sendUpdateEvent("checking"));
  autoUpdater.on("update-available", (info) => sendUpdateEvent("available", { version: info.version }));
  autoUpdater.on("update-not-available", (info) => sendUpdateEvent("not-available", { version: info.version }));
  autoUpdater.on("download-progress", (progress) => {
    sendUpdateEvent("progress", { percent: Math.round(progress.percent || 0) });
  });
  autoUpdater.on("error", (error) => {
    console.warn("Update check failed:", error.message);
    sendUpdateEvent("error", { message: error.message });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    sendUpdateEvent("downloaded", { version: info.version });
    const win = BrowserWindow.getAllWindows()[0];
    const options = {
      type: "info",
      title: "TaxCLI güncellemesi hazır",
      message: `TaxCLI ${info.version} indirildi.`,
      detail: "Güncellemeyi kurmak için uygulama yeniden başlatılacak.",
      buttons: ["Yeniden başlat ve kur", "Daha sonra"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });

  const runCheck = () => checkForUpdates().catch((error) => {
    console.warn("Automatic update check failed:", error.message);
  });
  const startupTimer = setTimeout(runCheck, 10000);
  startupTimer.unref?.();
  updateCheckTimer = setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref?.();
}

function extraBinDirs() {
  return [
    path.join(process.env.APPDATA || "", "npm"),
    path.join(process.env.LOCALAPPDATA || "", "npm"),
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".npm-global", "bin"),
    path.join(process.env.LOCALAPPDATA || "", "cursor-agent"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "cursor", "resources", "app", "bin"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Cursor", "resources", "app", "bin"),
    path.join(process.env.LOCALAPPDATA || "", "GitHub CLI"),
    path.join(process.env.LOCALAPPDATA || "", "GitHub CLI", "copilot"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links"),
    path.join(os.homedir(), "scoop", "shims"),
    path.join(process.env.ProgramFiles || "", "nodejs"),
    path.join(process.env.ProgramFiles || "", "GitHub CLI"),
    path.join(process.env["ProgramFiles(x86)"] || "", "GitHub CLI")
  ].filter(Boolean);
}

async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function findBinaryInDir(dir, baseNames = ["copilot"]) {
  if (!dir || !(await pathExists(dir))) return null;
  for (const base of baseNames) {
    for (const name of [`${base}.exe`, `${base}.cmd`, base, `${base}.ps1`]) {
      const candidate = path.join(dir, name);
      if (await pathExists(candidate)) return candidate;
    }
  }
  // one-level nesting: GitHub CLI/copilot/<version>/copilot.exe
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const base of baseNames) {
        for (const name of [`${base}.exe`, `${base}.cmd`, base]) {
          const candidate = path.join(dir, entry.name, name);
          if (await pathExists(candidate)) return candidate;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function enrichedEnv() {
  const parts = [process.env.PATH || "", ...extraBinDirs()];
  return { ...process.env, PATH: [...new Set(parts.filter(Boolean))].join(path.delimiter) };
}

function providerKeysPath() {
  return path.join(app.getPath("userData"), "provider-keys.json");
}

function openCodeAuthPath() {
  return path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
}

function codexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}

/** ChatGPT auth rejects retired/codex-variant model IDs still common in ~/.codex/config.toml. */
const CODEX_CHATGPT_DEFAULT_MODEL = "gpt-5.4";
const CODEX_CHATGPT_BLOCKED = /\b(gpt-5\.6-sol|gpt-5\.6-codex(?:-mini)?|gpt-5\.5-codex|gpt-5\.4-codex|gpt-5\.3-codex|codex-mini-latest)\b/i;

function resolveCodexModel(model) {
  const raw = String(model || "").trim();
  if (!raw || CODEX_CHATGPT_BLOCKED.test(raw) || /composer|cursor/i.test(raw)) {
    return CODEX_CHATGPT_DEFAULT_MODEL;
  }
  return raw;
}

async function ensureCodexConfigModel(preferredModel = CODEX_CHATGPT_DEFAULT_MODEL) {
  const file = codexConfigPath();
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `model = "${preferredModel}"\n`, "utf8");
    return preferredModel;
  }
  const current = (text.match(/^\s*model\s*=\s*"([^"]*)"/m) || [])[1] || "";
  if (current && !CODEX_CHATGPT_BLOCKED.test(current)) return current || preferredModel;
  const nextModel = preferredModel;
  let next = text;
  if (/^\s*model\s*=/m.test(text)) {
    next = text.replace(/^\s*model\s*=\s*"[^"]*"/m, `model = "${nextModel}"`);
  } else {
    next = `model = "${nextModel}"\n${text}`;
  }
  if (next !== text) await fs.writeFile(file, next, "utf8");
  return nextModel;
}

async function readProviderKeys() {
  try {
    return JSON.parse(await fs.readFile(providerKeysPath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeProviderKeys(keys) {
  await fs.mkdir(path.dirname(providerKeysPath()), { recursive: true });
  await fs.writeFile(providerKeysPath(), JSON.stringify(keys, null, 2), "utf8");
}

/** OpenCode stores provider API keys in ~/.local/share/opencode/auth.json (same as /connect). */
async function syncOpenCodeAuth(providerId, apiKey) {
  const file = openCodeAuthPath();
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
  } catch {
    data = {};
  }
  if (apiKey) {
    data[providerId] = { type: "api", key: String(apiKey).trim() };
  } else {
    delete data[providerId];
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function withProviderEnv(baseEnv, keys = {}, { model = "", engineId = "" } = {}) {
  const env = { ...baseEnv };
  const wantsNvidia = engineId === "nvidia" || String(model).startsWith("nvidia/");
  // Official OpenCode docs: NVIDIA_API_KEY. Also synced into auth.json via syncOpenCodeAuth.
  if (wantsNvidia && keys.nvidia) env.NVIDIA_API_KEY = keys.nvidia;
  if (keys.gemini) {
    env.GEMINI_API_KEY = keys.gemini;
    env.GOOGLE_API_KEY = keys.gemini;
    env.GOOGLE_GENAI_API_KEY = keys.gemini;
  }
  // Gemini headless: no TTY prompts; tool subprocesses should not hang on credentials.
  if (engineId === "gemini") {
    env.CI = env.CI || "1";
    env.TERM = env.TERM || "dumb";
    env.NO_COLOR = "1";
    env.FORCE_COLOR = "0";
    env.GIT_TERMINAL_PROMPT = "0";
    env.GH_PROMPT_DISABLED = "1";
    env.GEMINI_CLI_TRUST_WORKSPACE = "true";
  }
  return env;
}
const APP_ICON = path.join(__dirname, "..", "src", "logo-icon.png");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#0b0d10",
    frame: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  win.loadFile(path.join(__dirname, "..", "src", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn("where.exe", [command], { windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function resolveCommand(command) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve({ command, prefix: [], kind: "binary" });
    const env = enrichedEnv();
    const child = spawn("where.exe", [command], { windowsHide: true, env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => resolve(null));
    child.on("close", async (code) => {
      let selected = null;
      if (code === 0) {
        const paths = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        // Prefer .cmd/.exe over .ps1 — PowerShell -File breaks CLIs that pass bare "-" (Codex stdin).
        selected = paths.find((value) => value.toLowerCase().endsWith(".exe"))
          || paths.find((value) => value.toLowerCase().endsWith(".cmd"))
          || paths.find((value) => !/\.(ps1|bat)$/i.test(value) && !value.toLowerCase().endsWith(".ps1"))
          || paths.find((value) => value.toLowerCase().endsWith(".ps1"))
          || paths[0];
      }
      if (!selected) {
        for (const dir of extraBinDirs()) {
          for (const name of [`${command}.exe`, `${command}.cmd`, command, `${command}.ps1`]) {
            const candidate = path.join(dir, name);
            if (await fs.access(candidate).then(() => true).catch(() => false)) {
              selected = candidate;
              break;
            }
          }
          if (selected) break;
        }
      }
      if (!selected) return resolve(null);

      const baseDir = path.dirname(selected);
      if (command === "opencode") {
        const opencodeBinary = path.join(baseDir, "node_modules", "opencode-ai", "bin", "opencode.exe");
        if (await fs.access(opencodeBinary).then(() => true).catch(() => false)) {
          return resolve({ command: opencodeBinary, prefix: [], kind: "binary" });
        }
      }
      if (command === "codex") {
        const codexJs = path.join(baseDir, "node_modules", "@openai", "codex", "bin", "codex.js");
        if (await fs.access(codexJs).then(() => true).catch(() => false)) {
          const nodeInvocation = await resolveNodeBinary();
          if (nodeInvocation) {
            return resolve({ command: nodeInvocation.command, prefix: [...nodeInvocation.prefix, codexJs], kind: "node-script" });
          }
        }
      }

      if (selected.toLowerCase().endsWith(".ps1")) {
        // Last resort only — prefer cmd wrappers above.
        return resolve({ command: "powershell.exe", prefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", selected], kind: "powershell-script" });
      }
      if (selected.toLowerCase().endsWith(".cmd") || selected.toLowerCase().endsWith(".bat")) {
        return resolve({ command: process.env.ComSpec || "cmd.exe", prefix: ["/d", "/s", "/c", selected], kind: "cmd-script" });
      }
      return resolve({ command: selected, prefix: [], kind: "binary" });
    });
  });
}

function resolveNodeBinary() {
  return new Promise((resolve) => {
    const env = enrichedEnv();
    const child = spawn("where.exe", ["node"], { windowsHide: true, env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => resolve({ command: "node", prefix: [] }));
    child.on("close", (code) => {
      if (code !== 0) return resolve({ command: "node", prefix: [] });
      const paths = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const exe = paths.find((value) => value.toLowerCase().endsWith(".exe")) || paths[0];
      resolve(exe ? { command: exe, prefix: [] } : { command: "node", prefix: [] });
    });
  });
}

async function resolveGeminiInvocation() {
  const candidates = [
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@google", "gemini-cli", "bundle", "gemini.js"),
    path.join(process.env.LOCALAPPDATA || "", "npm", "node_modules", "@google", "gemini-cli", "bundle", "gemini.js"),
    path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
  ];
  for (const script of candidates) {
    if (await fs.access(script).then(() => true).catch(() => false)) {
      const nodeInvocation = await resolveNodeBinary();
      return {
        command: nodeInvocation.command,
        prefix: [...nodeInvocation.prefix, script],
        kind: "node-script",
        resolvedCommand: "gemini"
      };
    }
  }
  return null;
}

async function resolveCursorAgentInvocation() {
  const root = path.join(process.env.LOCALAPPDATA || "", "cursor-agent");
  if (!root || !(await fs.access(root).then(() => true).catch(() => false))) return null;
  const versionsRoot = path.join(root, "versions");
  let versionDirs = [];
  try {
    versionDirs = (await fs.readdir(versionsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}\.\d{1,2}\.\d{1,2}/.test(name))
      .sort()
      .reverse();
  } catch {
    versionDirs = [];
  }
  const searchDirs = [
    ...versionDirs.map((name) => path.join(versionsRoot, name)),
    root
  ];
  for (const dir of searchDirs) {
    const nodePath = path.join(dir, "node.exe");
    const indexPath = path.join(dir, "index.js");
    const nodeOk = await fs.access(nodePath).then(() => true).catch(() => false);
    const indexOk = await fs.access(indexPath).then(() => true).catch(() => false);
    if (nodeOk && indexOk) {
      return { command: nodePath, prefix: [indexPath], kind: "binary", resolvedCommand: "cursor-agent" };
    }
  }
  return null;
}

async function resolveCopilotInvocation() {
  // 1) npm global package (@github/copilot → npm-loader.js)
  const npmRoots = [
    path.join(process.env.APPDATA || "", "npm"),
    path.join(process.env.LOCALAPPDATA || "", "npm"),
    path.join(os.homedir(), ".npm-global"),
    path.join(process.env.ProgramFiles || "", "nodejs")
  ];
  for (const root of npmRoots) {
    const loader = path.join(root, "node_modules", "@github", "copilot", "npm-loader.js");
    if (await pathExists(loader)) {
      const nodeInvocation = await resolveNodeBinary();
      return {
        command: nodeInvocation.command,
        prefix: [...nodeInvocation.prefix, loader],
        kind: "node-script",
        resolvedCommand: "copilot"
      };
    }
    const shim = await findBinaryInDir(root, ["copilot"]);
    if (shim) {
      const via = await resolveCommand("copilot");
      // Prefer resolved cmd-script if PATH already has it; else use shim path directly
      if (via) return { ...via, resolvedCommand: "copilot" };
      if (shim.toLowerCase().endsWith(".cmd") || shim.toLowerCase().endsWith(".bat")) {
        return {
          command: process.env.ComSpec || "cmd.exe",
          prefix: ["/d", "/s", "/c", shim],
          kind: "cmd-script",
          resolvedCommand: "copilot"
        };
      }
      if (shim.toLowerCase().endsWith(".ps1")) {
        return {
          command: "powershell.exe",
          prefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", shim],
          kind: "powershell-script",
          resolvedCommand: "copilot"
        };
      }
      return { command: shim, prefix: [], kind: "binary", resolvedCommand: "copilot" };
    }
  }

  // 2) Common install locations (winget / gh-managed download)
  const searchDirs = [
    path.join(process.env.LOCALAPPDATA || "", "GitHub CLI", "copilot"),
    path.join(process.env.LOCALAPPDATA || "", "GitHub CLI"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "GitHub Copilot CLI"),
    path.join(process.env.ProgramFiles || "", "GitHub Copilot CLI"),
    path.join(process.env.ProgramFiles || "", "GitHub CLI"),
    ...extraBinDirs()
  ];
  for (const dir of searchDirs) {
    const found = await findBinaryInDir(dir, ["copilot"]);
    if (!found) continue;
    if (found.toLowerCase().endsWith(".cmd") || found.toLowerCase().endsWith(".bat")) {
      return {
        command: process.env.ComSpec || "cmd.exe",
        prefix: ["/d", "/s", "/c", found],
        kind: "cmd-script",
        resolvedCommand: "copilot"
      };
    }
    if (found.toLowerCase().endsWith(".ps1")) {
      return {
        command: "powershell.exe",
        prefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", found],
        kind: "powershell-script",
        resolvedCommand: "copilot"
      };
    }
    return { command: found, prefix: [], kind: "binary", resolvedCommand: "copilot" };
  }

  // 3) PATH / where.exe
  const fromPath = await resolveCommand("copilot");
  if (fromPath) return { ...fromPath, resolvedCommand: "copilot" };

  // 4) No binary yet — but gh can download+run Copilot CLI (preview).
  // Do not treat as fully installed for detect; used after explicit bootstrap.
  return null;
}

async function resolveEngineInvocation(engineId) {
  const engine = ENGINE_COMMANDS[engineId];
  if (!engine) return null;
  if (engineId === "cursor") {
    const direct = await resolveCursorAgentInvocation();
    if (direct) return direct;
  }
  if (engineId === "gemini") {
    const direct = await resolveGeminiInvocation();
    if (direct) return direct;
  }
  if (engineId === "copilot") {
    const direct = await resolveCopilotInvocation();
    if (direct) return direct;
    return null;
  }
  const candidates = engineId === "cursor"
    ? ["cursor-agent", "agent", "cursor"]
    : [engine.command, ...(engine.aliases || [])];
  for (const candidate of candidates) {
    const invocation = await resolveCommand(candidate);
    if (invocation) return { ...invocation, resolvedCommand: candidate };
  }
  return null;
}

async function hasGeminiLocalAuthFiles() {
  // Only check presence (not content) of known credential paths.
  const home = os.homedir();
  const candidates = [
    path.join(home, ".gemini", "oauth_creds.json"),
    path.join(home, ".gemini", "google_accounts.json"),
    path.join(home, ".config", "gemini", "oauth_creds.json"),
    path.join(home, ".config", "gemini", "google_accounts.json")
  ];
  for (const file of candidates) {
    try {
      const st = await fs.stat(file);
      if (st.isFile() && st.size > 32) return true;
    } catch {
      /* missing */
    }
  }
  return false;
}

function geminiExitHint(code, stderrTail = "") {
  const map = {
    41: "Gemini kimlik doğrulama hatası (kod 41). Bağlantılar → Gemini için API anahtarı gir veya terminalde `gemini` ile Google oturumu aç.",
    42: "Gemini giriş hatası (kod 42). Prompt boş veya geçersiz olabilir.",
    44: "Gemini sandbox hatası (kod 44). `--approval-mode yolo` / sandbox ayarlarını kontrol et.",
    52: "Gemini ayar hatası (kod 52). `~/.gemini/settings.json` bozulmuş olabilir.",
    53: "Gemini tur limiti (kod 53). Daha kısa bir görev dene."
  };
  if (map[code]) return map[code];
  if (/auth|api.?key|login|unauthor|credential/i.test(stderrTail)) {
    return "Gemini kimlik/erişim hatası. API anahtarı veya Google oturumunu kontrol et.";
  }
  return "";
}

async function checkEngineAuth(engineId, invocation) {
  const engine = ENGINE_COMMANDS[engineId];
  if (!engine) return { authenticated: false, detail: "" };
  if (engineId === "nvidia") {
    const keys = await readProviderKeys();
    if (keys.nvidia) return { authenticated: true, detail: "NVIDIA API anahtarı kayıtlı" };
    if (!invocation) return { authenticated: false, detail: "API anahtarı yok" };
    const result = await captureCommand(invocation, ["auth", "list"], 15000).catch(() => ({ code: 1, stdout: "" }));
    const authenticated = result.code === 0 && /nvidia/i.test(result.stdout);
    return { authenticated, detail: authenticated ? "NVIDIA provider bağlı" : "API anahtarı gir" };
  }
  if (engineId === "copilot") {
    if (!invocation) {
      return {
        authenticated: false,
        detail: "Copilot CLI yok · Bağlantılar’dan kur (winget / npm / gh)"
      };
    }
    const gh = await resolveCommand("gh");
    if (gh) {
      const ghStatus = await captureCommand(gh, ["auth", "status"], 10000).catch(() => ({ code: 1, stdout: "", stderr: "" }));
      if (ghStatus.code === 0) return { authenticated: true, detail: "GitHub oturumu · Copilot CLI hazır" };
    }
    const status = await captureCommand(invocation, ["--version"], 15000).catch(() => ({ code: 1, stdout: "", stderr: "" }));
    if (status.code === 0) return { authenticated: false, detail: "CLI kurulu · GitHub girişi yap" };
    return { authenticated: false, detail: "CLI bulundu · giriş / sürüm kontrolü başarısız" };
  }
  if (!invocation) return { authenticated: false, detail: "CLI bulunamadı" };
  if (engineId === "cursor") {
    // "cursor" IDE binary ≠ Agent CLI; chats need cursor-agent / agent.
    if (invocation.resolvedCommand === "cursor") {
      return { authenticated: false, detail: "Cursor IDE var · Agent CLI kur (cursor.com/install)" };
    }
    const result = await captureCommand(invocation, ["status"], 15000).catch(() => ({ code: 1, stdout: "", stderr: "" }));
    const blob = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.code === 0 && !/not\s+logged|unauthor|please log|login required/i.test(blob)) {
      return { authenticated: true, detail: "Cursor Agent oturumu açık" };
    }
    return { authenticated: false, detail: "Agent CLI kurulu · giriş yap" };
  }
  if (engineId === "gemini") {
    const keys = await readProviderKeys();
    if (keys.gemini) return { authenticated: true, detail: "Gemini API anahtarı kayıtlı" };
    if (await hasGeminiLocalAuthFiles()) return { authenticated: true, detail: "Gemini Google oturumu var" };
    return { authenticated: false, detail: "API anahtarı veya Google girişi yok" };
  }
  if (!engine.authArgs?.length) return { authenticated: false, detail: "Oturum durumu bilinmiyor" };
  const result = await captureCommand(invocation, engine.authArgs, 15000).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (engineId === "opencode") {
    const authenticated = result.code === 0 && String(result.stdout || "").trim().length > 0;
    return { authenticated, detail: authenticated ? "En az bir provider bağlı" : "Provider girişi yok" };
  }
  if (engineId === "codex") {
    const blob = `${result.stdout || ""}\n${result.stderr || ""}`;
    const authenticated = result.code === 0 && /logged in|chatgpt|authenticated/i.test(blob);
    return { authenticated, detail: authenticated ? "ChatGPT oturumu açık" : "ChatGPT girişi yok" };
  }
  const blob = `${result.stdout || ""}\n${result.stderr || ""}`;
  const authenticated = result.code === 0 && !/not\s+logged|unauthor|not authenticated|please log|logged out/i.test(blob);
  return { authenticated, detail: authenticated ? `${engine.accountLabel} oturumu açık` : `${engine.accountLabel} girişi yok` };
}

function emitAgentEvent(sender, runId, event) {
  if (!sender.isDestroyed()) sender.send("agent:event", { runId, ...event });
}

function parseEventLine(engineId, line) {
  try {
    return { kind: "json", engineId, data: JSON.parse(line) };
  } catch {
    return { kind: "text", engineId, text: line };
  }
}

/** OpenCode writes structured logs to stderr when --print-logs is enabled. */
function parseOpenCodeLogLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  const level = (text.match(/\blevel=(\w+)/i) || [])[1]?.toUpperCase() || "";
  const message = (text.match(/\bmessage="([^"]*)"/) || text.match(/\bmessage=([^\s]+)/) || [])[1] || "";
  const errorField = (text.match(/\berror\.error="([^"]*)"/) || text.match(/\berror="([^"]*)"/) || [])[1] || "";
  const blob = `${message} ${errorField} ${text}`;
  if (/status code 529|overloaded|Service Unavailable|capacity/i.test(blob)) {
    return { kind: "overloaded", detail: errorField || message || "529", status: "NVIDIA / sağlayıcı yoğun (529). Yeniden deneniyor…" };
  }
  if (/status code 401|Unauthorized|Missing Authentication|invalid.?api.?key|authentication/i.test(blob)) {
    return { kind: "auth", detail: errorField || message || "401", message: "NVIDIA kimlik doğrulaması başarısız. Bağlantılar'da API anahtarını yeniden kaydet." };
  }
  if (/status code 403|Forbidden|permission denied|not allowed/i.test(blob)) {
    return { kind: "forbidden", detail: errorField || message, message: "NVIDIA bu modele erişimi reddetti (403)." };
  }
  if (/status code 4\d\d|status code 5\d\d|AI_APICallError|stream error/i.test(blob) && (level === "ERROR" || /stream error|AI_APICallError/i.test(blob))) {
    const code = (blob.match(/status code (\d{3})/i) || [])[1];
    return {
      kind: "api_error",
      detail: errorField || message || text.slice(0, 160),
      status: code ? `Model API hatası (${code}). Yeniden deneniyor…` : "Model API hatası. Yeniden deneniyor…"
    };
  }
  if (level === "ERROR") {
    return { kind: "log_error", detail: message || text.slice(0, 200), status: message ? `OpenCode: ${message}` : "OpenCode hata kaydı" };
  }
  return null;
}

function isNoiseHistoryContent(text) {
  const value = String(text || "");
  return /(?:^|\n)\s*(?:nvidia\/|opencode\/).*(?:yanıt vermedi|529|PROVIDER_OVERLOADED|MODEL_TIMEOUT)/i.test(value)
    || /art arda \d+ kez yoğunluk|sağlayıcı yoğun|sağlayıcı şu an kaldıramıyor|Çalışma durduruldu|Ajan \d+ koduyla sonlandı|Model kullanılamıyor|API anahtarı|kimlik doğrulaması başarısız/i.test(value)
    || /Bağlam alındı|Sonraki isteklerde buna göre|özeti tekrar yazma/i.test(value)
    || /Görev tamamlandı\.?\s*$/i.test(value.trim());
}

function sanitizeHistoryForPrompt(history, options = {}) {
  if (!Array.isArray(history)) return [];
  const maxTurns = Math.max(0, Number(options.maxTurns) || 16);
  const maxChars = Math.max(200, Number(options.maxChars) || 2500);
  return history
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").trim().slice(0, maxChars)
    }))
    .filter((item) => item.content && !isNoiseHistoryContent(item.content))
    .slice(-maxTurns);
}

function sanitizeHistoryForStorage(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-40).map((item) => {
    const entry = {
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").trim().slice(0, 12000)
    };
    if (Array.isArray(item?.activity) && item.activity.length) {
      entry.activity = item.activity.slice(-40).map((act) => {
        if (!act || typeof act !== "object") return null;
        if (act.type === "tool") return { type: "tool", name: String(act.name || "tool").slice(0, 80), detail: String(act.detail || "").slice(0, 300) };
        if (act.type === "thought") return { type: "thought", label: String(act.label || "Düşündü").slice(0, 80), text: String(act.text || "").slice(0, 4000) };
        if (act.type === "file") return { type: "file", path: String(act.path || "").slice(0, 400), added: Number(act.added) || 0, removed: Number(act.removed) || 0, diff: String(act.diff || "").slice(0, 8000) };
        if (act.type === "event") return { type: "event", text: String(act.text || "").slice(0, 500) };
        return null;
      }).filter(Boolean);
    }
    return entry;
  }).filter((item) => item.content || item.activity?.length);
}

/**
 * Put the real task first so Windows command-line length limits never drop it.
 * Avoid language that trains the model to only acknowledge "context".
 */
function buildPromptWithHistory(prompt, history, engineId = "") {
  const turns = sanitizeHistoryForPrompt(history);
  if (!turns.length) {
    if (engineId === "cursor") {
      return [
        "Sen bir coding agentsin; seçili proje klasöründe çalışıyorsun.",
        "Görevi araçlarla (oku/yaz/shell) HEMEN uygula. Sadece bağlam veya 'tamam' demekle yetinme.",
        "",
        "Görev:",
        prompt
      ].join("\n");
    }
    return prompt;
  }
  const transcript = turns.map((item) => `${item.role === "user" ? "Kullanıcı" : "Asistan"}: ${item.content}`).join("\n\n");
  if (engineId === "cursor") {
    return [
      "Sen bir coding agentsin; seçili proje klasöründe çalışıyorsun.",
      "Aşağıdaki GÖREVİ şimdi uygula (gerekirse dosya oku/yaz). Sadece 'bağlam alındı' deme; işi yap.",
      "",
      "### Görev",
      prompt,
      "",
      "### Önceki sohbet (sadece bağlam — yeni görev bu değil)",
      transcript
    ].join("\n");
  }
  return [
    "### Görev",
    prompt,
    "",
    "### Önceki sohbet (bağlam)",
    transcript,
    "",
    "Yukarıdaki GÖREVİ yerine getir. Sadece bağlam aldığını söyleyip durma."
  ].join("\n");
}

/** Copy images into project so CLIs / tools can read them under --dir workspace. */
async function stageImagesForRun(projectPath, imagePaths) {
  if (!imagePaths.length) return [];
  const uploadDir = path.join(projectPath, ".aihub", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const stamped = Date.now();
  const staged = [];
  for (let i = 0; i < imagePaths.length; i += 1) {
    const source = imagePaths[i];
    const ext = path.extname(source).toLowerCase() || ".png";
    const dest = path.join(uploadDir, `img-${stamped}-${i + 1}${ext}`);
    await fs.copyFile(source, dest);
    staged.push(dest);
  }
  return staged;
}

function buildImagePromptSuffix(engineId, stagedPaths, { binaryAttached = true } = {}) {
  if (!stagedPaths.length) return "";
  if (engineId === "gemini") {
    const at = stagedPaths.map((p) => `@${p}`).join(" ");
    return `\n\n${at}\n\nYukarıdaki ekli görselleri incele ve soruya buna göre yanıt ver.`;
  }
  if (engineId === "cursor" || engineId === "copilot") {
    return `\n\nEkli görseller (projede, oku/incele):\n${stagedPaths.map((p) => `- ${p}`).join("\n")}\n\nGörselleri ara oku; sadece yol metnini tekrarlama.`;
  }
  if (!binaryAttached) {
    return `\n\nKullanıcı görsel ekledi ama seçili model vision olmayabilir. Dosyalar projede:\n${stagedPaths.map((p) => `- ${p}`).join("\n")}\nMümkünse dosyayı oku/açıkla; göremiyorsan bunu samimi söyle ve vision model öner.`;
  }
  return `\n\n${stagedPaths.length} görsel bu mesaja ekli. Görüntü içeriğini doğrudan analiz et (ekler -f ile yüklendi).`;
}

function modelLikelyLacksVision(modelId) {
  const m = String(modelId || "").toLowerCase();
  if (!m) return false;
  return /mimo|deepseek|qwen|llama|free/i.test(m)
    && !/vision|vl\b|multimodal|omni|gemini|gpt-4o|claude|sonnet|opus|nova|pixtral/i.test(m);
}

async function readChatHistory(projectPath) {
  try {
    const raw = await fs.readFile(path.join(projectPath, ".aihub", "chat-history.json"), "utf8");
    const parsed = JSON.parse(raw);
    return sanitizeHistoryForStorage(parsed.messages || parsed);
  } catch {
    return [];
  }
}

async function writeChatHistory(projectPath, messages) {
  const root = path.join(projectPath, ".aihub");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "chat-history.json"), JSON.stringify({
    updatedAt: new Date().toISOString(),
    messages: sanitizeHistoryForStorage(messages)
  }, null, 2), "utf8");
}

function projectsFilePath() {
  return path.join(app.getPath("userData"), "projects.json");
}

async function readProjectState() {
  try {
    const parsed = JSON.parse(await fs.readFile(projectsFilePath(), "utf8"));
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [], selectedId: parsed.selectedId || null };
  } catch {
    return { projects: [], selectedId: null };
  }
}

async function writeProjectState(state) {
  const target = projectsFilePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(state, null, 2), "utf8");
}

function captureCommand(invocation, args, timeoutMs = 20000, env = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.prefix, ...args], {
      shell: false,
      windowsHide: true,
      env: env || enrichedEnv()
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Komut zaman aşımına uğradı.")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function launchInteractiveTerminal(invocation, args, title = "TaxCLI Login") {
  if (process.platform !== "win32") {
    const child = spawn(invocation.command, [...invocation.prefix, ...args], { detached: true, shell: false, stdio: "inherit" });
    child.unref();
    return;
  }
  const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const command = `& ${quotePowerShell(invocation.command)} ${[...invocation.prefix, ...args].map(quotePowerShell).join(" ")}`;
  const child = spawn("cmd.exe", ["/d", "/c", "start", title, "powershell.exe", "-NoExit", "-NoProfile", "-Command", command], { detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
}

ipcMain.handle("project:choose", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("images:choose", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "Görseller", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
  if (result.canceled) return [];
  const mimeByExtension = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const images = [];
  for (const filePath of result.filePaths.slice(0, 8)) {
    const absolutePath = path.resolve(filePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats?.isFile() || !mimeByExtension[extension] || stats.size > 20 * 1024 * 1024) continue;
    const data = await fs.readFile(absolutePath);
    images.push({ path: absolutePath, name: path.basename(absolutePath), size: stats.size, dataUrl: `data:${mimeByExtension[extension]};base64,${data.toString("base64")}` });
  }
  return images;
});

/** Save paste/drop payloads (base64 or absolute paths) into temp folder for agent runs. */
ipcMain.handle("images:import", async (_event, payload) => {
  const mimeByExtension = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const extByMime = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 8) : [];
  const uploadDir = path.join(app.getPath("temp"), "agenthub-imports");
  await fs.mkdir(uploadDir, { recursive: true });
  const images = [];
  let index = 0;
  for (const item of items) {
    try {
      if (item?.path) {
        const absolutePath = path.resolve(String(item.path));
        const extension = path.extname(absolutePath).toLowerCase();
        const stats = await fs.stat(absolutePath).catch(() => null);
        if (!stats?.isFile() || !mimeByExtension[extension] || stats.size > 20 * 1024 * 1024) continue;
        const data = await fs.readFile(absolutePath);
        images.push({ path: absolutePath, name: path.basename(absolutePath), size: stats.size, dataUrl: `data:${mimeByExtension[extension]};base64,${data.toString("base64")}` });
        continue;
      }
      const mime = String(item?.mimeType || "image/png").toLowerCase();
      const extension = extByMime[mime] || ".png";
      const raw = String(item?.base64 || "").replace(/^data:image\/\w+;base64,/, "");
      if (!raw) continue;
      const buffer = Buffer.from(raw, "base64");
      if (!buffer.length || buffer.length > 20 * 1024 * 1024) continue;
      index += 1;
      const name = String(item?.name || `clipboard-${Date.now()}-${index}${extension}`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
      const dest = path.join(uploadDir, name.endsWith(extension) ? name : `${name}${extension}`);
      await fs.writeFile(dest, buffer);
      images.push({
        path: dest,
        name: path.basename(dest),
        size: buffer.length,
        dataUrl: `data:${mimeByExtension[extension] || mime};base64,${buffer.toString("base64")}`
      });
    } catch {
      /* skip bad item */
    }
  }
  return images;
});

ipcMain.handle("projects:list", async () => readProjectState());

ipcMain.handle("projects:add", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled) return null;
  const projectPath = path.resolve(result.filePaths[0]);
  const state = await readProjectState();
  let project = state.projects.find((item) => path.resolve(item.path).toLowerCase() === projectPath.toLowerCase());
  if (!project) {
    project = { id: crypto.randomUUID(), name: path.basename(projectPath), path: projectPath, createdAt: new Date().toISOString() };
    state.projects.push(project);
  }
  state.selectedId = project.id;
  await writeProjectState(state);
  return { project, state };
});

ipcMain.handle("projects:select", async (_event, projectId) => {
  const state = await readProjectState();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Proje kaydı bulunamadı.");
  const stats = await fs.stat(project.path).catch(() => null);
  if (!stats?.isDirectory()) throw new Error("Proje klasörü artık mevcut değil.");
  state.selectedId = project.id;
  await writeProjectState(state);
  return { project, state };
});

ipcMain.handle("projects:remove", async (_event, projectId) => {
  const state = await readProjectState();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return state;
  state.projects = state.projects.filter((item) => item.id !== projectId);
  if (state.selectedId === projectId) state.selectedId = state.projects[0]?.id || null;
  await writeProjectState(state);
  return state;
});

ipcMain.handle("terminal:start", async (event, projectPath) => {
  const root = path.resolve(String(projectPath || ""));
  const stats = await fs.stat(root).catch(() => null);
  if (!stats?.isDirectory()) throw new Error("Terminal için geçerli bir proje seçin.");
  const terminalId = crypto.randomUUID();
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NoExit"], {
    cwd: root,
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
  activeTerminals.set(terminalId, child);
  const emit = (type, payload = {}) => {
    if (!event.sender.isDestroyed()) event.sender.send("terminal:event", { terminalId, type, ...payload });
  };
  child.stdout.on("data", (chunk) => emit("output", { data: chunk.toString("utf8") }));
  child.stderr.on("data", (chunk) => emit("output", { data: chunk.toString("utf8"), error: true }));
  child.on("error", (error) => emit("error", { message: error.message }));
  child.on("close", (code) => { activeTerminals.delete(terminalId); emit("closed", { code }); });
  return { terminalId, cwd: root };
});

ipcMain.handle("terminal:write", async (_event, terminalId, data) => {
  const child = activeTerminals.get(String(terminalId));
  if (!child?.stdin?.writable) return false;
  child.stdin.write(String(data));
  return true;
});

ipcMain.handle("terminal:stop", async (_event, terminalId) => {
  const child = activeTerminals.get(String(terminalId));
  if (!child) return false;
  spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  return true;
});

ipcMain.handle("engines:detect", async () => {
  // Fresh auth/model surface after rescan
  modelCache.delete("copilot");
  modelCache.delete("copilot:v2");
  modelCache.delete("cursor");
  modelCache.delete("opencode");
  modelCache.delete("nvidia");
  const entries = await Promise.all(Object.keys(ENGINE_COMMANDS).map(async (id) => {
    const engine = ENGINE_COMMANDS[id];
    const invocation = await resolveEngineInvocation(id);
    const installed = Boolean(invocation) || id === "nvidia";
    const auth = await checkEngineAuth(id, invocation);
    return {
      id,
      installed,
      authenticated: auth.authenticated,
      detail: auth.detail || (installed ? "CLI algılandı" : "CLI bulunamadı"),
      command: invocation?.resolvedCommand || engine.command,
      accountLabel: engine.accountLabel,
      loginMode: id === "nvidia" || id === "gemini" ? "api-key" : "cli"
    };
  }));
  return entries;
});

ipcMain.handle("providers:get-key", async (_event, providerId) => {
  const keys = await readProviderKeys();
  const value = keys[providerId];
  if (!value) return { configured: false, hint: "" };
  return { configured: true, hint: `${String(value).slice(0, 4)}…${String(value).slice(-4)}` };
});

ipcMain.handle("providers:set-key", async (_event, payload) => {
  const providerId = String(payload?.providerId || "");
  const apiKey = String(payload?.apiKey || "").trim();
  if (!["nvidia", "gemini"].includes(providerId)) throw new Error("Desteklenmeyen sağlayıcı.");
  if (!apiKey || apiKey.length < 8) throw new Error("Geçerli bir API anahtarı girin.");
  const keys = await readProviderKeys();
  keys[providerId] = apiKey;
  keys.updatedAt = new Date().toISOString();
  await writeProviderKeys(keys);
  // Mirror into OpenCode's credential store so `opencode run` authenticates the same way as the TUI /connect flow.
  if (providerId === "nvidia") {
    await syncOpenCodeAuth("nvidia", apiKey);
    modelCache.delete("nvidia");
    modelCache.delete("opencode");
  }
  return { configured: true };
});

ipcMain.handle("providers:clear-key", async (_event, providerId) => {
  const keys = await readProviderKeys();
  delete keys[providerId];
  await writeProviderKeys(keys);
  if (providerId === "nvidia") {
    await syncOpenCodeAuth("nvidia", null);
    modelCache.delete("nvidia");
    modelCache.delete("opencode");
  }
  return true;
});

function parseCursorModelsOutput(text) {
  const models = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^available models$/i.test(trimmed)) continue;
    const match = trimmed.match(/^([^\s]+)\s+-\s+(.+)$/);
    const id = match ? match[1].trim() : (/^[\w./:+@-]+$/.test(trimmed) ? trimmed : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: match ? match[2].trim() : id });
  }
  return models;
}

/** CLI `--model` slugs (agent) — not VS Code chat / completions catalog. */
const COPILOT_CATALOG_FALLBACK = [
  { id: "auto", label: "Auto", blurb: "Copilot seçer" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", blurb: "Varsayılan genel kodlama" },
  { id: "gpt-5.4", label: "GPT-5.4", blurb: "Karmaşık akıl yürütme" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", blurb: "Hızlı / hafif" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", blurb: "Kod odaklı" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", blurb: "Preview" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", blurb: "Hızlı Gemini" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", blurb: "Hızlı Gemini" },
  { id: "mai-code-1-flash", label: "MAI Code 1 Flash", blurb: "Hızlı kod" }
];

/** Known extra agent-capable IDs that subscriptions often unlock beyond docs table. */
const COPILOT_AGENT_EXTRA = [
  "claude-sonnet-4.5",
  "claude-sonnet-4",
  "claude-opus-4.6",
  "claude-opus-4.5",
  "claude-opus-4.8",
  "claude-opus-4.8-fast",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "gpt-4.1",
  "o3",
  "o4-mini",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3-pro-preview"
];

function isCopilotAgentModelId(id) {
  const s = String(id || "").trim();
  if (!s) return false;
  if (s === "auto") return true;
  if (/embed|whisper|tts|transcri|dall-e|image|rerank|search-query|text-embedding|completion/i.test(s)) return false;
  // CLI agent models use short product slugs (not provider/org paths like openai/gpt-4o)
  if (s.includes("/")) return false;
  return /^(claude-|gpt-|o[1-4](?:-|$)|gemini-|mai-)/i.test(s);
}

function prettyCopilotLabel(id, name, blurb) {
  const known = COPILOT_CATALOG_FALLBACK.find((m) => m.id === id);
  if (name && String(name).trim() && String(name).trim() !== id && !/^model$/i.test(name)) {
    return String(name).trim();
  }
  if (known?.label) return known.blurb ? `${known.label} · ${known.blurb}` : known.label;
  if (id === "auto") return "Auto · Copilot seçer";
  // claude-sonnet-4.6 → Claude Sonnet 4.6
  const pretty = String(id)
    .replace(/^claude-/i, "Claude ")
    .replace(/^gpt-/i, "GPT-")
    .replace(/^gemini-/i, "Gemini ")
    .replace(/^mai-/i, "MAI ")
    .replace(/-/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/Gpt-/g, "GPT-")
    .replace(/Gpt /g, "GPT ")
    .replace(/\s+/g, " ")
    .trim();
  return blurb ? `${pretty} · ${blurb}` : pretty;
}

function parseCopilotHelpModels(text) {
  const models = [];
  const seen = new Set();
  const blob = String(text || "");
  const choiceBlock = blob.match(/(?:choices?|models?)\s*[:=]\s*([^\n]+)/i);
  if (choiceBlock) {
    for (const part of choiceBlock[1].split(/[,\|]/)) {
      const id = part.trim().replace(/^["'`]+|["'`]+$/g, "");
      if (!isCopilotAgentModelId(id) || seen.has(id)) continue;
      seen.add(id);
      models.push({ id, label: prettyCopilotLabel(id) });
    }
  }
  for (const line of blob.split(/\r?\n/)) {
    const m = line.match(/^\s*[`|]?\s*([a-z0-9][\w.+-]{2,48})\s*[`|]?\s*(?:\||-|–)\s+(.+?)\s*[`|]?$/i);
    if (!m) continue;
    const id = m[1].trim();
    if (!isCopilotAgentModelId(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: prettyCopilotLabel(id, m[2]) });
  }
  return models;
}

async function readGithubToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_COPILOT_TOKEN;
  if (envToken && String(envToken).trim()) return String(envToken).trim();
  const gh = await resolveCommand("gh");
  if (!gh) return null;
  const result = await captureCommand(gh, ["auth", "token"], 15000).catch(() => null);
  if (!result || result.code !== 0) return null;
  const token = String(result.stdout || "").trim().split(/\r?\n/)[0];
  return token || null;
}

async function fetchJson(url, headers = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: response.ok, status: response.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCopilotApiRows(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.models)) return body.models;
  if (Array.isArray(body)) return body;
  return [];
}

function parseCopilotApiRow(row) {
  const id = String(row?.id || row?.model || "").trim();
  if (!isCopilotAgentModelId(id)) return null;
  const policyState = String(row?.policy?.state || row?.policy_state || "enabled").toLowerCase();
  if (["disabled", "blocked", "unavailable"].includes(policyState)) return null;
  if (row?.model_picker_enabled === false) return null;
  const caps = row?.capabilities || {};
  const supports = caps.supports || {};
  const type = String(caps.type || row?.type || "").toLowerCase();
  // Drop pure embeddings / images already handled by isCopilotAgentModelId; prefer tool-capable chat/agent
  if (type && /embed|image/.test(type) && !/chat|agent/.test(type)) return null;
  // Completions-only models without tools are usually not CLI agent backends
  if (supports.tool_calls === false && supports.tools === false && /completion/i.test(type)) return null;
  const name = row?.name || row?.display_name || row?.vendor_name || "";
  let label = prettyCopilotLabel(id, name);
  if (row?.billing?.multiplier != null && Number(row.billing.multiplier) !== 1) {
    label = `${label} · ×${row.billing.multiplier}`;
  }
  return { id, label };
}

async function listCopilotModelsFromApi() {
  const githubToken = await readGithubToken();
  if (!githubToken) throw new Error("GitHub token yok. GitHub CLI ile `gh auth login` yap veya GH_TOKEN ayarla.");

  const headerSets = [
    {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.35.0",
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "Copilot-Integration-Id": "vscode-chat"
    },
    {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotCLI/1.0.78",
      "Editor-Version": "copilot-cli/1.0.78",
      "Editor-Plugin-Version": "copilot-cli/1.0.78",
      "Copilot-Integration-Id": "copilot-cli"
    }
  ];

  let tokenJson = null;
  for (const headers of headerSets) {
    tokenJson = await fetchJson("https://api.github.com/copilot_internal/v2/token", headers);
    if (tokenJson.ok && tokenJson.body?.token) break;
  }
  if (!tokenJson?.ok || !tokenJson.body?.token) {
    const detail = typeof tokenJson?.body === "object"
      ? (tokenJson.body?.message || tokenJson.body?.error || JSON.stringify(tokenJson.body).slice(0, 160))
      : String(tokenJson?.text || "").slice(0, 160);
    throw new Error(`Copilot token alınamadı (${tokenJson?.status || "?"}). ${detail || "Abonelik veya yetki kontrol et."}`);
  }

  const copilotJwt = tokenJson.body.token;
  const apiBase = String(tokenJson.body?.endpoints?.api || "https://api.githubcopilot.com").replace(/\/$/, "");
  const modelHeaderSets = [
    {
      Authorization: `Bearer ${copilotJwt}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.35.0",
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "Copilot-Integration-Id": "vscode-chat",
      "X-GitHub-Api-Version": "2025-04-01"
    },
    {
      Authorization: `Bearer ${copilotJwt}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotCLI/1.0.78",
      "Editor-Version": "copilot-cli/1.0.78",
      "Editor-Plugin-Version": "copilot-cli/1.0.78",
      "Copilot-Integration-Id": "copilot-cli",
      "X-GitHub-Api-Version": "2025-04-01"
    }
  ];

  let best = [];
  for (const headers of modelHeaderSets) {
    const modelsJson = await fetchJson(`${apiBase}/models`, headers);
    if (!modelsJson.ok) continue;
    const rows = normalizeCopilotApiRows(modelsJson.body);
    const models = [];
    const seen = new Set();
    for (const row of rows) {
      const parsed = parseCopilotApiRow(row);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      models.push(parsed);
    }
    if (models.length > best.length) best = models;
  }

  if (!best.length) throw new Error("Copilot API agent modeli döndürmedi (filtre sonrası boş).");
  return best;
}

async function listCopilotModelsFromCli() {
  const invocation = await resolveEngineInvocation("copilot");
  if (!invocation) return [];
  const attempts = [["help"], ["--help"], ["help", "config"]];
  for (const args of attempts) {
    const result = await captureCommand(invocation, args, 25000).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: error.message
    }));
    const blob = `${result.stdout || ""}\n${result.stderr || ""}`;
    const fromHelp = parseCopilotHelpModels(blob);
    if (fromHelp.length >= 2) {
      if (!fromHelp.some((m) => m.id === "auto")) fromHelp.unshift({ id: "auto", label: prettyCopilotLabel("auto") });
      return fromHelp;
    }
  }
  return [];
}

function mergeCopilotModelLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.id || !isCopilotAgentModelId(item.id)) continue;
      const prev = byId.get(item.id);
      // Prefer richer human labels from live API when available
      if (!prev || (item.label && item.label.length > (prev.label || "").length)) {
        byId.set(item.id, { id: item.id, label: item.label || prettyCopilotLabel(item.id) });
      }
    }
  }
  const models = [...byId.values()];
  models.sort((a, b) => {
    if (a.id === "auto") return -1;
    if (b.id === "auto") return 1;
    const ai = COPILOT_CATALOG_FALLBACK.findIndex((m) => m.id === a.id);
    const bi = COPILOT_CATALOG_FALLBACK.findIndex((m) => m.id === b.id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.label.localeCompare(b.label, "tr");
  });
  return models;
}

async function listCopilotModels() {
  // TaxCLI always invokes `copilot --model <id>` — never dump raw VS Code chat catalog.
  // Sources (merged): GitHub agent docs catalog + live account models (filtered) + CLI help.
  const docs = COPILOT_CATALOG_FALLBACK.map((m) => ({
    id: m.id,
    label: m.blurb ? `${m.label} · ${m.blurb}` : m.label
  }));
  const extras = COPILOT_AGENT_EXTRA.map((id) => ({ id, label: prettyCopilotLabel(id) }));

  let live = [];
  try {
    live = await listCopilotModelsFromApi();
  } catch (error) {
    console.warn("[copilot models] api:", error?.message || error);
  }
  const fromCli = await listCopilotModelsFromCli().catch(() => []);

  // Live list alone is fine only when it is already agent-shaped and non-tiny
  if (live.length >= 4 && live.every((m) => isCopilotAgentModelId(m.id))) {
    // Anchor with docs + auto so UI always shows core CLI models even if API omits a few
    return mergeCopilotModelLists(
      [{ id: "auto", label: prettyCopilotLabel("auto") }],
      docs,
      live,
      fromCli
    );
  }

  // Fallback: docs as baseline; merge whatever agent-like live/CLI rows we got
  const merged = mergeCopilotModelLists(docs, extras.filter((m) => live.some((l) => l.id === m.id)), live, fromCli);
  if (merged.length) return merged;
  return docs;
}

ipcMain.handle("models:list", async (_event, engineId) => {
  if (!["opencode", "nvidia", "cursor", "copilot"].includes(engineId)) return [];
  // Bump cache key when catalog logic changes so clients don't stick on wrong lists
  const cacheKey = engineId === "copilot" ? "copilot:v2" : engineId;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);
  if (modelRequests.has(cacheKey)) return modelRequests.get(cacheKey);
  const request = (async () => {
    if (engineId === "copilot") {
      const models = await listCopilotModels();
      if (!models.length) throw new Error("Copilot model listesi boş.");
      modelCache.set(cacheKey, models);
      return models;
    }
    if (engineId === "cursor") {
      const invocation = await resolveEngineInvocation("cursor");
      if (!invocation || invocation.resolvedCommand === "cursor") {
        throw new Error("Cursor Agent CLI bulunamadı. cursor.com/install ile kur.");
      }
      let result = await captureCommand(invocation, ["models"], 90000).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
      if (result.code !== 0 || !String(result.stdout || "").trim()) {
        result = await captureCommand(invocation, ["--list-models"], 90000).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
      }
      if (result.code !== 0 && !String(result.stdout || "").trim()) {
        throw new Error(String(result.stderr || "").trim() || "Cursor modelleri alınamadı.");
      }
      const models = parseCursorModelsOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
      if (!models.length) throw new Error("Cursor boş bir model listesi döndürdü.");
      modelCache.set(cacheKey, models);
      return models;
    }

    const invocation = await resolveEngineInvocation("opencode");
    if (!invocation) throw new Error("OpenCode kurulu değil.");
    const keys = await readProviderKeys();
    const env = withProviderEnv(enrichedEnv(), keys, { engineId });
    const result = await captureCommand(
      invocation,
      engineId === "nvidia" ? ["models", "nvidia", "--pure"] : ["models", "--pure"],
      120000,
      env
    );
    if (result.code !== 0) throw new Error(result.stderr.trim() || "OpenCode modelleri alınamadı.");
    const models = [...new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[\w~.:/-]+$/.test(line)))];
    if (!models.length) throw new Error("OpenCode boş bir model listesi döndürdü.");
    modelCache.set(cacheKey, models);
    return models;
  })();
  modelRequests.set(cacheKey, request);
  try { return await request; }
  finally { modelRequests.delete(cacheKey); }
});

ipcMain.handle("plugins:status", async () => {
  const status = { github: false, nvidia: false };
  const gh = await resolveCommand("gh");
  if (gh) status.github = (await captureCommand(gh, ["auth", "status"], 10000).catch(() => ({ code: 1 }))).code === 0;
  const keys = await readProviderKeys();
  if (keys.nvidia) status.nvidia = true;
  else {
    const opencode = await resolveEngineInvocation("opencode");
    if (opencode) {
      const auth = await captureCommand(opencode, ["auth", "list"], 15000).catch(() => ({ code: 1, stdout: "" }));
      status.nvidia = auth.code === 0 && /nvidia/i.test(auth.stdout);
    }
  }
  return status;
});

ipcMain.handle("plugin:login", async (_event, pluginId) => {
  if (pluginId === "nvidia") return { connected: false, apiKey: true, message: "NVIDIA API anahtarını gir." };
  if (pluginId !== "github") {
    return {
      connected: false,
      unavailable: true,
      message: "Bu eklenti yakında. Şimdilik Tarayıcı, GitHub ve NVIDIA kullanılabilir."
    };
  }
  const gh = await resolveCommand("gh");
  if (!gh) return { connected: false, unavailable: true, message: "GitHub CLI kurulu değil. Önce GitHub CLI kurulmalı." };
  const current = await captureCommand(gh, ["auth", "status"], 10000).catch(() => ({ code: 1 }));
  if (current.code === 0) return { connected: true };
  launchInteractiveTerminal(gh, ["auth", "login", "--web"], "GitHub Login");
  return { connected: false, pending: true };
});

ipcMain.handle("engine:login", async (_event, engineId) => {
  const engine = ENGINE_COMMANDS[engineId];
  if (!engine) throw new Error("Bilinmeyen motor.");
  if (engineId === "nvidia") return { apiKey: true, message: "NVIDIA API anahtarını gir." };

  // Copilot: install CLI first (not on PATH by default) then ensure GitHub auth.
  if (engineId === "copilot") {
    let invocation = await resolveEngineInvocation("copilot");
    if (!invocation) {
      const winget = await resolveCommand("winget");
      if (winget) {
        launchInteractiveTerminal(winget, [
          "install", "--id", "GitHub.Copilot", "-e",
          "--accept-package-agreements", "--accept-source-agreements"
        ], "Copilot CLI Kur");
        shell.openExternal("https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli");
        return {
          pending: true,
          message: "Copilot CLI kurulumu başlatıldı (winget install GitHub.Copilot). Bitince Yeniden tara."
        };
      }
      const npm = await resolveCommand("npm");
      if (npm) {
        launchInteractiveTerminal(npm, ["install", "-g", "@github/copilot"], "Copilot CLI Kur");
        return {
          pending: true,
          message: "Copilot CLI kuruluyor: npm install -g @github/copilot. Bitince Yeniden tara."
        };
      }
      const gh = await resolveCommand("gh");
      if (gh) {
        // Running `gh copilot` downloads the CLI into %LOCALAPPDATA%\\GitHub CLI\\copilot
        launchInteractiveTerminal(gh, ["copilot"], "Copilot CLI İndir");
        return {
          pending: true,
          message: "gh copilot ile CLI indiriliyor. İlk açılışta login olabilir. Bitince Yeniden tara."
        };
      }
      shell.openExternal("https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli");
      throw new Error("Copilot CLI yok. Kur: winget install GitHub.Copilot  veya  npm i -g @github/copilot");
    }
    const gh = await resolveCommand("gh");
    if (gh) {
      const status = await captureCommand(gh, ["auth", "status"], 10000).catch(() => ({ code: 1 }));
      if (status.code !== 0) {
        launchInteractiveTerminal(gh, ["auth", "login", "--web"], "GitHub Login");
        return { pending: true, message: "Copilot için GitHub girişi açıldı. Bitince Yeniden tara." };
      }
      return { pending: false, message: "GitHub oturumu hazır. Copilot CLI bulundu — Yeniden tara ile doğrula." };
    }
    launchInteractiveTerminal(invocation, engine.loginArgs || [], "Copilot Login");
    return { pending: true, message: "Copilot giriş penceresi açıldı. Bitince Yeniden tara." };
  }

  const invocation = await resolveEngineInvocation(engineId);
  if (!invocation) {
    throw new Error(`${engine.accountLabel} CLI bulunamadı. Terminalde kurulu olduğundan emin olup Yeniden tara'ya bas.`);
  }
  if (engineId === "cursor" && invocation.resolvedCommand === "cursor") {
    shell.openExternal("https://cursor.com/install");
    return {
      pending: true,
      message: "Cursor Agent CLI bu bilgisayarda yok. Açılan sayfadan Agent CLI kur, sonra Bağlantılar → Cursor ile giriş."
    };
  }
  if (engineId === "cursor") {
    launchInteractiveTerminal(invocation, ["login"], "Cursor Agent Login");
    return { pending: true, message: "Cursor Agent giriş penceresi açıldı. Bitince Yeniden tara." };
  }
  if (engineId === "gemini") {
    return {
      pending: false,
      apiKey: true,
      message: "Headless çalışması için Gemini API anahtarı gerekir (veya terminalde Google girişi)."
    };
  }
  const loginArgs = engine.loginArgs?.length ? engine.loginArgs : [];
  launchInteractiveTerminal(invocation, loginArgs, `${engineId} Login`);
  return { pending: true, message: `${engine.accountLabel} giriş penceresi açıldı. Bitince Yeniden tara'ya bas.` };
});

ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle("app:check-for-updates", async () => checkForUpdates());
ipcMain.handle("shell:open-external", async (_event, url) => {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) throw new Error("Yalnızca HTTP/HTTPS adresleri açılabilir.");
  await shell.openExternal(target);
  return { ok: true };
});

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function configureBrowserSession() {
  try {
    const ses = session.fromPartition("persist:agenthub-browser");
    ses.setUserAgent(CHROME_UA);
    // Reduce automation fingerprints where possible
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      headers["User-Agent"] = CHROME_UA;
      headers["Accept-Language"] = headers["Accept-Language"] || "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7";
      callback({ requestHeaders: headers });
    });
  } catch (error) {
    console.warn("Browser session configure failed:", error.message);
  }
}

ipcMain.handle("history:load", async (_event, projectPath) => {
  const root = path.resolve(String(projectPath || ""));
  if (!projectPath || !path.isAbsolute(root)) return [];
  return readChatHistory(root);
});

ipcMain.handle("history:save", async (_event, payload) => {
  const root = path.resolve(String(payload?.projectPath || ""));
  if (!payload?.projectPath || !path.isAbsolute(root)) throw new Error("Geçerli bir proje klasörü seçin.");
  await writeChatHistory(root, payload.messages || []);
  return true;
});

ipcMain.handle("agent:start", async (event, payload) => {
  const engineId = String(payload.engineId || "");
  const prompt = String(payload.prompt || "").trim();
  const projectPath = path.resolve(String(payload.projectPath || ""));
  const engine = ENGINE_COMMANDS[engineId];
  if (!engine) throw new Error("Bu motorun canlı adaptörü henüz hazır değil.");
  if (!prompt) throw new Error("Görev boş olamaz.");
  if (!payload.projectPath || !path.isAbsolute(projectPath)) throw new Error("Önce bir proje klasörü seçin.");
  const stats = await fs.stat(projectPath).catch(() => null);
  if (!stats?.isDirectory()) throw new Error("Proje klasörü bulunamadı.");
  const invocation = await resolveEngineInvocation(engineId);
  if (!invocation) throw new Error(`${engine.command} bu bilgisayarda bulunamadı. Bağlantılar'dan kurup giriş yapın.`);
  const model = String(payload.model || "").trim();
  const approvalMode = ["ask", "auto_edit", "plan"].includes(payload.approvalMode) ? payload.approvalMode : "ask";
  const effortRaw = String(payload.effort || "medium").toLowerCase();
  const effortAllowed = ["low", "medium", "high", "ultra", "max", "xhigh"];
  const effort = effortAllowed.includes(effortRaw) ? effortRaw : "medium";
  const experimentalEffort = payload.experimentalEffort !== false;
  const useWorktrees = Boolean(payload.useWorktrees);
  const worktreeBase = String(payload.worktreeBase || "main").trim() || "main";
  const browserSession = Boolean(payload.browserSession);
  const browserUrl = String(payload.browserUrl || "").trim();
  const imagePathsRaw = Array.isArray(payload.images) ? payload.images.slice(0, 8).map((value) => path.resolve(String(value))) : [];
  for (const imagePath of imagePathsRaw) {
    const extension = path.extname(imagePath).toLowerCase();
    const imageStats = await fs.stat(imagePath).catch(() => null);
    if (!imageStats?.isFile() || ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension) || imageStats.size > 20 * 1024 * 1024) {
      throw new Error("Eklenen görsellerden biri geçersiz veya 20 MB sınırını aşıyor.");
    }
  }
  // Stage under project so --dir workspace / tools can always open the files.
  const imagePaths = imagePathsRaw.length ? await stageImagesForRun(projectPath, imagePathsRaw) : [];
  // Free text models often crash on binary --file attachments — attach path-only for them.
  const attachBinaryImages = imagePaths.length > 0 && !modelLikelyLacksVision(model);
  let history = sanitizeHistoryForPrompt(payload.history, {
    maxTurns: engineId === "cursor" ? 6
      : engineId === "nvidia" || String(payload.model || "").startsWith("nvidia/") ? 4 : 12,
    maxChars: engineId === "cursor" ? 900
      : engineId === "nvidia" || String(payload.model || "").startsWith("nvidia/") ? 500 : 1800
  });
  if (!history.length) {
    history = sanitizeHistoryForPrompt(await readChatHistory(projectPath), {
      maxTurns: engineId === "cursor" ? 6
        : engineId === "nvidia" || String(payload.model || "").startsWith("nvidia/") ? 4 : 12,
      maxChars: engineId === "cursor" ? 900
        : engineId === "nvidia" || String(payload.model || "").startsWith("nvidia/") ? 500 : 1800
    });
  }
  const imageContext = buildImagePromptSuffix(engineId, imagePaths, { binaryAttached: attachBinaryImages });
  let effectivePrompt = `${buildPromptWithHistory(prompt, history, engineId)}${imageContext}`;
  if (browserSession) {
    effectivePrompt += `\n\n[TaxCLI: kullanıcı arayüzünde sağda tarayıcı paneli açık${browserUrl ? ` (URL: ${browserUrl})` : ""}. Web görevleri için gezinti ve düzenleme adımlarını net yaz; mümkünse projedeki dosyaları güncelle.]`;
  }
  if (experimentalEffort && effort) {
    effectivePrompt += `\n\n[TaxCLI reasoning effort: ${effort}]`;
  }
  if (approvalMode === "plan") {
    effectivePrompt = `[PLAN MODU] Dosya yazma/shell yok. Belirsizse önce soru sor; netse plan yaz ve onay bekle. Uygulama yasak.\n\n${effectivePrompt}`;
  }
  if (invocation.kind === "cmd-script" && ["cursor", "copilot", "gemini"].includes(engineId) && /[&|<>^%!]/.test(effectivePrompt)) {
    effectivePrompt = effectivePrompt.replace(/[&|<>^%!]/g, " ");
  }
  // Hard cap for shells that still wrap CLIs; task text is first so this rarely cuts the job.
  if (engineId === "cursor" && effectivePrompt.length > 12000) {
    effectivePrompt = buildPromptWithHistory(prompt, history.slice(-3), engineId) + imageContext;
    if (effectivePrompt.length > 12000) {
      effectivePrompt = buildPromptWithHistory(prompt, [], engineId) + imageContext;
    }
  }
  if (model && !/^[\w./:-]+$/.test(model)) throw new Error("Model kimliği geçersiz karakterler içeriyor.");
  // ChatGPT login rejects sol / *-codex model IDs often left in ~/.codex/config.toml.
  let effectiveModel = engineId === "codex" ? resolveCodexModel(model) : model;
  if (engineId === "codex") {
    effectiveModel = await ensureCodexConfigModel(effectiveModel);
  }

  const runId = crypto.randomUUID();
  // Flags first, prompt last — avoids Windows yargs edge cases with free-form messages.
  // Codex: options must come before positional "-" prompt or --model is ignored and config.toml wins.
  let engineArgs;
  if (engineId === "codex") {
    engineArgs = [
      "exec",
      "--model", effectiveModel,
      "-c", `model="${effectiveModel}"`,
      "--json",
      "--color", "never",
      "--sandbox", approvalMode === "plan" ? "read-only" : "workspace-write",
      "--skip-git-repo-check",
      "-C", projectPath,
      "-"
    ];
    if (experimentalEffort) {
      const codexEffort = ({ low: "low", medium: "medium", high: "high", ultra: "xhigh", max: "xhigh", xhigh: "xhigh" })[effort] || "medium";
      engineArgs.splice(5, 0, "-c", `model_reasoning_effort="${codexEffort}"`);
    }
  } else {
    engineArgs = {
      opencode: ["run", "--format", "json", "--print-logs", "--log-level", "INFO", "--dir", projectPath],
      nvidia: ["run", "--format", "json", "--print-logs", "--log-level", "INFO", "--dir", projectPath],
      // Options before -p; --trust required for non-interactive. Message-level stream-json (no partial flushes).
      cursor: [
        "--trust",
        "--workspace", projectPath,
        "--output-format", "stream-json",
        "-p", effectivePrompt
      ],
      copilot: ["-p", effectivePrompt],
      // Gemini headless: options first; never default approval (blocks without TTY).
      gemini: [
        "--output-format", "stream-json",
        "--skip-trust",
        // Cannot combine -y/--yolo with --approval-mode; use only this.
        "--approval-mode", approvalMode === "plan" ? "plan" : "yolo",
        "-p", effectivePrompt
      ]
    }[engineId];
  }
  if (!engineArgs) throw new Error("Motor adaptörü bulunamadı.");
  if (approvalMode === "auto_edit" && ["opencode", "nvidia"].includes(engineId)) engineArgs.push("--auto");
  if (approvalMode === "plan" && ["opencode", "nvidia"].includes(engineId)) engineArgs.push("--agent", "plan");
  // Non-interactive desktop: Cursor cannot prompt for tool approval — use --force unless plan.
  if (engineId === "cursor") {
    if (approvalMode === "plan") {
      const trustIdx = engineArgs.indexOf("--trust");
      engineArgs.splice(trustIdx + 1, 0, "--mode", "plan");
    } else {
      const trustIdx = engineArgs.indexOf("--trust");
      engineArgs.splice(trustIdx + 1, 0, "--force");
    }
    if (useWorktrees) {
      engineArgs.push("--worktree", worktreeBase);
    }
  }
  // Fixed title avoids an extra NVIDIA "title" LLM call (which also burns free-tier quota / 529s).
  if (["opencode", "nvidia"].includes(engineId)) engineArgs.push("--title", "TaxCLI");
  if (engineId !== "codex" && effectiveModel) engineArgs.push("--model", effectiveModel);
  if (engineId === "copilot" && experimentalEffort && effort) {
    const copilotEffort = ({ low: "low", medium: "medium", high: "high", ultra: "xhigh", max: "max", xhigh: "xhigh" })[effort] || "medium";
    engineArgs.push("--effort", copilotEffort);
  }
  if (engineId === "codex") imagePaths.forEach((imagePath) => engineArgs.push("--image", imagePath));
  if (["opencode", "nvidia"].includes(engineId)) {
    // Only attach binary for models that are likely vision-capable; free text models crash on -f.
    if (attachBinaryImages) {
      imagePaths.forEach((imagePath) => engineArgs.push("-f", imagePath));
    }
    engineArgs.push(effectivePrompt);
  }
  // Gemini: re-build -p after we may have rewritten prompt with @paths (already in effectivePrompt).
  if (engineId === "gemini" && imagePaths.length) {
    const pIdx = engineArgs.indexOf("-p");
    if (pIdx >= 0) engineArgs[pIdx + 1] = effectivePrompt;
  }
  if (engineId === "cursor" && imagePaths.length) {
    // Cursor may accept extra --add-dir; workspace already set. Prompt already lists paths.
  }
  const keys = await readProviderKeys();
  // Re-sync if key lives only in TaxCLI (e.g. saved before auth.json bridging was added).
  if (keys.nvidia && (engineId === "nvidia" || String(model).startsWith("nvidia/"))) {
    await syncOpenCodeAuth("nvidia", keys.nvidia).catch(() => {});
  }
  if (engineId === "gemini") {
    const hasApiKey = Boolean(keys.gemini);
    const hasLocal = await hasGeminiLocalAuthFiles();
    if (!hasApiKey && !hasLocal) {
      throw new Error("Gemini kimliği yok (kod 41). Bağlantılar → Gemini → API Key ile anahtar ekle, veya terminalde `gemini` ile Google girişi yap.");
    }
  }
  const runEnv = withProviderEnv(enrichedEnv(), keys, { model, engineId });
  if (engineId === "cursor" && invocation.resolvedCommand === "cursor") {
    throw new Error("Cursor Agent CLI gerekli. https://cursor.com/install adresinden Agent CLI kurup Yeniden tara.");
  }
  const child = spawn(invocation.command, [...invocation.prefix, ...engineArgs], {
    cwd: projectPath,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: runEnv
  });
  activeRuns.set(runId, child);
  emitAgentEvent(event.sender, runId, { type: "started", engineId });
  let receivedOutput = false;
  const sawImagePayload = imagePaths.length > 0;
  let killedByHub = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let streamErrorCount = 0;
  let sawOverload = false;
  let fatalEmitted = false;
  let lastActivityAt = Date.now();
  let lastStatusAt = 0;
  const isOpenCode = ["opencode", "nvidia"].includes(engineId);
  const MAX_WAIT_MS = engineId === "nvidia" || String(model).startsWith("nvidia/") ? 240000 : engineId === "gemini" ? 120000 : 180000;
  const IDLE_KILL_MS = engineId === "gemini" ? 55000 : 100000;

  const killChild = () => {
    killedByHub = true;
    if (process.platform === "win32") spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    else child.kill("SIGTERM");
  };

  const emitFatal = (code, message) => {
    if (fatalEmitted) return;
    fatalEmitted = true;
    emitAgentEvent(event.sender, runId, { type: "error", code, engineId, model, message });
    killChild();
  };

  const emitStatusThrottled = (message) => {
    const now = Date.now();
    if (now - lastStatusAt < 2500) return;
    lastStatusAt = now;
    emitAgentEvent(event.sender, runId, { type: "status", message });
  };

  const waitingTimer = setTimeout(() => {
    emitAgentEvent(event.sender, runId, {
      type: "status",
      message: sawOverload
        ? "NVIDIA yoğun; OpenCode yeniden deniyor (terminalle aynı kuyruk)…"
        : "Yanıt bekleniyor…"
    });
  }, 12000);

  const startedAt = Date.now();
  // Without a TTY Gemini/Cursor can hang forever on approval or auth — kill silent runs.
  const hardTimer = setInterval(() => {
    if (receivedOutput || fatalEmitted) return;
    const idle = Date.now() - lastActivityAt;
    if (Date.now() - startedAt >= MAX_WAIT_MS || idle >= IDLE_KILL_MS) {
      if (engineId === "gemini") {
        emitFatal(
          "MODEL_TIMEOUT",
          "Gemini yanıt vermedi. Olası nedenler: oturum yok (Bağlantılar → Gemini / API anahtarı), model adı geçersiz, veya CLI sürümü eski. Terminalde `gemini -p \"merhaba\" -y` dene."
        );
        return;
      }
      emitFatal(
        sawOverload ? "PROVIDER_OVERLOADED" : "MODEL_TIMEOUT",
        sawOverload
          ? `${model || "NVIDIA modeli"} sağlayıcı yoğun (HTTP 529). ${streamErrorCount || "Birkaç"} yeniden deneme de yetmedi — birkaç dakika sonra tek, kısa bir mesaj dene.`
          : `${model || engineId} ${Math.round((Date.now() - startedAt) / 1000)}s içinde yanıt vermedi.`
      );
    }
  }, 2000);

  const drain = (chunk, stream) => {
    lastActivityAt = Date.now();
    if (stream === "stdout") {
      receivedOutput = true;
      streamErrorCount = 0;
    }
    clearTimeout(waitingTimer);
    const incoming = (stream === "stdout" ? stdoutBuffer : stderrBuffer) + chunk.toString("utf8");
    const lines = incoming.split(/\r?\n/);
    if (stream === "stdout") stdoutBuffer = lines.pop() || "";
    else stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (stream === "stderr" && isOpenCode) {
        const parsed = parseOpenCodeLogLine(line);
        if (parsed?.kind === "overloaded") {
          sawOverload = true;
          streamErrorCount += 1;
          emitStatusThrottled(`NVIDIA yoğun (529) · deneme ${streamErrorCount} — OpenCode bekliyor…`);
        } else if (parsed?.kind === "auth") {
          emitFatal("AUTH_FAILED", parsed.message);
        } else if (parsed?.kind === "forbidden") {
          emitFatal("FORBIDDEN", parsed.message);
        } else if (parsed?.kind === "api_error" || parsed?.kind === "log_error") {
          streamErrorCount += 1;
          if (parsed.status) emitStatusThrottled(`${parsed.status} (${streamErrorCount})`);
        }
        continue;
      }
      emitAgentEvent(event.sender, runId, { type: "output", stream, event: parseEventLine(engineId, line) });
    }
  };
  child.stdout.on("data", (chunk) => drain(chunk, "stdout"));
  child.stderr.on("data", (chunk) => drain(chunk, "stderr"));
  child.on("error", (error) => emitAgentEvent(event.sender, runId, { type: "error", message: error.message }));
  child.on("close", (code, signal) => {
    clearTimeout(waitingTimer);
    if (hardTimer) clearInterval(hardTimer);
    if (stdoutBuffer.trim()) emitAgentEvent(event.sender, runId, { type: "output", stream: "stdout", event: parseEventLine(engineId, stdoutBuffer) });
    if (stderrBuffer.trim() && !isOpenCode) emitAgentEvent(event.sender, runId, { type: "output", stream: "stderr", event: parseEventLine(engineId, stderrBuffer) });
    if (!fatalEmitted && code && code !== 0) {
      const errTail = stderrBuffer.trim().slice(-600);
      const geminiHint = engineId === "gemini" ? geminiExitHint(code, errTail) : "";
      let hint = geminiHint;
      if (!hint) {
        if (sawOverload) {
          hint = "NVIDIA sağlayıcısı yoğun (529). Anahtar sorunu değil; sonra tekrar dene.";
        } else if (sawImagePayload && (/vision|image|multimodal|media_type|unsupported.*file|does not support/i.test(errTail) || !receivedOutput)) {
          hint = errTail.slice(-220)
            || `${engineId} görselli istekte çöktü. Model vision desteklemeyebilir — Gemini / GPT-4o sınıfı dene; ücretsiz metin modelleri çoğu zaman resmi okumaz.`;
        } else if (/workspace trust|do you trust|--trust|--yolo|\s-f\b/i.test(errTail)) {
          hint = "Workspace Trust engeli: TaxCLI bu klasöre --trust ile başlatır. Uygulamayı yeniden başlatıp tekrar dene.";
        } else if (/not logged|please log|authentication|unauthorized|login required/i.test(errTail)) {
          hint = "Cursor Agent oturumu yok. Terminalde: agent login";
        } else if (!receivedOutput) {
          hint = errTail.slice(-240) || `${engineId} çıktı vermeden kapandı.`;
        }
      }
      // Gemini always maps known exit codes; other engines only when no model text arrived.
      if (hint && (engineId === "gemini" || !receivedOutput || (sawImagePayload && code))) {
        emitAgentEvent(event.sender, runId, {
          type: "error",
          code: code === 41 ? "AUTH_FAILED" : sawOverload ? "PROVIDER_OVERLOADED" : "AGENT_EXIT",
          engineId,
          model,
          message: hint
        });
      }
    }
    activeRuns.delete(runId);
    emitAgentEvent(event.sender, runId, { type: "finished", code: killedByHub ? null : code, signal });
  });
  child.stdin.end(engineId === "codex" ? effectivePrompt : "");
  return {
    runId,
    historyTurns: history.length,
    visionNote: imagePaths.length && !attachBinaryImages
      ? `Model vision değil görünüyor (${model || "varsayılan"}); resim yolu projeye yazıldı, binary ek yok. Gerçek görsel için Gemini / vision model dene.`
      : ""
  };
});

ipcMain.handle("agent:stop", async (_event, runId) => {
  const child = activeRuns.get(String(runId));
  if (!child) return false;
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
  return true;
});

ipcMain.handle("memory:generate", async (_event, payload) => {
  const root = path.resolve(payload.projectPath || "");
  if (!payload.projectPath || !path.isAbsolute(root)) throw new Error("Geçerli bir proje klasörü seçin.");

  const memoryRoot = path.join(root, ".aihub");
  await fs.mkdir(path.join(memoryRoot, "agents"), { recursive: true });

  const clean = (value, fallback) => String(value || fallback).trim();
  const name = clean(payload.name, path.basename(root));
  const goal = clean(payload.goal, "Projenin amacı henüz tanımlanmadı.");
  const stack = clean(payload.stack, "Teknoloji yığını henüz tanımlanmadı.");
  const rules = clean(payload.rules, "Mevcut kod stilini koru. Riskli işlemlerden önce onay al.");

  const files = {
    ".aihub/project.md": `# ${name}\n\n## Amaç\n\n${goal}\n\n## Teknoloji Yığını\n\n${stack}\n`,
    ".aihub/architecture.md": `# Mimari\n\nBu dosya proje analizi sırasında güncellenir.\n`,
    ".aihub/conventions.md": `# Kurallar\n\n${rules}\n`,
    ".aihub/decisions.md": "# Teknik Kararlar\n\nYeni kararlar kullanıcı onayıyla buraya eklenir.\n",
    ".aihub/memory.md": `# Proje Hafızası\n\n- Proje: ${name}\n- Amaç: ${goal}\n`,
    ".aihub/tasks.md": "# Görevler\n\n## Aktif\n\n## Tamamlanan\n",
    ".aihub/permissions.md": "# Ajan İzinleri\n\n- Dosya okuma: izinli\n- Dosya yazma: onay iste\n- Komut çalıştırma: onay iste\n- Ağ erişimi: onay iste\n",
    "AGENTS.md": `# Agent Instructions\n\n## Project\n${goal}\n\n## Stack\n${stack}\n\n## Rules\n${rules}\n\nRead .aihub/ for project memory and decisions. Ask before destructive or irreversible actions.\n`,
    "GEMINI.md": `# Project Context\n\n${goal}\n\nStack: ${stack}\n\nRules:\n${rules}\n\nUse .aihub/ as the canonical project memory.\n`,
    ".github/copilot-instructions.md": `Project goal: ${goal}\n\nTechnology stack: ${stack}\n\nProject rules: ${rules}\n\nConsult .aihub/ before making architectural changes.\n`,
    ".cursor/rules/project-memory.mdc": `---\ndescription: Canonical project memory\nalwaysApply: true\n---\nProject goal: ${goal}\nStack: ${stack}\nRules: ${rules}\nRead .aihub/ for decisions and conventions.\n`
  };

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { encoding: "utf8", flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }

  return { root, files: Object.keys(files) };
});

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.taxperia.taxcli");
  }
  configureBrowserSession();
  createWindow();
  configureAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
