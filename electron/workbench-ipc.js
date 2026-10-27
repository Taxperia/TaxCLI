const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { Workbench, parseSession, checkPlan } = require("./workbench");
const { validateProjectRoot, isPathInside, isSensitiveRelativePath } = require("./workspace-services");
const { safeFile } = require("./change-review");
const { redactSensitive } = require("./security-center");

function registerWorkbench({ ipcMain, app, dialog, safeStorage, createSnapshotManager, createSecurityCenter, resolveEngineInvocation, checkEngineAuth, captureCommand, listEngineModels, writeConversationHistory, readConversationHistory, queueConversationMutation, activeRuns }) {
  const service = new Workbench({
    storageRoot: path.join(app.getPath("userData"), "workbench"), snapshotManager: createSnapshotManager(),
    protect: async (value) => { if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows şifreleme kasası kullanılamıyor."); return safeStorage.encryptString(value).toString("base64"); },
    unprotect: async (value) => { if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows şifreleme kasası kullanılamıyor."); return safeStorage.decryptString(Buffer.from(value, "base64")); }
  });
  const discovered = new Map();
  async function trusted(projectPath) {
    const root = await validateProjectRoot(projectPath);
    if (!(await createSecurityCenter().workspaceStatus(root)).trusted) throw new Error("Önce Güvenlik Merkezi’nden projeye güven verin.");
    return root;
  }
  function idle(root) {
    if ([...service.active.values()].some((value) => value.run.projectPath === root)) throw new Error("Dosya uygulamak için bu projedeki çalışan ajanların bitmesini bekleyin.");
    if (service.checking.has(root)) throw new Error("Dosya uygulamak için proje kontrollerinin bitmesini bekleyin.");
  }
  async function importSession(root, filename, provider = "") {
    const info = await fs.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 20 * 1024 * 1024 || isSensitiveRelativePath(path.basename(filename))) throw new Error("Normal bir konuşma dosyası seçin (en fazla 20 MB).");
    let raw = await fs.readFile(filename, "utf8");
    if (provider === "opencode") {
      const session = JSON.parse(raw);
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(String(session.id || ""))) throw new Error("OpenCode oturum kimliği geçersiz.");
      const storage = path.join(os.homedir(), ".local", "share", "opencode", "storage");
      async function jsonFiles(directory) {
        const directoryInfo = await fs.lstat(directory).catch(() => null);
        if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink()) return [];
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const values = [];
        for (const entry of entries.slice(0, 1000)) {
          if (!entry.isFile() || entry.isSymbolicLink() || !/\.json$/i.test(entry.name)) continue;
          const target = path.join(directory, entry.name), stat = await fs.lstat(target);
          if (stat.size <= 1024 * 1024 && !stat.isSymbolicLink()) try { values.push(JSON.parse(await fs.readFile(target, "utf8"))); } catch { /* Ignore interrupted message writes. */ }
        }
        return values;
      }
      const records = await jsonFiles(path.join(storage, "message", session.id));
      const combined = [];
      for (const message of records.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))) {
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(String(message.id || ""))) continue;
        combined.push({ role: message.role, parts: await jsonFiles(path.join(storage, "part", message.id)) });
      }
      raw = JSON.stringify(combined);
    }
    const messages = parseSession(raw, filename);
    const conversationId = crypto.randomUUID().replaceAll("-", "");
    const title = `İçe aktarılan · ${path.basename(filename)}`.slice(0, 80);
    await queueConversationMutation(root, () => writeConversationHistory(root, conversationId, title, messages));
    return { conversationId, title, messageCount: messages.length, note: "Konuşma bağlamı aktarıldı; sağlayıcının canlı terminal süreci veya gizli araç durumu aktarılmaz." };
  }
  async function scanSessions(root) {
    discovered.clear();
    const sources = [
      ["codex", path.join(os.homedir(), ".codex", "sessions")],
      ["claude", path.join(os.homedir(), ".claude", "projects")],
      ["gemini", path.join(os.homedir(), ".gemini", "tmp")],
      ["opencode", path.join(os.homedir(), ".local", "share", "opencode", "storage", "session")]
    ];
    const candidates = [];
    let examined = 0;
    async function visit(directory, provider, depth = 0) {
      if (depth > 6 || examined > 5000 || candidates.length >= 300) return;
      const info = await fs.lstat(directory).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) return;
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++examined > 5000 || candidates.length >= 300) break;
        if (entry.isSymbolicLink()) continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(filename, provider, depth + 1);
        else if (entry.isFile() && /\.jsonl?$/i.test(entry.name) && !isSensitiveRelativePath(entry.name)) {
          const stat = await fs.stat(filename);
          if (stat.size > 20 * 1024 * 1024) continue;
          const sample = await fs.open(filename, "r").then(async (handle) => { try { const buffer = Buffer.alloc(Math.min(stat.size, 16000)); await handle.read(buffer, 0, buffer.length, 0); return buffer.toString("utf8"); } finally { await handle.close(); } });
          const projectMatch = sample.includes(root) || sample.includes(JSON.stringify(root).slice(1, -1)) || sample.includes(root.replaceAll("\\", "/"));
          const key = crypto.randomUUID(); discovered.set(key, { filename, provider });
          candidates.push({ id: key, provider, name: path.basename(filename), updatedAt: stat.mtime.toISOString(), bytes: stat.size, projectMatch });
        }
      }
    }
    for (const [provider, directory] of sources) await visit(directory, provider);
    return candidates.sort((a, b) => Number(b.projectMatch) - Number(a.projectMatch) || b.updatedAt.localeCompare(a.updatedAt));
  }
  async function diagnostics(engineId) {
    if (!["codex", "claude", "cursor", "copilot", "gemini", "opencode", "nvidia"].includes(engineId)) throw new Error("Sağlayıcı tanınmıyor.");
    const started = Date.now();
    const invocation = await resolveEngineInvocation(engineId);
    const checks = [], installed = Boolean(invocation) && !(engineId === "cursor" && invocation.resolvedCommand === "cursor");
    checks.push({ name: "CLI kurulumu", ok: installed, detail: installed ? invocation.resolvedCommand || invocation.command : "Resmî CLI bulunamadı.", action: installed ? "" : "install" });
    if (installed) {
      const version = await captureCommand(invocation, ["--version"], 10000).catch((e) => ({ code: 1, stderr: e.message }));
      checks.push({ name: "Sürüm", ok: version.code === 0, detail: redactSensitive(version.stdout || version.stderr || "Sürüm alınamadı").slice(0, 400) });
      const auth = await checkEngineAuth(engineId, invocation).catch((e) => ({ authenticated: false, detail: e.message }));
      checks.push({ name: "Oturum", ok: Boolean(auth.authenticated), detail: redactSensitive(auth.detail || "Oturum doğrulanamadı").slice(0, 700), action: auth.authenticated ? "" : "login" });
      if (auth.authenticated) {
        try {
          const models = await listEngineModels(engineId);
          checks.push({ name: "Model kataloğu", ok: models.length > 0, detail: models.length ? `${models.length} model listelendi. Katalog görünürlüğü her model için erişim garantisi değildir.` : "Model listesi boş; oturumu yenileyip tekrar tarayın." });
        } catch (error) {
          const message = redactSensitive(error.message);
          checks.push({ name: "Model kataloğu", ok: false, detail: /403|forbidden/i.test(message) ? "Erişim reddedildi (403). Hesabın ürün yetkisini ve kurum politikasını kontrol edin; giriş yapıp tekrar deneyin." : message.slice(0, 1000), action: "login" });
        }
      }
    }
    const report = { engineId, at: new Date().toISOString(), durationMs: Date.now() - started, checks };
    await service.mutate((state) => { state.diagnostics = [report, ...(state.diagnostics || []).filter((r) => r.engineId !== engineId)]; });
    return report;
  }
  ipcMain.handle("workbench:request", async (_event, action, payload = {}) => {
    const projectPath = payload.projectPath;
    switch (action) {
      case "list": return service.list(await validateProjectRoot(projectPath));
      case "run": return service.detail(String(payload.runId || ""));
      case "run-replay": {
        const run = await service.detail(String(payload.runId || ""));
        await trusted(run.projectPath); idle(run.projectPath);
        const replay = await service.prepareReplay(run.id);
        if (replay.replayId) {
          try { await createSecurityCenter().trustWorkspace(replay.projectPath); }
          catch (error) { await service.cleanupReplay(replay.replayId); throw error; }
        }
        return replay;
      }
      case "replay-cleanup": return service.cleanupReplay(String(payload.replayId || ""));
      case "review": {
        const run = await service.detail(String(payload.runId || ""));
        await trusted(run.projectPath); idle(run.projectPath);
        if (payload.action === "reject" && run.workingPath !== run.projectPath) throw new Error("İzole sonuç zaten ana projeye yazılmadı. Uygulamak için seçili değişiklikleri kullanın.");
        return service.review(payload);
      }
      case "checks-plan": return checkPlan(await trusted(projectPath));
      case "checks": return service.runChecks(await trusted(projectPath), payload);
      case "run-tests": {
        const run = await service.detail(payload.runId);
        await trusted(run.projectPath);
        let workPath = run.workingPath, disposable = false;
        if (!(await fs.stat(workPath).catch(() => null))?.isDirectory()) {
          if (run.reviewWarning) throw new Error("Bu çalışmanın dosya kaydı eksik; arşivden test klasörü oluşturulamıyor.");
          idle(run.projectPath);
          workPath = path.join(service.root, "test-runs", crypto.randomUUID());
          await fs.mkdir(workPath, { recursive: true }); disposable = true;
          const files = { ...run.before.files };
          for (const change of run.changes) { if (change.after == null) delete files[change.path]; else files[change.path] = change.after; }
          for (const [relative, content] of Object.entries(files)) { const target = await safeFile(workPath, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.from(content, "base64")); }
          await createSecurityCenter().trustWorkspace(workPath);
        }
        try {
          const report = await service.runChecks(workPath, { onlyTests: true, prepareDependencies: Boolean(run.arenaId) });
          await service.saveRunTests(run.id, report);
          return report;
        } finally { if (disposable) await fs.rm(workPath, { recursive: true, force: true }); }
      }
      case "arena-create": return service.createArena(await trusted(projectPath), payload.prompt, payload.variants, payload.judge);
      case "arena-result": return service.arenaResult(payload.arenaId, payload.variantId, payload.runId, payload.tests);
      case "arena-failure": return service.mutate((state) => { const arena = state.arenas.find((a) => a.id === payload.arenaId), variant = arena?.variants.find((v) => v.variantId === payload.variantId); if (!variant) throw new Error("Arena varyantı bulunamadı."); variant.status = "failed"; variant.error = redactSensitive(String(payload.error || "Başlatılamadı")).slice(0, 2000); });
      case "arena-judge-prompt": return service.judgePrompt(payload.arenaId);
      case "arena-judge-workspace": {
        const arena = (await service.read()).arenas.find((a) => a.id === payload.arenaId);
        if (!arena) throw new Error("Arena bulunamadı.");
        await trusted(arena.projectPath);
        const workPath = path.join(service.root, "judges", arena.id);
        await fs.mkdir(workPath, { recursive: true });
        await createSecurityCenter().trustWorkspace(workPath);
        return { projectPath: workPath };
      }
      case "arena-judgment": return service.saveJudgment(payload.arenaId, payload.text);
      case "arena-finish": return service.finishArena(payload.arenaId, payload.error);
      case "recipe-save": return service.saveRecipe(payload);
      case "recipe-prompt": return service.recipePrompt(payload.recipeId, payload.task || "");
      case "recipe-delete": return service.mutate((state) => { state.recipes = state.recipes.filter((r) => r.id !== payload.recipeId); });
      case "knowledge-import": {
        const root = await trusted(projectPath);
        const selection = await dialog.showOpenDialog({ title: "Bilgi belgesi ekle", properties: ["openFile", "multiSelections"], filters: [{ name: "Belgeler", extensions: ["md", "txt", "json", "yaml", "yml", "csv", "html", "pdf"] }] });
        if (selection.canceled) return [];
        const results = [];
        for (const filename of selection.filePaths.slice(0, 12)) {
          const info = await fs.lstat(filename);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024 || isSensitiveRelativePath(path.basename(filename))) throw new Error("Belge en fazla 10 MB olmalı ve gizli kimlik dosyası olmamalıdır.");
          let content;
          if (/\.pdf$/i.test(filename)) {
            const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
            const loading = getDocument({ data: new Uint8Array(await fs.readFile(filename)), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts").replaceAll("\\", "/") + "/" });
            const document = await loading.promise;
            try {
              content = "";
              for (let page = 1; page <= Math.min(document.numPages, 200); page++) {
                content += (await (await document.getPage(page)).getTextContent()).items.map((item) => item.str || "").join(" ") + "\n";
                if (content.length > 500000) break;
              }
            } finally { await loading.destroy(); }
          } else content = await fs.readFile(filename, "utf8");
          results.push(await service.addKnowledge(payload.global ? "" : root, filename, content));
        }
        return results;
      }
      case "knowledge-toggle": return service.updateKnowledge(payload.id, payload.enabled);
      case "knowledge-delete": return service.removeKnowledge(payload.id);
      case "sessions-scan": return scanSessions(await trusted(projectPath));
      case "session-import": {
        const root = await trusted(projectPath);
        if (payload.sessionId) {
          const discoveredSession = discovered.get(payload.sessionId);
          if (!discoveredSession) throw new Error("Önce oturumları yeniden tarayın.");
          return importSession(root, discoveredSession.filename, discoveredSession.provider);
        }
        const choice = await dialog.showOpenDialog({ title: "CLI / terminal oturumu içe aktar", properties: ["openFile"], filters: [{ name: "Konuşma veya terminal kaydı", extensions: ["json", "jsonl", "txt", "md", "log"] }] });
        return choice.canceled ? null : importSession(root, choice.filePaths[0]);
      }
      case "branch-create": {
        const root = await trusted(projectPath); idle(root);
        const messages = (await readConversationHistory(root, payload.parentId)).slice(0, Math.max(1, Math.min(200, Number(payload.forkAt) || 200)));
        if (!messages.length) throw new Error("Dallandırılacak mesaj bulunamadı.");
        const conversationId = crypto.randomUUID().replaceAll("-", "");
        const branch = await service.saveBranch(root, { id: conversationId, parentId: payload.parentId, title: payload.title || "Alternatif dal", forkAt: messages.length, engineId: payload.engineId, sourceRunId: payload.sourceRunId });
        const baseline = await service.unseal(`branch-${branch.id}`);
        const workPath = path.join(service.root, "branches", conversationId);
        await fs.mkdir(workPath, { recursive: true });
        for (const [relative, content] of Object.entries(baseline.files)) { const file = await safeFile(workPath, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.from(content, "base64")); }
        await createSecurityCenter().trustWorkspace(workPath);
        await queueConversationMutation(root, () => writeConversationHistory(root, conversationId, branch.title, messages));
        await service.mutate((state) => { state.branches.find((b) => b.id === conversationId).workingPath = workPath; });
        return { ...branch, conversationId, workingPath: workPath };
      }
      case "branches-compare": return service.compareBranches(await trusted(projectPath), payload.leftId, payload.rightId);
      case "branch-apply": {
        const root = await trusted(projectPath); idle(root);
        const state = await service.read(), branch = state.branches.find((b) => b.projectPath === root && b.id === payload.branchId);
        if (!branch) throw new Error("Dal bulunamadı.");
        const { captureProject, buildChanges, applyChanges } = require("./change-review");
        const changes = buildChanges(await service.unseal(`branch-${branch.id}`), await captureProject(branch.workingPath));
        return service.locked(root, async () => {
          const result = await applyChanges(root, changes, { backup: (r) => service.snapshots.create(r, { label: "Dal uygulaması öncesi", reason: "branch-apply" }) });
          await service.seal(`branch-${branch.id}`, await captureProject(branch.workingPath));
          await service.mutate((state) => { state.branches.find((b) => b.id === branch.id).appliedAt = new Date().toISOString(); });
          return result;
        });
      }
      case "branch-diff": {
        const root = await trusted(projectPath), state = await service.read();
        const branch = state.branches.find((b) => b.id === payload.branchId && b.projectPath === root);
        if (!branch) throw new Error("Dal bulunamadı.");
        const { captureProject, buildChanges } = require("./change-review");
        return buildChanges(await service.unseal(`branch-${branch.id}`), await captureProject(branch.workingPath));
      }
      case "doctor": return diagnostics(String(payload.engineId || ""));
      case "doctor-export": {
        const state = await service.read(), report = state.diagnostics?.find((r) => r.engineId === payload.engineId);
        if (!report) throw new Error("Önce sağlayıcıyı kontrol edin.");
        const choice = await dialog.showSaveDialog({ title: "Teşhis raporunu kaydet", defaultPath: `taxcli-${payload.engineId}-diagnostics.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
        if (choice.canceled) return false;
        await fs.writeFile(choice.filePath, redactSensitive(JSON.stringify(report, null, 2)), "utf8"); return true;
      }
      case "run-export": {
        const run = await service.detail(payload.runId);
        const choice = await dialog.showSaveDialog({ title: "Çalışma raporunu kaydet", defaultPath: `taxcli-run-${run.id}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
        if (choice.canceled) return false;
        const { before, changes, history, images, ...report } = run;
        await fs.writeFile(choice.filePath, redactSensitive(JSON.stringify({ ...report, changes: changes.map(({ before: oldContent, after: newContent, ...change }) => change) }, null, 2))); return true;
      }
      default: throw new Error("Desteklenmeyen geliştirme merkezi işlemi.");
    }
  });
  return service;
}

module.exports = { registerWorkbench };
