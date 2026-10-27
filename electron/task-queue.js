const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const VALID_STATUSES = new Set(["pending", "running", "completed", "failed", "cancelled"]);

function sanitizeTask(task = {}, { recoverRunning = false } = {}) {
  const status = VALID_STATUSES.has(task.status) ? task.status : "pending";
  return {
    id: /^[a-f0-9-]{20,64}$/i.test(String(task.id || "")) ? String(task.id) : crypto.randomUUID(),
    prompt: String(task.prompt || "").trim().slice(0, 20000),
    projectPath: String(task.projectPath || ""),
    projectName: String(task.projectName || "").slice(0, 120),
    engineId: String(task.engineId || "codex").slice(0, 40),
    model: String(task.model || "").slice(0, 120),
    agentId: String(task.agentId || "auto").slice(0, 80),
    status: recoverRunning && status === "running" ? "pending" : status,
    error: String(task.error || "").slice(0, 1000),
    runId: "",
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
    completedAt: task.completedAt || ""
  };
}

class TaskQueueStore {
  constructor({ filePath, onAudit = null }) {
    this.filePath = filePath;
    this.onAudit = onAudit;
    this.queue = Promise.resolve();
    this.recoveredInterruptedTasks = false;
  }

  async read() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      const recoverRunning = !this.recoveredInterruptedTasks;
      this.recoveredInterruptedTasks = true;
      const state = {
        paused: Boolean(parsed.paused),
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((task) => sanitizeTask(task, { recoverRunning })).filter((task) => task.prompt && task.projectPath).slice(-100) : []
      };
      if (recoverRunning && Array.isArray(parsed.tasks) && parsed.tasks.some((task) => task.status === "running")) await this.write(state);
      return state;
    } catch {
      this.recoveredInterruptedTasks = true;
      return { paused: false, tasks: [] };
    }
  }

  async write(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporary, this.filePath);
    return state;
  }

  mutate(operation) {
    const next = this.queue.catch(() => {}).then(async () => operation(await this.read()));
    this.queue = next.catch(() => {});
    return next;
  }

  list() {
    return this.mutate(async (state) => state);
  }

  enqueue(payload) {
    return this.mutate(async (state) => {
      const task = sanitizeTask({ ...payload, status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      if (!task.prompt) throw new Error("Kuyruk görevi boş olamaz.");
      if (!task.projectPath || !path.isAbsolute(task.projectPath)) throw new Error("Kuyruk için geçerli proje seçin.");
      state.tasks.push(task);
      state.tasks = state.tasks.slice(-100);
      await this.write(state);
      await this.onAudit?.("queue.enqueue", { taskId: task.id, projectPath: task.projectPath, engineId: task.engineId });
      return { state, task };
    });
  }

  setPaused(paused) {
    return this.mutate(async (state) => {
      state.paused = Boolean(paused);
      await this.write(state);
      await this.onAudit?.("queue.pause", { paused: state.paused });
      return state;
    });
  }

  update(taskId, patch = {}) {
    return this.mutate(async (state) => {
      const task = state.tasks.find((item) => item.id === String(taskId || ""));
      if (!task) throw new Error("Kuyruk görevi bulunamadı.");
      if (patch.status && VALID_STATUSES.has(patch.status)) task.status = patch.status;
      if (patch.error != null) task.error = String(patch.error).slice(0, 1000);
      if (patch.runId != null) task.runId = String(patch.runId).slice(0, 80);
      if (patch.completedAt != null) task.completedAt = String(patch.completedAt);
      task.updatedAt = new Date().toISOString();
      await this.write(state);
      await this.onAudit?.("queue.update", { taskId: task.id, status: task.status });
      return { state, task };
    });
  }

  retry(taskId) {
    return this.update(taskId, { status: "pending", error: "", runId: "", completedAt: "" });
  }

  remove(taskId) {
    return this.mutate(async (state) => {
      const task = state.tasks.find((item) => item.id === String(taskId || ""));
      if (!task) return state;
      if (task.status === "running") throw new Error("Çalışan görev önce durdurulmalıdır.");
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      await this.write(state);
      await this.onAudit?.("queue.remove", { taskId: task.id });
      return state;
    });
  }

  clearCompleted() {
    return this.mutate(async (state) => {
      state.tasks = state.tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
      await this.write(state);
      return state;
    });
  }
}

module.exports = { TaskQueueStore, sanitizeTask, VALID_STATUSES };
