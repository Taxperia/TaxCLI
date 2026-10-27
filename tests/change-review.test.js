const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { diffHunks, captureProject, buildChanges, composeChange, applyChanges, safeFile } = require("../electron/change-review");

async function project(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-review-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const encoded = (content) => Buffer.from(content).toString("base64");

test("separate hunks preserve exact CRLF and allow selective application", () => {
  const before = "one\r\nkeep\r\nthree\r\n", after = "ONE\r\nkeep\r\nTHREE\r\n";
  const changes = buildChanges({ files: { "a.txt": encoded(before) } }, { files: { "a.txt": encoded(after) } });
  assert.equal(changes[0].hunks.length, 2);
  assert.equal(Buffer.from(composeChange(changes[0], (h) => h === "h0"), "base64").toString(), "ONE\r\nkeep\r\nthree\r\n");
  assert.equal(Buffer.from(composeChange(changes[0]), "base64").toString(), after);
});

test("diff round trips insertion, deletion, empty files and final newline changes", () => {
  for (const [before, after] of [["", "new\n"], ["old\n", ""], ["a\n", "a"], ["a", "a\n"], ["a\nb\nc\n", "a\nx\nb\nc\ny\n"]]) {
    const change = { before: encoded(before), after: encoded(after), hunks: diffHunks(before, after), decisions: {} };
    assert.equal(Buffer.from(composeChange(change) || "", "base64").toString(), after);
  }
});

test("applying a multi-file result refuses all writes on any conflict", async (t) => {
  const root = await project(t);
  await fs.writeFile(path.join(root, "a.txt"), "before"); await fs.writeFile(path.join(root, "b.txt"), "before");
  const before = await captureProject(root);
  await fs.writeFile(path.join(root, "a.txt"), "after"); await fs.writeFile(path.join(root, "b.txt"), "after");
  const changes = buildChanges(before, await captureProject(root));
  await fs.writeFile(path.join(root, "a.txt"), "before"); await fs.writeFile(path.join(root, "b.txt"), "user edit");
  await assert.rejects(applyChanges(root, changes), /Çakışma/);
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "before");
  assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "user edit");
});

test("edits made while the safety snapshot runs abort the entire apply", async (t) => {
  const root = await project(t);
  const original = { files: { "a.txt": encoded("base a"), "b.txt": encoded("base b") } };
  const updated = { files: { "a.txt": encoded("AI a"), "b.txt": encoded("AI b") } };
  await fs.writeFile(path.join(root, "a.txt"), "base a");
  await fs.writeFile(path.join(root, "b.txt"), "base b");
  await assert.rejects(applyChanges(root, buildChanges(original, updated), {
    backup: async () => { await fs.writeFile(path.join(root, "b.txt"), "user edit during snapshot"); return { id: "safety" }; }
  }), /Çakışma/);
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "base a");
  assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "user edit during snapshot");
});

test("a file created during backup is not overwritten by a proposed addition", async (t) => {
  const root = await project(t);
  const changes = buildChanges({ files: {} }, { files: { "new.txt": encoded("AI file") } });
  await assert.rejects(applyChanges(root, changes, {
    backup: async () => fs.writeFile(path.join(root, "new.txt"), "user file")
  }), /Çakışma/);
  assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "user file");
});

test("files can be added and removed without touching unrelated data", async (t) => {
  const root = await project(t);
  await fs.writeFile(path.join(root, "remove.txt"), "old");
  const before = await captureProject(root);
  await fs.rm(path.join(root, "remove.txt")); await fs.writeFile(path.join(root, "new.txt"), "new");
  const changes = buildChanges(before, await captureProject(root));
  await fs.rm(path.join(root, "new.txt")); await fs.writeFile(path.join(root, "remove.txt"), "old");
  await fs.writeFile(path.join(root, "user.txt"), "keep");
  let backedUp = false;
  await applyChanges(root, changes, { backup: async () => { backedUp = true; return { id: "safety" }; } });
  assert.equal(backedUp, true);
  assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "new");
  assert.equal(await fs.readFile(path.join(root, "user.txt"), "utf8"), "keep");
  await assert.rejects(fs.access(path.join(root, "remove.txt")));
});

test("unsafe, sensitive and excluded paths are rejected", async (t) => {
  const root = await project(t);
  for (const name of ["../escape", "src/../../escape", "C:/escape", "src/x:stream", ".env", ".ssh/key", "node_modules/a.js", "a\\b", "NUL.txt", "a./b", "src//b"]) await assert.rejects(safeFile(root, name), /yol|Korunan|Geçersiz/i);
});

test("binary changes retain bytes and are applied as full files", async (t) => {
  const root = await project(t), before = { files: {} }, after = { files: { "asset.bin": Buffer.from([0, 255, 10, 128]).toString("base64") } };
  const changes = buildChanges(before, after);
  assert.equal(changes[0].binary, true);
  await applyChanges(root, changes);
  assert.deepEqual([...await fs.readFile(path.join(root, "asset.bin"))], [0, 255, 10, 128]);
});
