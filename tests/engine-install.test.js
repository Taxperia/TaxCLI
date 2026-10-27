const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("supported engines use pinned installers and never pipe remote scripts into PowerShell", () => {
  assert.match(mainSource, /codex: "@openai\/codex@0\.161\.0"/);
  assert.match(mainSource, /opencode: "opencode-ai@1\.18\.35"/);
  assert.match(mainSource, /gemini: "@google\/gemini-cli@0\.63\.0"/);
  assert.match(mainSource, /@github\/copilot@1\.0\.93/);
  assert.match(mainSource, /"GitHub\.Copilot"/);
  assert.match(mainSource, /"Anthropic\.ClaudeCode"/);
  assert.match(mainSource, /claude: "https:\/\/code\.claude\.com\/docs\/en\/getting-started"/);
  assert.match(mainSource, /cursor\.com\/docs\/cli\/installation/);
  assert.doesNotMatch(mainSource, /irm[^\n]*\|\s*iex/i);
  assert.match(mainSource, /OpenJS\.NodeJS\.LTS/);
});

test("Claude Code is a first-class authenticated engine", () => {
  assert.match(mainSource, /claude:\s*\{\s*command: "claude"/);
  assert.match(mainSource, /authArgs: \["auth", "status"\]/);
  assert.match(mainSource, /claude:\s*\[\s*"--output-format", "stream-json"/);
  assert.match(mainSource, /if \(engineId === "claude"\) engineArgs\.push\("-p", effectivePrompt\)/);
  assert.match(mainSource, /"--output-format", "stream-json"/);
  assert.match(rendererSource, /id: "claude", name: "Claude Code"/);
});

test("engine installation is available through the isolated preload bridge", () => {
  assert.match(mainSource, /ipcMain\.handle\("engine:install"/);
  assert.match(preloadSource, /installEngine: \(engineId\) => ipcRenderer\.invoke\("engine:install", engineId\)/);
  assert.match(rendererSource, /data-install-engine=/);
  assert.match(rendererSource, /window\.agentHub\.installEngine\(engineId\)/);
});

test("NVIDIA is not reported installed when its OpenCode runtime is missing", () => {
  assert.doesNotMatch(mainSource, /Boolean\(invocation\) \|\| id === "nvidia"/);
  assert.match(mainSource, /API anahtarı kayıtlı · OpenCode CLI eksik/);
});
