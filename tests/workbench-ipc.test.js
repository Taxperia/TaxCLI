const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { registerWorkbench } = require("../electron/workbench-ipc");
const { SnapshotManager } = require("../electron/workspace-services");
const { agentStartHarness } = require("./helpers/agent-start-harness");

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-wb-ipc-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), storage = path.join(root, "data");
  await fs.mkdir(project); await fs.mkdir(storage);
  const histories = new Map([["main", [{ role: "user", content: "Task" }, { role: "assistant", content: "Answer" }]]]);
  let handler, selection = null;
  const service = registerWorkbench({
    ipcMain: { handle: (_channel, fn) => { handler = fn; } }, app: { getPath: () => storage },
    dialog: { showOpenDialog: async () => selection || { canceled: true }, showSaveDialog: async () => ({ canceled: true }) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (v) => v.toString() },
    createSnapshotManager: () => new SnapshotManager({ storageRoot: path.join(storage, "snapshots") }),
    createSecurityCenter: () => ({ workspaceStatus: async () => ({ trusted: true }), trustWorkspace: async () => true }),
    resolveEngineInvocation: async () => null, checkEngineAuth: async () => ({ authenticated: false }), captureCommand: async () => ({ code: 0, stdout: "1.0" }), listEngineModels: async () => [],
    writeConversationHistory: async (_root, conversationId, title, messages) => { histories.set(conversationId, messages); return { title }; },
    readConversationHistory: async (_root, conversationId) => histories.get(conversationId) || [], queueConversationMutation: async (_root, fn) => fn(), activeRuns: new Map()
  });
  return { root, project, storage, histories, service, select: (value) => { selection = value; }, request: (action, payload = {}) => handler({}, action, { projectPath: project, ...payload }) };
}

test("IPC branch creation copies files and keeps branch writes outside the main project", async (t) => {
  const { project, request, histories } = await setup(t);
  await fs.writeFile(path.join(project, "app.txt"), "base");
  const branch = await request("branch-create", { parentId: "main", title: "Alternative", forkAt: 1, engineId: "claude" });
  assert.equal(histories.get(branch.id).length, 1);
  assert.notEqual(branch.workingPath, project);
  await fs.writeFile(path.join(branch.workingPath, "app.txt"), "solution");
  assert.equal(await fs.readFile(path.join(project, "app.txt"), "utf8"), "base");
  assert.equal((await request("branch-diff", { branchId: branch.id }))[0].path, "app.txt");
  await request("branch-apply", { branchId: branch.id });
  assert.equal(await fs.readFile(path.join(project, "app.txt"), "utf8"), "solution");
  await fs.writeFile(path.join(branch.workingPath, "app.txt"), "solution 2");
  await request("branch-apply", { branchId: branch.id });
  assert.equal(await fs.readFile(path.join(project, "app.txt"), "utf8"), "solution 2");
});

test("IPC import creates a new conversation and leaves source files untouched", async (t) => {
  const { root, histories, request, select } = await setup(t);
  const filename = path.join(root, "external-session.jsonl");
  const raw = JSON.stringify({ type: "user", message: { role: "user", content: "Imported task" } });
  await fs.writeFile(filename, raw);
  select({ canceled: false, filePaths: [filename] });
  const result = await request("session-import");
  assert.equal(histories.get(result.conversationId)[0].content, "Imported task");
  assert.equal(await fs.readFile(filename, "utf8"), raw);
});

test("archived arena solutions can be retested after their live folder is deleted", async (t) => {
  const { root, project, request, service } = await setup(t);
  const variant = path.join(root, "variant"); await fs.mkdir(variant);
  await fs.writeFile(path.join(variant, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await fs.writeFile(path.join(variant, "a.txt"), "base");
  const runId = crypto.randomUUID();
  await service.begin(runId, { projectPath: variant, originProjectPath: project, engineId: "codex", prompt: "Task", arenaId: "arena-1" });
  await fs.writeFile(path.join(variant, "a.txt"), "after");
  await service.record(runId, { type: "finished", code: 0 });
  await fs.rm(variant, { recursive: true, force: true });
  let sawSolution = false;
  service.runner = async (cwd) => { sawSolution = await fs.readFile(path.join(cwd, "a.txt"), "utf8") === "after"; return { code: 0, output: "pass", durationMs: 1 }; };
  const report = await request("run-tests", { runId });
  assert.equal(sawSolution, true); assert.equal(report.checks[0].code, 0);
  await assert.rejects(fs.access(report.projectPath));
  assert.equal((await request("run", { runId })).tests.checks[0].code, 0);
});

test("retesting a judged solution updates arena scores and invalidates the old winner", async (t) => {
  const { project, request, service } = await setup(t);
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  let code = 0;
  service.runner = async () => ({ code, output: code ? "fail" : "pass", durationMs: 1 });
  const arena = await service.createArena(project, "Task", [{ variantId: "variant-1", engineId: "codex" }, { variantId: "variant-2", engineId: "claude" }], { engineId: "codex" });
  const runId = crypto.randomUUID();
  await service.begin(runId, { projectPath: project, engineId: "codex", prompt: "Task", arenaId: arena.id, variantId: "variant-1" });
  await service.record(runId, { type: "finished", code: 0 });
  await service.arenaResult(arena.id, "variant-1", runId, await request("run-tests", { runId }));
  const judgment = JSON.stringify({ winner: "variant-1", evaluations: [{ variantId: "variant-1", quality: 90, reason: "Passed" }] });
  await service.saveJudgment(arena.id, judgment);
  code = 1;
  await request("run-tests", { runId });
  let result = (await service.list(project)).arenas[0];
  assert.equal(result.variants[0].tests.checks[0].code, 1);
  assert.equal(result.variants[0].scores.tests, 0);
  assert.equal(result.winner, undefined);
  assert.equal(result.variants[0].scores.quality, null);
  assert.equal(result.status, "needs-attention");
  await assert.rejects(service.saveJudgment(arena.id, judgment), /başarısız/);
  code = 0;
  await request("run-tests", { runId });
  result = (await service.list(project)).arenas[0];
  assert.equal(result.variants[0].scores.tests, 100);
  assert.equal(result.winner, undefined);
  await service.saveJudgment(arena.id, judgment);
  assert.equal((await service.list(project)).arenas[0].winner, "variant-1");
});

test("isolated replay restores the original baseline and never changes the main project", async (t) => {
  const { root, project, request, service } = await setup(t);
  const variant = path.join(root, "candidate"); await fs.mkdir(variant);
  await fs.writeFile(path.join(project, "app.txt"), "main user edit");
  await fs.writeFile(path.join(variant, "app.txt"), "original baseline");
  const runId = crypto.randomUUID();
  await service.begin(runId, { projectPath: variant, originProjectPath: project, engineId: "codex", model: "test-model", prompt: "Task", effort: "high", approvalMode: "auto_edit" });
  await fs.writeFile(path.join(variant, "app.txt"), "previous solution");
  await service.record(runId, { type: "finished", code: 0 });
  await fs.rm(variant, { recursive: true, force: true });
  const replay = await request("run-replay", { runId });
  assert.notEqual(replay.projectPath, project);
  assert.notEqual(replay.projectPath, variant);
  assert.equal(replay.displayProjectPath, project);
  assert.equal(replay.model, "test-model");
  assert.equal(replay.effort, "high");
  assert.equal(await fs.readFile(path.join(replay.projectPath, "app.txt"), "utf8"), "original baseline");
  const replayRun = crypto.randomUUID();
  const adapter = await agentStartHarness(service);
  await assert.rejects(adapter.start({ ...replay, runId: replayRun, projectPath: project, autoSnapshot: false }), /doğrulanamadı/);
  const started = await adapter.start({ ...replay, runId: replayRun, autoSnapshot: false });
  assert.equal(started.runId, replayRun);
  assert.equal(adapter.invocation().projectPath, replay.projectPath);
  await fs.writeFile(path.join(adapter.invocation().projectPath, "app.txt"), "new solution");
  assert.equal(await fs.readFile(path.join(project, "app.txt"), "utf8"), "main user edit");
  await assert.rejects(request("replay-cleanup", { replayId: replay.replayId }), /çalış|Çalış/);
  await service.record(replayRun, { type: "finished", code: 0 });
  await request("replay-cleanup", { replayId: replay.replayId });
  await assert.rejects(fs.access(replay.projectPath));
  assert.equal((await service.detail(replayRun)).projectPath, project);
});

test("normal replay retains its original project and does not create an isolated folder", async (t) => {
  const { project, request, service } = await setup(t);
  const runId = crypto.randomUUID();
  await service.begin(runId, { projectPath: project, engineId: "codex", prompt: "Normal task" });
  await service.record(runId, { type: "finished", code: 0 });
  const replay = await request("run-replay", { runId });
  assert.equal(replay.projectPath, project);
  assert.equal(replay.displayProjectPath, project);
  assert.equal(replay.replayId, undefined);
});

test("mobile selections reach the real start adapter and bind approvals before the provider starts", async (t) => {
  const { project, service } = await setup(t);
  const { MobileBridge } = require("../electron/mobile-bridge");
  const bridge = new MobileBridge({ storagePath: path.join(project, "unused.json") });
  const target = { projectId: "mobile-project", projectPath: project, projectName: "Mobile", engineId: "codex", model: "fixture-astra", approvalMode: "plan" };
  bridge.messages.push({ id: "mobile-request", sessionId: "phone", target, finished: false });
  const adapter = await agentStartHarness(service, bridge);
  const runId = crypto.randomUUID();
  await adapter.start({ runId, projectPath: project, engineId: "codex", model: target.model, approvalMode: "plan", agentId: "coder", prompt: "Inspect project", history: [], autoSnapshot: false, mobileRequestId: "mobile-request" });
  assert.equal(adapter.invocation().projectPath, project);
  assert.equal(adapter.invocation().model, "fixture-astra");
  assert.equal(adapter.invocation().approvalMode, "plan");
  assert.equal(bridge.messages[0].runId, runId);
  bridge.sessions.set("phone", { id: "phone" });
  bridge.handleAgentEvent(runId, { type: "approval-request", requestId: "native-first-event", approval: { command: "npm test" } });
  assert.equal(bridge.clientState("phone").approvals.length, 1);
  const mismatched = crypto.randomUUID();
  bridge.messages.push({ id: "bad-request", target, finished: false });
  await assert.rejects(adapter.start({ runId: mismatched, projectPath: project, engineId: "codex", model: "wrong-model", approvalMode: "plan", agentId: "coder", prompt: "Inspect", autoSnapshot: false, mobileRequestId: "bad-request" }), /eşleşmiyor/);
  assert.equal(adapter.invocation().runId, runId);
});

test("doctor and IPC reject unknown actions and cannot delete run artifacts as knowledge", async (t) => {
  const { project, request, service } = await setup(t);
  await assert.rejects(request("doctor", { engineId: "unknown" }), /tanınmıyor/);
  await assert.rejects(request("unknown"), /Desteklenmeyen/);
  const runId = crypto.randomUUID();
  await service.begin(runId, { projectPath: project, engineId: "codex", prompt: "Task" });
  await service.record(runId, { type: "finished", code: 0 });
  await assert.rejects(request("knowledge-delete", { id: runId }), /Belge bulunamadı/);
  assert.equal((await service.detail(runId)).status, "completed");
  const diagnostic = await request("doctor", { engineId: "codex" });
  assert.equal(diagnostic.checks[0].action, "install");
});

test("knowledge import extracts PDF text through the packaged PDF.js dependency", async (t) => {
  const { root, project, request, service, select } = await setup(t);
  const stream = "BT /F1 12 Tf 20 50 Td (TaxCLI PDF context) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const filename = path.join(root, "reference.pdf"); await fs.writeFile(filename, pdf);
  select({ canceled: false, filePaths: [filename] });
  const result = await request("knowledge-import");
  assert.equal(result.length, 1);
  assert.match(await service.knowledgeContext(project), /TaxCLI PDF context/);
});
