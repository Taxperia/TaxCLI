const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { assertOpenCodeModelAvailable, createOpenCodeDiagnostics } = require("../electron/opencode-diagnostics");
const { redactSensitive } = require("../electron/security-center");

test("OpenCode rejects a removed saved model and preserves supported models", () => {
  assert.throws(() => assertOpenCodeModelAvailable("opencode/nemotron-3-ultra-free", ["opencode/beam-free"]), /kataloğunda bulunmuyor/);
  assert.doesNotThrow(() => assertOpenCodeModelAvailable("opencode/beam-free", ["opencode/beam-free"]));
  assert.doesNotThrow(() => assertOpenCodeModelAvailable("", []));
});

function runStream() {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8");
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  const events = [];
  const context = vm.createContext({
    child, engineId: "opencode", model: "opencode/test", imagePaths: [], runtimeSecrets: ["fixture-secret"],
    activeRuns: new Map(), runId: "fixture", event: { sender: {} }, engine: { accountLabel: "OpenCode" },
    guardProcess: () => () => {}, createOpenCodeDiagnostics, redactSensitive,
    projectPath: "fixture", debugStream: false, process: { platform: "linux" },
    createSecurityCenter: () => ({ audit: async () => {} }),
    emitAgentEvent: (_sender, _id, event) => events.push(event),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    console, Date
  });
  const helpers = source.slice(source.indexOf("function parseEventLine("), source.indexOf("function isNoiseHistoryContent("));
  vm.runInContext(helpers, context);
  const start = source.indexOf("  let receivedOutput = false;", source.indexOf('ipcMain.handle("agent:start"'));
  const end = source.indexOf('  child.stdin.end(engineId === "codex"', start);
  vm.runInContext(source.slice(start, end), context);
  return { child, events };
}

test("OpenCode preserves newline-terminated stderr after startup output and redacts secrets", () => {
  const { child, events } = runStream();
  child.stdout.write('{"type":"step_start"}\n');
  child.stderr.write('Error: Provider failed with fixture-secret\n');
  child.emit("close", 1);
  const error = events.find(e => e.type === "error");
  assert.match(error.message, /Provider failed/);
  assert.doesNotMatch(error.message, /fixture-secret/);
  assert.equal(events.at(-1).type, "finished");
  assert.equal(events.at(-1).code, 1);
});

test("OpenCode structured errors without a final newline reach the run recorder even on exit zero", () => {
  const { child, events } = runStream();
  child.stdout.write('{"type":"error","error":{"name":"APIError","data":{"message":"Free usage limit reached"}}}');
  child.emit("close", 0);
  assert.equal(events.find(e => e.type === "error").message, "Free usage limit reached");
  assert.equal(events.at(-1).type, "finished");
});

test("OpenCode structured log error remains visible after later informational logs", () => {
  const { child, events } = runStream();
  child.stderr.write('level=ERROR message="stream error" error.error="AI_APICallError: quota exhausted"\n');
  child.stderr.write('level=INFO message="disposing instance"\n');
  child.emit("close", 1);
  assert.match(events.find(e => e.type === "error").message, /quota exhausted/);
});
