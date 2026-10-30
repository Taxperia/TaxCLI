const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const APP_VERSION = require("../package.json").version;

const RPC_TIMEOUT_MS = 20000;

async function requestCodexModels(request) {
  const models = new Map();
  const cursors = new Set();
  let cursor;
  do {
    const page = await request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page?.data)) throw new Error("Codex geçerli bir model listesi döndürmedi.");
    for (const entry of page.data) {
      const id = String(entry?.model || entry?.id || "").trim();
      if (!id || entry.hidden || models.has(id)) continue;
      models.set(id, { ...entry, id, label: String(entry.displayName || id) });
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Codex model listesi sayfalanamadı.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...models.values()];
}

function codexPermissionConfig(approvalMode) {
  if (approvalMode === "plan") {
    return { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" };
  }
  if (approvalMode === "auto_edit") {
    return { approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandbox: "workspace-write" };
  }
  return { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only" };
}

function normalizeThreadItem(item = {}) {
  if (item.type === "commandExecution") {
    return {
      ...item,
      type: "command_execution",
      aggregated_output: item.aggregatedOutput,
      exit_code: item.exitCode
    };
  }
  if (item.type === "fileChange") return { ...item, type: "file_change" };
  if (item.type === "agentMessage") return { ...item, type: "agent_message" };
  return item;
}

function appServerNotificationToEvent(message) {
  const method = String(message?.method || "");
  const params = message?.params || {};
  if (method === "item/agentMessage/delta") {
    return { type: "item.agentMessage.delta", delta: params.delta || "" };
  }
  if (method === "item/reasoning/summaryTextDelta") {
    return { type: "reasoning.delta", delta: params.delta || "" };
  }
  if (method === "item/plan/delta") {
    return { type: "message", role: "assistant", content: params.delta || "", delta: true };
  }
  if (method === "item/started") {
    return { type: "item.started", item: normalizeThreadItem(params.item) };
  }
  if (method === "item/completed") {
    return { type: "item.completed", item: normalizeThreadItem(params.item) };
  }
  if (method === "item/commandExecution/outputDelta") {
    return { type: "command.output.delta", output: params.delta || "" };
  }
  if (method === "turn/diff/updated") {
    return {
      type: "file_change",
      item: { type: "file_change", path: "Çalışma alanı", diff: params.diff || "", status: "editing" }
    };
  }
  return null;
}

async function startCodexAppServerRun(options) {
  const {
    invocation,
    runId,
    projectPath,
    prompt,
    model,
    effort,
    approvalMode,
    images = [],
    env,
    providerArgs = [],
    debugStream = false,
    emit,
    register
  } = options;
  const permissions = codexPermissionConfig(approvalMode);
  const child = spawn(invocation.command, [...invocation.prefix, "app-server", "--stdio", ...providerArgs], {
    cwd: projectPath,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env
  });

  let nextRpcId = 1;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finished = false;
  const pendingRpc = new Map();
  const pendingApprovals = new Map();
  const items = new Map();

  const send = (message) => {
    if (child.stdin.destroyed) throw new Error("Codex onay kanalı kapandı.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (method, params, timeoutMs = RPC_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = nextRpcId++;
    const timer = setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`Codex app-server yanıt vermedi: ${method}`));
    }, timeoutMs);
    pendingRpc.set(id, { resolve, reject, timer, method });
    send({ method, id, params });
  });

  const finish = (code, signal = null, details = {}) => {
    if (finished) return;
    finished = true;
    for (const pending of pendingRpc.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex app-server kapandı."));
    }
    pendingRpc.clear();
    pendingApprovals.clear();
    emit({ type: "finished", code, signal, ...details });
  };

  const stop = () => {
    for (const pending of pendingApprovals.values()) {
      try { send({ id: pending.rpcId, result: { decision: "cancel" } }); } catch { /* process is closing */ }
    }
    pendingApprovals.clear();
    if (!child.killed) {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    }
  };

  const respondApproval = (requestId, decision) => {
    const pending = pendingApprovals.get(String(requestId));
    if (!pending) return false;
    const allowed = new Set(["accept", "decline", "cancel"]);
    const safeDecision = allowed.has(decision) ? decision : "decline";
    send({ id: pending.rpcId, result: { decision: safeDecision } });
    pendingApprovals.delete(String(requestId));
    return true;
  };

  const controller = {
    kind: "codex-app-server",
    pid: child.pid,
    process: child,
    stop,
    respondApproval
  };
  register(controller);
  emit({ type: "started", engineId: "codex" });

  const handleMessage = (message) => {
    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = pendingRpc.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRpc.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || `${pending.method} başarısız.`));
      else pending.resolve(message.result);
      return;
    }

    const method = String(message.method || "");
    const params = message.params || {};
    if (method === "item/started" || method === "item/completed") {
      if (params.item?.id) items.set(params.item.id, params.item);
    }

    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const requestId = crypto.randomUUID();
      const item = items.get(params.itemId) || {};
      pendingApprovals.set(requestId, { rpcId: message.id, method });
      emit({
        type: "approval-request",
        requestId,
        approval: {
          approvalMode: ["ask", "auto_edit", "plan"].includes(approvalMode) ? approvalMode : "ask",
          reviewer: permissions.approvalsReviewer,
          kind: method.includes("commandExecution") ? "command" : "file-change",
          title: method.includes("commandExecution") ? "Terminal komutu için onay" : "Dosya değişikliği için onay",
          command: params.command || item.command || "",
          cwd: params.cwd || item.cwd || projectPath,
          reason: params.reason || "Ajan bu işlemi çalıştırmak için izninizi istiyor.",
          changes: Array.isArray(item.changes) ? item.changes : []
        }
      });
      return;
    }

    if (method === "error") {
      emit({ type: "error", code: "CODEX_APP_SERVER", engineId: "codex", model, message: params.error?.message || params.message || "Codex hatası" });
      return;
    }
    if (method === "turn/completed") {
      const status = params.turn?.status;
      const usage = params.turn?.usage || params.turn?.tokenUsage || params.usage || null;
      finish(status === "completed" ? 0 : 1, null, usage ? { usage } : {});
      stop();
      return;
    }

    const eventData = appServerNotificationToEvent(message);
    if (eventData) emit({ type: "output", stream: "stdout", event: { kind: "json", engineId: "codex", data: eventData } });
  };

  const drain = (chunk, stream) => {
    const incoming = (stream === "stdout" ? stdoutBuffer : stderrBuffer) + chunk.toString("utf8");
    const lines = incoming.split(/\r?\n/);
    if (stream === "stdout") stdoutBuffer = lines.pop() || "";
    else stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (debugStream) console.debug(`[agent:${runId}:${stream}]`, line);
      if (stream === "stderr") continue;
      try { handleMessage(JSON.parse(line)); } catch (error) {
        emit({ type: "error", code: "CODEX_PROTOCOL", engineId: "codex", model, message: error.message });
      }
    }
  };

  child.stdout.on("data", (chunk) => drain(chunk, "stdout"));
  child.stderr.on("data", (chunk) => drain(chunk, "stderr"));
  child.on("error", (error) => {
    emit({ type: "error", code: "CODEX_APP_SERVER", engineId: "codex", model, message: error.message });
    finish(1);
  });
  child.on("close", (code, signal) => finish(code ?? 1, signal));

  try {
    await request("initialize", {
      clientInfo: { name: "taxcli", title: "TaxCLI", version: APP_VERSION },
      capabilities: { experimentalApi: permissions.approvalsReviewer === "auto_review", requestAttestation: false }
    });
    send({ method: "initialized", params: {} });
    if (model) {
      const models = await requestCodexModels(request);
      if (!models.some((entry) => entry.id === model)) {
        throw new Error(`'${model}' bu Codex oturumunun model listesinde yok. Model menüsünden hesabınıza açık başka bir model seçin.`);
      }
    }
    const threadParams = {
      cwd: projectPath,
      approvalPolicy: permissions.approvalPolicy,
      approvalsReviewer: permissions.approvalsReviewer,
      sandbox: permissions.sandbox,
      ephemeral: true
    };
    if (model) threadParams.model = model;
    const threadResult = await request("thread/start", threadParams);
    const input = [{ type: "text", text: prompt, text_elements: [] }];
    images.forEach((imagePath) => input.push({ type: "localImage", path: imagePath }));
    const turnParams = {
      threadId: threadResult.thread.id,
      input
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    await request("turn/start", turnParams);
    return controller;
  } catch (error) {
    emit({ type: "error", code: "CODEX_APP_SERVER", engineId: "codex", model, message: error.message });
    stop();
    throw error;
  }
}

async function readCodexAccountData({ invocation, env, providerArgs = [] }, query) {
  const child = spawn(invocation.command, [...invocation.prefix, "app-server", "--stdio", ...providerArgs], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env
  });
  let nextRpcId = 1;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let closed = false;
  const pending = new Map();

  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  const send = (message) => {
    if (closed || child.stdin.destroyed) throw new Error("Codex kullanım kanalı kapandı.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params, timeoutMs = RPC_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = nextRpcId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex app-server yanıt vermedi: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    const message = { method, id };
    if (params !== undefined) message.params = params;
    send(message);
  });
  const handleLine = (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!Object.prototype.hasOwnProperty.call(message, "id") || message.method) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || `${entry.method} başarısız.`));
    else entry.resolve(message.result);
  };
  child.stdout.on("data", (chunk) => {
    const lines = `${stdoutBuffer}${chunk.toString("utf8")}`.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    lines.forEach(handleLine);
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer = `${stderrBuffer}${chunk.toString("utf8")}`.slice(-4000);
  });
  child.on("error", (error) => {
    closed = true;
    rejectPending(error);
  });
  child.on("close", (code) => {
    closed = true;
    const detail = stderrBuffer.trim();
    rejectPending(new Error(detail || `Codex app-server kapandı (${code ?? 1}).`));
  });

  try {
    await request("initialize", {
      clientInfo: { name: "taxcli", title: "TaxCLI", version: APP_VERSION },
      capabilities: { experimentalApi: false, requestAttestation: false }
    });
    send({ method: "initialized", params: {} });
    if (query === "models") return await requestCodexModels(request);
    const account = await request("account/read", { refreshToken: false }).catch(() => null);
    const rateLimits = await request("account/rateLimits/read");
    const usage = await request("account/usage/read").catch(() => null);
    return { account, rateLimits, usage };
  } finally {
    rejectPending(new Error("Codex kullanım sorgusu tamamlandı."));
    if (!closed && !child.killed) child.kill();
  }
}

async function readCodexAccountUsage(options) {
  return readCodexAccountData(options, "usage");
}

async function readCodexModels(options) {
  return readCodexAccountData(options, "models");
}

module.exports = {
  appServerNotificationToEvent,
  codexPermissionConfig,
  normalizeThreadItem,
  readCodexAccountUsage,
  readCodexModels,
  startCodexAppServerRun
};
