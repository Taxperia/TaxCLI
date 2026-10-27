const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { TaskQueueStore } = require("../electron/task-queue");

test("task queue persists, pauses, retries and recovers interrupted tasks", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-queue-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const filePath = path.join(temporary, "queue.json");
  const queue = new TaskQueueStore({ filePath });
  const projectPath = path.resolve(temporary, "project");

  const added = await queue.enqueue({ prompt: "Testleri çalıştır", projectPath, projectName: "Demo", engineId: "codex" });
  assert.equal(added.task.status, "pending");
  await queue.update(added.task.id, { status: "running", runId: "run-1" });
  assert.equal((await queue.list()).tasks[0].status, "running");

  const restarted = new TaskQueueStore({ filePath });
  const recovered = await restarted.list();
  assert.equal(recovered.tasks[0].status, "pending");
  assert.equal(recovered.tasks[0].runId, "");

  assert.equal((await restarted.setPaused(true)).paused, true);
  await restarted.update(added.task.id, { status: "failed", error: "boom" });
  assert.equal((await restarted.retry(added.task.id)).task.status, "pending");
  await restarted.update(added.task.id, { status: "completed", completedAt: new Date().toISOString() });
  assert.equal((await restarted.clearCompleted()).tasks.length, 0);
});

test("task queue rejects relative project paths", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-queue-invalid-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const queue = new TaskQueueStore({ filePath: path.join(temporary, "queue.json") });
  await assert.rejects(queue.enqueue({ prompt: "x", projectPath: "relative/project" }), /geçerli proje/i);
});
