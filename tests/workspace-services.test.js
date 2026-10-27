const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SnapshotManager, findSensitivePaths, parseGitStatus, normalizeRelativePath } = require("../electron/workspace-services");

test("snapshot restores project files while preserving sensitive files", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-snapshot-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "project");
  const storage = path.join(temporary, "snapshots");
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.mkdir(path.join(project, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(project, "src", "app.js"), "before\n");
  await fs.writeFile(path.join(project, ".env"), "TOKEN=keep-me\n");
  await fs.writeFile(path.join(project, "node_modules", "pkg", "index.js"), "ignored\n");

  const manager = new SnapshotManager({ storageRoot: storage });
  const snapshot = await manager.create(project, { label: "Test" });
  assert.equal(snapshot.fileCount, 1);
  assert.equal(snapshot.skipped.some((item) => item.path === ".env" && item.reason === "sensitive"), true);

  await fs.writeFile(path.join(project, "src", "app.js"), "after\n");
  await fs.writeFile(path.join(project, "new.txt"), "remove me\n");
  await fs.writeFile(path.join(project, ".env"), "TOKEN=still-here\n");
  const result = await manager.restore(project, snapshot.id);

  assert.equal(await fs.readFile(path.join(project, "src", "app.js"), "utf8"), "before\n");
  assert.equal(await fs.readFile(path.join(project, ".env"), "utf8"), "TOKEN=still-here\n");
  await assert.rejects(fs.access(path.join(project, "new.txt")));
  assert.equal(result.removedCount, 1);
  assert.ok(result.safetySnapshotId);
  assert.equal((await manager.list(project)).length, 2);
});

test("git status parser exposes branch and staged state", () => {
  const parsed = parseGitStatus("## feature/demo...origin/feature/demo\nM  src/a.js\n?? new file.txt\n M src/b.js\n");
  assert.equal(parsed.branch, "feature/demo");
  assert.deepEqual(parsed.files.map((file) => [file.path, file.staged, file.untracked]), [
    ["src/a.js", true, false],
    ["new file.txt", false, true],
    ["src/b.js", false, false]
  ]);
  assert.throws(() => normalizeRelativePath("../outside.txt"));
});

test("sensitive file scan finds secrets without traversing dependency folders", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-sensitive-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporary, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(temporary, "config"), { recursive: true });
  await fs.mkdir(path.join(temporary, ".ssh"), { recursive: true });
  await fs.writeFile(path.join(temporary, ".env.local"), "TOKEN=secret\n");
  await fs.writeFile(path.join(temporary, "config", "service.pem"), "secret\n");
  await fs.writeFile(path.join(temporary, "node_modules", "pkg", "credentials.json"), "ignored\n");
  assert.deepEqual((await findSensitivePaths(temporary)).sort(), [".env.local", ".ssh", "config/service.pem"]);
});
