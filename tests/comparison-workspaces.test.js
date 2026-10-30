const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { ComparisonWorkspaces } = require("../electron/comparison-workspaces");
const { Workbench } = require("../electron/workbench");
const { SnapshotManager } = require("../electron/workspace-services");

async function fixture(t, io = fs) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-comparison-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "project");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "index.txt"), "original");
  const sealed = new Map(), batches = new Map(), trusted = [];
  const manager = new ComparisonWorkspaces({ batches, io, trustWorkspace: async (p) => trusted.push(p), store: () => ({
    seal: async (id, data) => sealed.set(id, data), unseal: async (id) => sealed.get(id), file: (id) => path.join(root, `${id}.sealed`)
  }) });
  manager.deferRemoval = (_batch, target) => { manager.deferred = target; };
  const variants = [{ variantId: "variant-1", engineId: "codex", model: "test" }, { variantId: "variant-2", engineId: "claude", model: "test" }];
  return { root, source, manager, variants, batches, sealed, trusted };
}

test("comparison copies live under selected project, keep immutable input and exclude internal copies", async (t) => {
  const f = await fixture(t);
  const prepared = await f.manager.prepare(f.source, f.variants);
  assert.equal(path.dirname(prepared.root), path.join(f.source, ".taxcli", "comparisons"));
  const baseline = f.sealed.get(`batch-${prepared.batchId}`);
  assert.deepEqual(Object.keys(baseline.files), ["index.txt"]);
  await fs.writeFile(path.join(f.source, "index.txt"), "main changed later");
  for (const v of prepared.variants) {
    await f.manager.materialize({ batchId: prepared.batchId, variantId: v.variantId });
    assert.equal(await fs.readFile(path.join(v.projectPath, "index.txt"), "utf8"), "original");
    await fs.writeFile(path.join(v.projectPath, "index.txt"), "candidate change");
    await f.manager.cleanup({ batchId: prepared.batchId, variantId: v.variantId });
  }
  assert.equal(await fs.readFile(path.join(f.source, "index.txt"), "utf8"), "main changed later");
  assert.equal(f.batches.size, 0);
  assert.equal(f.trusted.length, 2);
});

test("locked Electron files defer cleanup without blocking subsequent model", async (t) => {
  let locked = "";
  const io = { ...fs, rm: async (target, options) => {
    if (target === locked) { assert.equal(options.maxRetries, 3); throw Object.assign(new Error("locked"), { code: "EBUSY" }); }
    return fs.rm(target, options);
  } };
  const f = await fixture(t, io), prepared = await f.manager.prepare(f.source, f.variants);
  const [first, second] = prepared.variants;
  await f.manager.materialize({ batchId: prepared.batchId, variantId: first.variantId });
  locked = first.projectPath;
  const cleanup = await f.manager.cleanup({ batchId: prepared.batchId, variantId: first.variantId });
  assert.equal(cleanup.cleaned, false); assert.match(cleanup.warning, /ertelendi/);
  assert.equal(f.manager.deferred, locked);
  await f.manager.materialize({ batchId: prepared.batchId, variantId: second.variantId });
  assert.deepEqual(await f.manager.cleanup({ batchId: prepared.batchId, variantId: first.variantId }), { cleaned: true });
  assert.equal(f.batches.get(prepared.batchId).activeVariantId, second.variantId);
  await f.manager.cleanup({ batchId: prepared.batchId, variantId: second.variantId });
  assert.equal(f.batches.size, 0);
  assert.equal((await fs.stat(locked)).isDirectory(), true);
  assert.deepEqual(await f.manager.cleanup({ batchId: prepared.batchId, variantId: second.variantId }), { cleaned: true });
});

test("active candidates cannot be replaced or cleaned via another candidate", async (t) => {
  const f = await fixture(t), prepared = await f.manager.prepare(f.source, f.variants);
  await f.manager.materialize({ batchId: prepared.batchId, variantId: "variant-1" });
  await assert.rejects(f.manager.materialize({ batchId: prepared.batchId, variantId: "variant-2" }), /hâlâ çalışıyor/);
  await assert.rejects(f.manager.cleanup({ batchId: prepared.batchId, variantId: "variant-2" }), /Çalışan model/);
  assert.equal(await fs.readFile(path.join(prepared.variants[0].projectPath, "index.txt"), "utf8"), "original");
});

test("partial materialization failure can be cleaned and next candidate can start", async (t) => {
  const f = await fixture(t), prepared = await f.manager.prepare(f.source, f.variants);
  const baseline = f.sealed.get(`batch-${prepared.batchId}`);
  baseline.files["../escape.txt"] = Buffer.from("escape").toString("base64");
  await assert.rejects(f.manager.materialize({ batchId: prepared.batchId, variantId: "variant-1" }));
  delete baseline.files["../escape.txt"];
  await f.manager.cleanup({ batchId: prepared.batchId, variantId: "variant-1" });
  await f.manager.materialize({ batchId: prepared.batchId, variantId: "variant-2" });
  await assert.rejects(fs.stat(path.join(prepared.root, "escape.txt")), { code: "ENOENT" });
});

test("comparison refuses a junction in project metadata", async (t) => {
  const f = await fixture(t), outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.source, ".taxcli"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(f.manager.prepare(f.source, f.variants), /bağlantı/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("cleanup rechecks junctions and never recursively deletes outside selected project", async (t) => {
  const f = await fixture(t), prepared = await f.manager.prepare(f.source, f.variants);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, "keep.txt"), "keep");
  await fs.symlink(outside, prepared.variants[0].projectPath, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(f.manager.cleanup({ batchId: prepared.batchId, variantId: "variant-1" }), /bağlantı/);
  assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "keep");
});

test("concurrent materializations are serialized and only one candidate becomes active", async (t) => {
  const f = await fixture(t), prepared = await f.manager.prepare(f.source, f.variants);
  const results = await Promise.allSettled(prepared.variants.map((v) => f.manager.materialize({ batchId: prepared.batchId, variantId: v.variantId })));
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected"]);
  assert.equal(f.batches.get(prepared.batchId).activeVariantId, "variant-1");
});

test("recorded comparison survives copy cleanup and applies only to its selected original project", async (t) => {
  const f = await fixture(t);
  const wb = new Workbench({ storageRoot: path.join(f.root, "records"), snapshotManager: new SnapshotManager({ storageRoot: path.join(f.root, "snapshots") }), protect: async (value) => Buffer.from(value).toString("base64"), unprotect: async (value) => Buffer.from(value, "base64").toString() });
  f.manager.store = () => wb;
  const prepared = await f.manager.prepare(f.source, f.variants);
  const arena = await wb.createArena(f.source, "Update original project", f.variants, { engineId: "codex" });
  const v = prepared.variants[0], runId = "comparison-test-run";
  await f.manager.materialize({ batchId: prepared.batchId, variantId: v.variantId });
  await wb.begin(runId, { projectPath: v.projectPath, originProjectPath: f.source, arenaId: arena.id, variantId: v.variantId, engineId: v.engineId, prompt: "Update index" });
  assert.equal((await wb.list(f.source)).arenas[0].variants[0].status, "running");
  await fs.writeFile(path.join(v.projectPath, "index.txt"), "reviewed solution");
  await wb.record(runId, { type: "finished", code: 0 });
  await wb.arenaResult(arena.id, v.variantId, runId, null);
  await f.manager.cleanup({ batchId: prepared.batchId, variantId: v.variantId });
  await assert.rejects(fs.stat(v.projectPath), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(f.source, "index.txt"), "utf8"), "original");
  const detail = await wb.detail(runId);
  assert.equal(detail.projectPath, f.source); assert.equal(detail.changedFiles, 1);
  await wb.review({ runId, action: "apply", selection: [{ path: "index.txt" }] });
  assert.equal(await fs.readFile(path.join(f.source, "index.txt"), "utf8"), "reviewed solution");
  assert.equal((await wb.snapshots.list(f.source)).length, 1);
});
