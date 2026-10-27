const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAppUpdates, UPDATE_INTERVAL_MS } = require("../electron/app-updates");

function fixture({ packaged = true, latest = "0.2.0" } = {}) {
  const updater = new EventEmitter(), events = [], scheduled = [], cleared = [];
  let checks = 0, downloads = 0, installs = 0, busy = false, downloadFailure = false;
  updater.checkForUpdates = async () => {
    checks++; updater.emit("checking-for-update");
    updater.emit(latest ? "update-available" : "update-not-available", { version: latest || "0.1.0" });
    return { updateInfo: { version: latest || "0.1.0" } };
  };
  updater.downloadUpdate = async () => {
    downloads++;
    if (downloadFailure) throw new Error("Network unavailable");
    updater.emit("download-progress", { percent: 51.8 });
    await new Promise((resolve) => setImmediate(resolve));
    updater.emit("update-downloaded", { version: latest });
    return ["installer.exe"];
  };
  updater.quitAndInstall = (silent, restart) => { assert.equal(silent, false); assert.equal(restart, true); installs++; };
  const schedule = (fn, ms) => { const timer = { fn, ms }; scheduled.push(timer); return timer; };
  const service = createAppUpdates({ app: { isPackaged: packaged, getVersion: () => "0.1.0" }, updater,
    emit: (event) => events.push(event), canInstall: () => !busy,
    timers: { setTimeout: schedule, setInterval: schedule, clearTimeout: (id) => cleared.push(id), clearInterval: (id) => cleared.push(id) } });
  return { service, updater, events, scheduled, cleared, counters: () => ({ checks, downloads, installs }), setBusy: (value) => { busy = value; }, failDownload: (value) => { downloadFailure = value; } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("installed builds check GitHub at startup and periodically, then download without a user click", async () => {
  const f = fixture(); f.service.start(); f.service.start();
  assert.deepEqual(f.scheduled.map((t) => t.ms), [15000, UPDATE_INTERVAL_MS]);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.updater.allowPrerelease, false);
  await f.scheduled[0].fn(); await f.service.download();
  assert.deepEqual(f.counters(), { checks: 1, downloads: 1, installs: 0 });
  assert.equal(f.service.snapshot().phase, "downloaded");
  assert.equal(f.events.find((e) => e.type === "progress").percent, 52);
  await f.scheduled[1].fn();
  assert.equal(f.service.snapshot().phase, "downloaded"); assert.equal(f.counters().checks, 1);
  f.setBusy(true); assert.throws(() => f.service.install(), /Çalışan ajan/);
  f.setBusy(false); assert.equal(f.service.install(), true); assert.equal(f.counters().installs, 1);
  f.service.dispose(); assert.equal(f.cleared.length, 2); assert.equal(f.updater.listenerCount("update-available"), 0);
});

test("overlapping update checks and downloads share one request", async () => {
  const f = fixture(); f.service.start();
  await Promise.all([f.service.check(), f.service.check()]);
  await Promise.all([f.service.download(), f.service.download(), f.service.check()]);
  assert.deepEqual(f.counters(), { checks: 1, downloads: 1, installs: 0 });
});

test("download errors are visible and retryable without allowing installation", async () => {
  const f = fixture(); f.failDownload(true); f.service.start();
  await f.service.check(); await settle();
  assert.equal(f.service.snapshot().phase, "error"); assert.match(f.service.snapshot().error, /Network unavailable/);
  assert.throws(() => f.service.install(), /henüz indirilmedi/);
  f.failDownload(false); await f.service.download();
  assert.equal(f.counters().downloads, 2); assert.equal(f.service.snapshot().phase, "downloaded");
});

test("development builds never schedule updates and a current release does not download", async () => {
  const dev = fixture({ packaged: false }); dev.service.start();
  assert.equal((await dev.service.check()).supported, false); assert.equal((await dev.service.download()).supported, false);
  assert.equal(dev.service.install(), false); assert.equal(dev.scheduled.length, 0);
  assert.deepEqual(dev.counters(), { checks: 0, downloads: 0, installs: 0 });
  const current = fixture({ latest: null }); current.service.start(); await current.service.check();
  assert.equal(current.service.snapshot().phase, "not-available"); assert.equal(current.counters().downloads, 0);
});
