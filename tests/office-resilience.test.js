const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

test("engine discovery and sidebar navigation are coalesced", () => {
  assert.match(appSource, /if \(engineDetectionPromise\) return engineDetectionPromise/);
  assert.match(appSource, /while \(pendingSidebarNavigation\)/);
});

test("office conversations create a durable autosave snapshot", () => {
  assert.match(appSource, /office-dashboard-host/);
  assert.match(appSource, /scheduleHistorySave\(meta\.projectPath, meta\.historyConversationId/);
  assert.match(appSource, /const messages = local\.length \? local : disk/);
  assert.match(appSource, /agenthub:conversations:/);
  assert.match(appSource, /function recoverLocalConversationMetas/);
});

test("auto Copilot model does not receive an unsupported effort flag", () => {
  assert.match(mainSource, /engineId === "copilot"[^\n]+!\/\^auto\$\/i\.test\(effectiveModel\)/);
  assert.match(mainSource, /usesNvidiaProvider \? 75000/);
});

test("office model loading skips disconnected engines and Cursor auth errors stay non-fatal", () => {
  assert.match(appSource, /!engineStatus\?\.installed \|\| !engineStatus\?\.authenticated/);
  assert.match(appSource, /function refreshOfficeModelSelects\(\)/);
  assert.match(mainSource, /function isCliAuthenticationError\(value\)/);
  assert.match(mainSource, /isCliAuthenticationError\(`\$\{result\.stdout/);
});

test("model menus collapse duplicate auto choices and Copilot avoids private GitHub endpoints", () => {
  assert.match(appSource, /function normalizeAutoModelSelection\(value\)/);
  assert.match(appSource, /function modelOptionsWithoutAuto\(models = \[\]\)/);
  assert.doesNotMatch(mainSource, /copilot_internal/);
  assert.doesNotMatch(mainSource, /\[copilot models\] api/);
  assert.match(mainSource, /Use only the installed official CLI/);
});

test("multi AI supports searchable models with sequential disposable variants", () => {
  const prepareSource = mainSource.slice(mainSource.indexOf('ipcMain.handle("parallel:prepare"'), mainSource.indexOf('ipcMain.handle("office:prepare"'));
  assert.match(indexSource, /id="multiAiModelSearch"[^>]+type="search"/);
  assert.match(appSource, /data-multi-model-option/);
  assert.match(appSource, /claude-sonnet-4\.6/);
  assert.match(appSource, /multi-ai-model-option locked/);
  assert.match(appSource, /function normalizeMultiAiSelection\(value\)/);
  assert.match(appSource, /prepareParallelWorkspaces\(\{ projectPath, variants: requestedVariants \}\)/);
  assert.match(appSource, /comparisonMode: true/);
  assert.match(prepareSource, /variantsToPrepare\.length >= MAX_COMPARISON_VARIANTS/);
  assert.match(mainSource, /const MAX_COMPARISON_VARIANTS = 64/);
  assert.match(appSource, /const MAX_MULTI_AI_VARIANTS = 64/);
  assert.match(appSource, /id: "gpt-6", label: "GPT-6"/);
  assert.match(appSource, /id: "claude", name: "Claude Code"/);
  assert.match(prepareSource, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
  assert.doesNotMatch(prepareSource, /new Set\(requested\.map/);
  assert.match(prepareSource, /ipcMain\.handle\("parallel:materialize"/);
  assert.match(prepareSource, /workbench\.unseal\(`batch-\$\{batchId\}`\)/);
  assert.match(prepareSource, /ipcMain\.handle\("parallel:cleanup"/);
  assert.match(appSource, /await completed;/);
  assert.match(appSource, /cleanupParallelWorkspace/);
  assert.match(mainSource, /Bu bir kör karşılaştırma koşusudur/);
});

test("quality policy and reasoning effort share one clear tuning dropdown", () => {
  assert.match(indexSource, /id="runTuningButton"/);
  assert.match(indexSource, /id="runTuningDropdown"/);
  assert.match(indexSource, /id="routePolicyList"/);
  assert.match(indexSource, /id="effortList"/);
  assert.doesNotMatch(indexSource, /id="routePolicyButton"/);
  assert.doesNotMatch(indexSource, /id="effortButton"/);
  assert.match(appSource, /let effortMode = localStorage\.getItem\("agenthub:effort-mode"\)/);
  assert.match(appSource, /function selectedEffortFor\(/);
});
