const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

test("auto-review is sent to the actual app-server protocol and manual fallbacks retain their run mode", async (t) => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit("close", 0)); };
  const messages = [], events = [];
  child.stdin.on("data", (chunk) => {
    const message = JSON.parse(chunk.toString());
    messages.push(message);
    if (!message.method || message.id == null) return;
    const result = message.method === "thread/start" ? { thread: { id: "fixture-thread" } } : {};
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
  });
  const source = fs.readFileSync(path.join(__dirname, "../electron/codex-app-server.js"), "utf8");
  const moduleContext = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleContext, console, setTimeout, clearTimeout,
    process: { platform: "linux" },
    require: (name) => name === "node:child_process" ? { spawn: () => child } : require(name)
  });
  const controller = await moduleContext.exports.startCodexAppServerRun({
    invocation: { command: "fixture-codex", prefix: [] }, runId: "fixture-run", projectPath: "C:\\project",
    prompt: "Run the project tests", approvalMode: "auto_edit", emit: (event) => events.push(event), register() {}
  });
  t.after(() => controller.stop());
  assert.equal(messages.find((m) => m.method === "initialize").params.capabilities.experimentalApi, true);
  const settings = messages.find((m) => m.method === "thread/start").params;
  assert.equal(settings.approvalPolicy, "on-request");
  assert.equal(settings.approvalsReviewer, "auto_review");
  assert.equal(settings.sandbox, "workspace-write");
  assert.equal(settings.cwd, "C:\\project");
  child.stdout.write(`${JSON.stringify({ id: "native-approval", method: "item/commandExecution/requestApproval", params: { command: "npm test", cwd: "C:\\project" } })}\n`);
  const request = events.find((event) => event.type === "approval-request");
  assert.equal(request.approval.approvalMode, "auto_edit");
  assert.equal(request.approval.reviewer, "auto_review");
  assert.equal(messages.some((m) => m.id === "native-approval"), false, "the client must not blindly accept a fallback approval");
  assert.equal(controller.respondApproval(request.requestId, "decline"), true);
  assert.equal(messages.find((m) => m.id === "native-approval").result.decision, "decline");
});
