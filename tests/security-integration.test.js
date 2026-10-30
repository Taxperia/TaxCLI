const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("Electron renderer and embedded browser retain mandatory security boundaries", () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /will-redirect/);
  assert.match(main, /will-frame-navigate/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /will-download/);
  assert.match(main, /setWindowOpenHandler/);
  assert.doesNotMatch(preload, /invoke:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /allowpopups/i);
  assert.doesNotMatch(renderer, /browserLoop\s*\?\s*["']auto_edit["']/);
  assert.match(renderer, /Tarayıcı eylemine izin verilsin mi\?/);
  assert.match(renderer, /Sayfa içeriği AI sağlayıcısına gönderilsin mi\?/);
  assert.match(renderer, /function browserUrlForModel/);
});

test("agent secrets and blind comparisons fail closed", () => {
  assert.match(main, /if \(!allowShell\) \{/);
  assert.match(main, /findSensitivePaths\(projectPath/);
  assert.doesNotMatch(main, /syncOpenCodeAuth/);
  assert.match(main, /runtimeSecrets/);
  assert.match(main, /ipcMain\.handle\("parallel:materialize"/);
  assert.match(main, /ipcMain\.handle\("parallel:cleanup"/);
  assert.match(renderer, /await completed;/);
  assert.match(renderer, /cleanupParallelWorkspace/);
});

test("release and dependency security controls are configured", () => {
  assert.equal(pkg.build.win.verifyUpdateCodeSignature, true);
  assert.ok(pkg.scripts["security:audit"]);
  assert.ok(pkg.scripts["security:sbom"]);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /OUTPUT_LIMIT/);
  assert.match(main, /activeRuns\.size\s*>=\s*8/);
  assert.match(main, /validateIpcRequest\(channel, args\)/);
  assert.match(main, /event\.sender\s*!==\s*mainWindow\.webContents/);
  assert.deepEqual(pkg.build.electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // Standard Electron releases do not ship browser_v8_context_snapshot.bin.
    loadBrowserProcessSpecificV8Snapshot: false,
    // The shell uses loadFile to serve its renderer from app.asar.
    grantFileProtocolExtraPrivileges: true
  });
  assert.match(pkg.scripts.release, /require-signing\.js/);
  assert.doesNotMatch(main, /irm\s+[^\r\n]*\|\s*iex/i);
});
