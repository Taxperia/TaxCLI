const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createAppUpdates({ app, updater, emit, canInstall = () => true, timers = globalThis }) {
  let phase = "idle", version = "", percent = 0, error = "";
  let checking = null, downloading = null, started = false;
  let startupTimer, intervalTimer;
  const listeners = [];
  const snapshot = () => ({ supported: Boolean(app.isPackaged), currentVersion: app.getVersion(), latestVersion: version || app.getVersion(), version, phase, percent, error,
    message: app.isPackaged ? "GitHub sürümleri otomatik kontrol edilir." : "Otomatik güncelleme yalnızca kurulu sürümde çalışır." });
  function notify(type) { emit({ type, ...snapshot() }); }
  function failed(reason) { error = String(reason?.message || reason || "Güncelleme başarısız.").slice(0, 1000); phase = "error"; notify("error"); }
  function listen(name, handler) { updater.on(name, handler); listeners.push([name, handler]); }
  async function check() {
    if (!app.isPackaged || downloading || phase === "downloaded") return snapshot();
    if (checking) return checking;
    checking = Promise.resolve().then(() => updater.checkForUpdates()).then(() => snapshot()).catch((reason) => { failed(reason); throw reason; }).finally(() => { checking = null; });
    return checking;
  }
  async function download() {
    if (!app.isPackaged) return snapshot();
    if (phase === "downloaded") return snapshot();
    if (downloading) return downloading;
    if (!version) throw new Error("Önce güncellemeleri kontrol edin.");
    phase = "downloading"; error = ""; percent = 0; notify("downloading");
    downloading = Promise.resolve().then(() => updater.downloadUpdate()).then(() => snapshot()).catch((reason) => { failed(reason); throw reason; }).finally(() => { downloading = null; });
    return downloading;
  }
  function install() {
    if (!app.isPackaged) return false;
    if (phase !== "downloaded") throw new Error("Güncelleme henüz indirilmedi.");
    if (!canInstall()) throw new Error("Çalışan ajan görevi var. Güncellemeyi kurmadan önce görevin tamamlanmasını bekleyin.");
    updater.quitAndInstall(false, true);
    return true;
  }
  function start() {
    if (started || !app.isPackaged) return;
    started = true;
    // Own download retries and retain the ready installer across later checks.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    listen("checking-for-update", () => { phase = "checking"; error = ""; notify("checking"); });
    listen("update-available", (info) => { version = info.version; phase = "available"; notify("available"); download().catch(() => {}); });
    listen("update-not-available", () => { version = ""; phase = "not-available"; percent = 0; notify("not-available"); });
    listen("download-progress", (progress) => { percent = Math.min(100, Math.max(0, Math.round(Number(progress.percent) || 0))); notify("progress"); });
    listen("update-downloaded", (info) => { version = info.version; phase = "downloaded"; percent = 100; error = ""; notify("downloaded"); });
    listen("error", failed);
    const runCheck = () => check().catch(() => {});
    startupTimer = timers.setTimeout(runCheck, 15000);
    intervalTimer = timers.setInterval(runCheck, UPDATE_INTERVAL_MS);
    startupTimer?.unref?.(); intervalTimer?.unref?.();
  }
  function dispose() {
    timers.clearTimeout(startupTimer); timers.clearInterval(intervalTimer);
    for (const [name, handler] of listeners) updater.removeListener(name, handler);
    listeners.length = 0; started = false;
  }
  return { start, check, download, install, snapshot, dispose };
}

module.exports = { createAppUpdates, UPDATE_INTERVAL_MS };
