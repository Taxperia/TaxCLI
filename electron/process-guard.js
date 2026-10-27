const { spawn } = require("node:child_process");

function parseTasklistMemory(output) {
  const row = String(output || "").split(/\r?\n/).find((line) => line.trim() && !/^INFO:/i.test(line));
  if (!row) return 0;
  const fields = [...row.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  const memory = fields.at(-1) || "";
  const kilobytes = Number(memory.replace(/[^0-9]/g, ""));
  return Number.isFinite(kilobytes) ? kilobytes * 1024 : 0;
}

function windowsProcessMemory(pid) {
  return new Promise((resolve) => {
    const child = spawn("tasklist.exe", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => resolve(0));
    child.on("close", () => resolve(parseTasklistMemory(output)));
  });
}

function guardProcess(child, { memoryLimitBytes = 2 * 1024 * 1024 * 1024, intervalMs = 5000, onLimit = null } = {}) {
  if (!child?.pid || process.platform !== "win32") return () => {};
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || child.exitCode != null || child.killed) return;
    checking = true;
    try {
      const bytes = await windowsProcessMemory(child.pid);
      if (bytes > memoryLimitBytes) onLimit?.({ type: "memory", bytes, limit: memoryLimitBytes });
    } finally {
      checking = false;
    }
  }, Math.max(1000, intervalMs));
  timer.unref?.();
  const stop = () => clearInterval(timer);
  child.once("close", stop);
  child.once("error", stop);
  return stop;
}

module.exports = { guardProcess, parseTasklistMemory, windowsProcessMemory };
