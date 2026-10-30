const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Workbench, parseSession, scoreArena, eventFacts } = require("../electron/workbench");
const { SnapshotManager } = require("../electron/workspace-services");
const { agentStartHarness } = require("./helpers/agent-start-harness");

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-workbench-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project"); await fs.mkdir(project);
  const wb = new Workbench({ storageRoot: path.join(root, "records"), snapshotManager: new SnapshotManager({ storageRoot: path.join(root, "snapshots") }), protect: async (value) => Buffer.from(value).toString("base64"), unprotect: async (value) => Buffer.from(value, "base64").toString(), runner: async () => ({ code: 0, output: "ok", durationMs: 5 }) });
  return { root, project, wb };
}
async function run(wb, project, edit, extra = {}) {
  const runId = crypto.randomUUID();
  await wb.begin(runId, { projectPath: project, engineId: "codex", prompt: "A meaningful task", model: "test-model", ...extra });
  if (edit) await edit();
  await wb.record(runId, { type: "output", event: { data: { type: "item.completed", item: { type: "agent_message", text: "Done" } } } });
  await wb.record(runId, { type: "finished", code: 0, usage: { input_tokens: 10, output_tokens: 20 } });
  return runId;
}

test("run recorder persists exact diffs, usage and command timeline", async (t) => {
  const { project, wb } = await setup(t);
  await fs.writeFile(path.join(project, "a.txt"), "before");
  const runId = crypto.randomUUID();
  await wb.begin(runId, { projectPath: project, engineId: "claude", prompt: "Fix", model: "sonnet", effort: "high" });
  await wb.record(runId, { type: "output", event: { data: { type: "tool_use", name: "Bash", input: { command: "npm test" } } } });
  await wb.record(runId, { type: "output", event: { data: { type: "result", result: "Fixed", total_cost_usd: 0.2, usage: { input_tokens: 30, output_tokens: 7 } } } });
  await fs.writeFile(path.join(project, "a.txt"), "after");
  await wb.record(runId, { type: "finished", code: 0 });
  const detail = await wb.detail(runId);
  assert.equal(detail.changes[0].path, "a.txt"); assert.equal(detail.response, "Fixed");
  assert.equal(detail.tokens.total, 37); assert.equal(detail.billing.amount, .2);
  assert.ok(detail.timeline.some((event) => event.kind === "command" && event.detail === "npm test"));
  assert.equal((await wb.list(project)).runs[0].effort, "high");
});

test("normal review can reject one hunk and preserve another", async (t) => {
  const { project, wb } = await setup(t);
  await fs.writeFile(path.join(project, "a.txt"), "old\nkeep\nlast\n");
  const runId = await run(wb, project, () => fs.writeFile(path.join(project, "a.txt"), "NEW\nkeep\nLAST\n"));
  await wb.review({ runId, action: "reject", selection: [{ path: "a.txt", hunkIds: ["h0"] }] });
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "old\nkeep\nLAST\n");
  await wb.review({ runId, action: "reject", selection: [{ path: "a.txt", hunkIds: ["h1"] }] });
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "old\nkeep\nlast\n");
});

test("isolated result supports applying hunks in separate operations", async (t) => {
  const { root, project, wb } = await setup(t);
  const variant = path.join(root, "variant"); await fs.mkdir(variant);
  const before = "old\nkeep\nlast\n";
  await fs.writeFile(path.join(project, "a.txt"), before); await fs.writeFile(path.join(variant, "a.txt"), before);
  const runId = await run(wb, variant, () => fs.writeFile(path.join(variant, "a.txt"), "NEW\nkeep\nLAST\n"), { originProjectPath: project });
  await wb.review({ runId, action: "apply", selection: [{ path: "a.txt", hunkIds: ["h0"] }] });
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "NEW\nkeep\nlast\n");
  await wb.review({ runId, action: "apply", selection: [{ path: "a.txt", hunkIds: ["h1"] }] });
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "NEW\nkeep\nLAST\n");
});

test("invalid hunk selection never writes project files", async (t) => {
  const { project, wb } = await setup(t);
  await fs.writeFile(path.join(project, "a.txt"), "old");
  const runId = await run(wb, project, () => fs.writeFile(path.join(project, "a.txt"), "new"));
  await assert.rejects(wb.review({ runId, action: "reject", selection: [{ path: "a.txt", hunkIds: ["nonexistent"] }] }), /geçersiz/);
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "new");
});

test("session importer parses native Codex, Claude, Gemini and terminal exports", () => {
  const codex = [{ type: "session_meta", payload: {} }, { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] } }, { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] } }].map(JSON.stringify).join("\n");
  assert.deepEqual(parseSession(codex, "session.jsonl").map((m) => m.content), ["Hi", "Hello"]);
  assert.equal(parseSession(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Claude" }] } }), "session.jsonl")[0].content, "Claude");
  assert.equal(parseSession(JSON.stringify({ messages: [{ type: "gemini", role: "model", content: "Gemini" }] }), "session.json")[0].role, "assistant");
  assert.equal(parseSession("User: hello\nAssistant: hi", "export.txt").length, 2);
  assert.throws(() => parseSession('{"api_key":"never import credentials"}', "auth.json"), /konuşma/);
});

test("knowledge context respects project scope, toggles and context budget", async (t) => {
  const { project, wb } = await setup(t);
  const local = await wb.addKnowledge(project, "rules.md", "Local rules");
  await wb.addKnowledge("another-project", "private.md", "Not visible");
  await wb.addKnowledge("", "shared.md", "Shared text");
  assert.match(await wb.knowledgeContext(project), /Local rules/);
  assert.doesNotMatch(await wb.knowledgeContext(project), /Not visible/);
  await wb.updateKnowledge(local.id, false);
  assert.doesNotMatch(await wb.knowledgeContext(project), /Local rules/);
  assert.match(await wb.knowledgeContext(project, [local.id]), /Local rules/);
  await wb.addKnowledge(project, "long.md", "x".repeat(40000));
  assert.ok((await wb.knowledgeContext(project)).length < 24500);
});

test("arena scores leave unavailable cost and tests unknown", () => {
  const result = scoreArena([{ status: "completed", durationMs: 1000 }, { status: "completed", durationMs: 2000, tests: { checks: [{ id: "test", code: 1 }] }, quality: 50 }]);
  assert.equal(result[0].scores.cost, null); assert.equal(result[0].scores.tests, null); assert.equal(result[0].scores.provisional, true);
  assert.equal(result[1].scores.tests, 0); assert.equal(result[1].scores.speed, 50);
  const priced = scoreArena([{ status: "completed", durationMs: 10, billing: { amount: 1, unit: "USD" } }, { status: "completed", durationMs: 10, billing: { amount: 2, unit: "USD" } }]);
  assert.equal(priced[0].scores.cost, 100); assert.equal(priced[1].scores.cost, 50);
});

test("judge rejects invalid scores and candidates with failing tests", async (t) => {
  const { project, wb } = await setup(t);
  const arena = await wb.createArena(project, "Task", [{ variantId: "variant-1", engineId: "codex" }, { variantId: "variant-2", engineId: "claude" }], { engineId: "codex" });
  await wb.mutate((state) => { state.arenas[0].variants.forEach((v) => { v.status = "completed"; v.durationMs = 10; }); state.arenas[0].variants[0].tests = { checks: [{ id: "test", code: 1 }] }; });
  const evaluations = [{ variantId: "variant-1", quality: 70 }, { variantId: "variant-2", quality: 80 }];
  await assert.rejects(wb.saveJudgment(arena.id, JSON.stringify({ winner: "variant-1", evaluations })), /başarısız/);
  const result = await wb.saveJudgment(arena.id, JSON.stringify({ winner: "variant-2", evaluations }));
  assert.equal(result.winner, "variant-2"); assert.equal(result.status, "judged");
});

test("large judge evidence keeps every candidate and valid JSON within the prompt budget", async (t) => {
  const { project, wb } = await setup(t);
  const variants = Array.from({ length: 11 }, (_, i) => ({ variantId: `variant-${i + 1}`, engineId: "codex" }));
  const arena = await wb.createArena(project, "Task ".repeat(20000), variants, { engineId: "codex" });
  const completed = ["variant-1", "variant-2", "variant-8"];
  await wb.mutate((state) => {
    for (const variant of state.arenas[0].variants) {
      variant.status = completed.includes(variant.variantId) ? "completed" : "cancelled";
      variant.runId = variant.variantId;
      variant.tests = { checks: [{ id: "test", code: 0, output: "Passed" }] };
    }
  });
  wb.detail = async () => ({ response: "Done", changes: [{ path: "large.js", kind: "modified", hunks: [{ oldLines: ['"\\\n'.repeat(100000)], newLines: ["replacement".repeat(30000)] }] }] });
  const prompt = await wb.judgePrompt(arena.id);
  const reportsText = prompt.split("\nÇÖZÜMLER:\n")[1];
  const reports = JSON.parse(reportsText);
  assert.ok(reportsText.length <= 70000);
  assert.ok(prompt.length < 100000);
  assert.deepEqual(reports.map((report) => report.variantId), variants.map((variant) => variant.variantId));
  assert.deepEqual(JSON.parse(prompt.split("PUANLANACAK ÇÖZÜMLER:\n")[1].split("\nGÖREV:")[0]), completed);
  for (const report of reports.filter((candidate) => candidate.status === "completed")) {
    assert.equal(report.truncated, true);
    assert.equal(report.tests[0].code, 0);
    assert.ok(report.changes[0].hunks[0].added.length > 0);
  }
  await assert.rejects(wb.saveJudgment(arena.id, JSON.stringify({ winner: "variant-1", evaluations: [{ variantId: "variant-1", quality: 66 }] })), /Çözüm 2, Çözüm 8/);
  const judged = await wb.saveJudgment(arena.id, JSON.stringify({ winner: "variant-8", evaluations: completed.map((variantId, i) => ({ variantId, quality: 60 + i })) }));
  assert.equal(judged.winner, "variant-8");
});

test("a judge prompt preserves small code and test evidence without clipping", async (t) => {
  const { project, wb } = await setup(t);
  const arena = await wb.createArena(project, "Task", [{ variantId: "variant-2" }], { engineId: "codex" });
  await wb.mutate((state) => Object.assign(state.arenas[0].variants[0], { status: "completed", runId: "run", tests: { checks: [{ id: "test", code: 0, output: "All passed" }] } }));
  wb.detail = async () => ({ response: "Implemented", changes: [{ path: "small.js", kind: "modified", hunks: [{ oldLines: ["before\n"], newLines: ["after\n"] }] }] });
  const report = JSON.parse((await wb.judgePrompt(arena.id)).split("\nÇÖZÜMLER:\n")[1])[0];
  assert.equal(report.response, "Implemented");
  assert.equal(report.tests[0].output, "All passed");
  assert.equal(report.changes[0].hunks[0].added, "after\n");
  assert.equal(report.truncated, undefined);
});

test("the maximum comparison size keeps all completed candidates in the judge prompt", async (t) => {
  const { project, wb } = await setup(t);
  const variants = Array.from({ length: 64 }, (_, i) => ({ variantId: `variant-${i + 1}` }));
  const arena = await wb.createArena(project, "Task", variants, { engineId: "codex" });
  await wb.mutate((state) => state.arenas[0].variants.forEach((variant) => Object.assign(variant, { status: "completed", runId: variant.variantId })));
  wb.detail = async () => ({ response: "Completed", changes: Array.from({ length: 25 }, (_, i) => ({ path: `file-${i}.js`, kind: "modified", hunks: [{ oldLines: ["before".repeat(1000)], newLines: ["after".repeat(1000)] }] })) });
  const reportsText = (await wb.judgePrompt(arena.id)).split("\nÇÖZÜMLER:\n")[1];
  assert.equal(JSON.parse(reportsText).length, 64);
  assert.ok(reportsText.length <= 70000);
});

test("health reports missing tests honestly and discovers TODO markers", async (t) => {
  const { project, wb } = await setup(t);
  await fs.writeFile(path.join(project, "app.js"), "// TODO: improve\nconsole.log('hi');");
  const report = await wb.runChecks(project);
  assert.equal(report.noTests, true); assert.equal(report.missingDocs, true); assert.equal(report.todos.length, 1); assert.equal(report.checks.length, 0);
});

test("recipe persistence and encrypted branch baseline survive a new service read", async (t) => {
  const { project, wb } = await setup(t);
  const recipe = await wb.saveRecipe({ name: "Custom", steps: ["Analyze", "Implement"] });
  assert.match(await wb.recipePrompt(recipe.id, "Task"), /1\. Analyze/);
  await fs.writeFile(path.join(project, "app.js"), "original");
  const branch = await wb.saveBranch(project, { title: "Alternative", parentId: "main", forkAt: 2 });
  await fs.writeFile(path.join(project, "app.js"), "later");
  const baseline = await wb.unseal(`branch-${branch.id}`);
  assert.equal(Buffer.from(baseline.files["app.js"], "base64").toString(), "original");
  assert.equal((await wb.list(project)).branches[0].title, "Alternative");
});

test("command and file read event extraction redacts secrets", () => {
  const facts = eventFacts({ type: "output", event: { data: { type: "tool_use", name: "Read", input: { file_path: "src/app.js" } } } });
  assert.ok(facts.some((fact) => fact.detail.includes("src/app.js")));
  const command = eventFacts({ type: "output", event: { data: { command: "echo api_key=supersecretvalue" } } });
  assert.doesNotMatch(JSON.stringify(command), /supersecretvalue/);
});

async function addLargeAssets(project) {
  for (let index = 0; index < 3; index++) {
    const handle = await fs.open(path.join(project, `asset-${index}.bin`), "w");
    try { await handle.truncate(23 * 1024 * 1024); } finally { await handle.close(); }
  }
}

test("large projects can run with snapshots disabled and retain a truthful metadata-only record", async (t) => {
  const { project, wb } = await setup(t);
  await addLargeAssets(project);
  await fs.writeFile(path.join(project, "app.txt"), "user file");
  const runId = crypto.randomUUID();
  const adapter = await agentStartHarness(wb);
  const started = await adapter.start({ runId, projectPath: project, engineId: "codex", prompt: "Large project task", autoSnapshot: false });
  assert.match(started.reviewWarning, /boyut sınırını/);
  assert.equal(adapter.invocation().projectPath, project);
  await fs.writeFile(path.join(project, "app.txt"), "AI edit");
  await wb.record(runId, { type: "output", event: { data: { type: "item.completed", item: { type: "agent_message", text: "Task complete" } } } });
  await wb.record(runId, { type: "finished", code: 0 });
  const detail = await wb.detail(runId);
  assert.equal(detail.status, "completed");
  assert.equal(detail.response, "Task complete");
  assert.equal(detail.config.autoSnapshot, false);
  assert.deepEqual(detail.changes, []);
  assert.match(detail.reviewWarning, /geri alma kaydı oluşturulmaz/);
  assert.ok(detail.timeline.length > 0);
  await assert.rejects(wb.review({ runId, action: "reject", selection: [{ path: "app.txt" }] }), /boyut sınırını/);
  assert.equal(await fs.readFile(path.join(project, "app.txt"), "utf8"), "AI edit");
});

test("growing past the capture limit does not turn a successful run into a failure or false deletions", async (t) => {
  const { project, wb } = await setup(t);
  await fs.writeFile(path.join(project, "app.txt"), "base");
  const runId = crypto.randomUUID();
  await wb.begin(runId, { projectPath: project, engineId: "codex", prompt: "Produce assets" });
  await addLargeAssets(project);
  await wb.record(runId, { type: "finished", code: 0 });
  const detail = await wb.detail(runId);
  assert.equal(detail.status, "completed");
  assert.deepEqual(detail.changes, []);
  assert.ok(detail.reviewWarning);
  assert.equal(Buffer.from(detail.before.files["app.txt"], "base64").toString(), "base");
});
