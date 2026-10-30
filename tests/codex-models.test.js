const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

function fixture(reply) {
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
    const response = reply(message);
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, ...response })}\n`));
  });
  const moduleContext = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../electron/codex-app-server.js"), "utf8"), {
    module: moduleContext, console, setTimeout, clearTimeout,
    process: { platform: "linux" },
    require: (name) => name === "node:child_process" ? { spawn: () => child } : require(name)
  });
  return { api: moduleContext.exports, child, messages, events };
}

const connection = { invocation: { command: "fixture-codex", prefix: [] }, env: {} };

test("Codex models use paginated account results, canonical IDs and no speculative entries", async () => {
  const f = fixture((message) => {
    if (message.method !== "model/list") return { result: {} };
    return { result: message.params.cursor ? {
      data: [{ id: "duplicate", model: "available-sol" }, { id: "other", displayName: "Other" }], nextCursor: null
    } : {
      data: [{ id: "picker-id", model: "available-sol", displayName: "Available Sol", isDefault: true }, { id: "hidden", hidden: true }], nextCursor: "page-2"
    } };
  });
  const models = await f.api.readCodexModels(connection);
  assert.deepEqual(Array.from(models, (m) => m.id), ["available-sol", "other"]);
  assert.equal(models[0].label, "Available Sol");
  assert.equal(models[0].isDefault, true);
  const requests = f.messages.filter((m) => m.method === "model/list");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].params.includeHidden, false);
  assert.equal(requests[1].params.cursor, "page-2");
  assert.equal(f.child.killed, true);
  assert.equal(f.messages.some((m) => /thread|turn|usage/.test(m.method)), false);
});

test("Codex discovery failure stops the helper without inventing a fallback model", async () => {
  const f = fixture((message) => message.method === "model/list" ? { error: { message: "Account offline" } } : { result: {} });
  await assert.rejects(f.api.readCodexModels(connection), /Account offline/);
  assert.equal(f.child.killed, true);
});

test("a stale saved model is rejected before starting a Codex thread or turn", async () => {
  const f = fixture((message) => ({ result: message.method === "model/list" ? { data: [{ id: "available-sol" }] } : {} }));
  await assert.rejects(f.api.startCodexAppServerRun({
    ...connection, runId: "fixture", projectPath: "C:\\project", prompt: "Task", model: "gpt-6",
    emit: (event) => f.events.push(event), register() {}
  }), /'gpt-6'.*model listesinde yok/);
  assert.equal(f.messages.some((m) => m.method === "thread/start" || m.method === "turn/start"), false);
  assert.equal(f.child.killed, true);
});

test("a model returned by the same Codex session reaches both thread and turn unchanged", async (t) => {
  const f = fixture((message) => ({ result: message.method === "model/list"
    ? { data: [{ id: "picker-id", model: "available-sol" }] }
    : message.method === "thread/start" ? { thread: { id: "thread" } } : {} }));
  const controller = await f.api.startCodexAppServerRun({
    ...connection, runId: "fixture", projectPath: "C:\\project", prompt: "Task", model: "available-sol",
    emit() {}, register() {}
  });
  t.after(() => controller.stop());
  assert.equal(f.messages.find((m) => m.method === "thread/start").params.model, "available-sol");
  assert.equal(f.messages.find((m) => m.method === "turn/start").params.model, "available-sol");
});
