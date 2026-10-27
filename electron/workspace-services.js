const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".aihub", ".taxcli", ".codex", ".gemini", ".aws", ".ssh", ".gnupg",
  "node_modules", "dist", "build", "release", ".next", ".cache", "coverage"
]);
const SENSITIVE_DIRECTORIES = new Set([".aws", ".ssh", ".gnupg", ".codex", ".gemini"]);
const SENSITIVE_BASENAMES = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|secrets?(?:\..+)?|.*\.(?:pem|key|p12|pfx))$/i;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
const MAX_SNAPSHOTS_PER_PROJECT = 20;

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Geçersiz proje yolu.");
  }
  return normalized;
}

function isSensitiveRelativePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  return normalized.split("/").some((part) => SENSITIVE_BASENAMES.test(part));
}

async function validateProjectRoot(projectPath) {
  const root = path.resolve(String(projectPath || ""));
  const info = await fs.lstat(root).catch(() => null);
  if (!projectPath || !path.isAbsolute(root) || !info?.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Geçerli ve gerçek bir proje klasörü seçin.");
  }
  return root;
}

async function walkProject(root) {
  const files = [];
  const skipped = [];
  let totalBytes = 0;
  async function visit(directory, relativeDirectory = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skipped.push({ path: relative, reason: "symbolic-link" });
        continue;
      }
      if (entry.isDirectory()) {
        if (SENSITIVE_DIRECTORIES.has(entry.name.toLowerCase())) {
          skipped.push({ path: relative, reason: "sensitive-directory" });
          continue;
        }
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        await visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitiveRelativePath(relative)) {
        skipped.push({ path: relative, reason: "sensitive" });
        continue;
      }
      const absolute = path.join(directory, entry.name);
      const stats = await fs.stat(absolute);
      if (stats.size > MAX_FILE_BYTES) {
        skipped.push({ path: relative, reason: "large-file" });
        continue;
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_SNAPSHOT_BYTES) {
        const error = new Error("Snapshot boyutu 512 MB sınırını aşıyor.");
        error.code = "PROJECT_SIZE_LIMIT";
        throw error;
      }
      files.push({ path: relative, size: stats.size, mtimeMs: stats.mtimeMs });
    }
  }
  await visit(root);
  return { files, skipped, totalBytes };
}

async function findSensitivePaths(root, limit = 20) {
  const projectRoot = await validateProjectRoot(root);
  const found = [];
  async function visit(directory, relativeDirectory = "") {
    if (found.length >= limit) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (found.length >= limit) return;
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SENSITIVE_DIRECTORIES.has(entry.name.toLowerCase())) {
          found.push(relative);
          continue;
        }
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        if (isSensitiveRelativePath(relative)) {
          found.push(relative);
          continue;
        }
        await visit(path.join(directory, entry.name), relative);
      } else if (entry.isFile() && isSensitiveRelativePath(relative)) {
        found.push(relative);
      }
    }
  }
  await visit(projectRoot);
  return found;
}

function projectStorageKey(projectPath) {
  return crypto.createHash("sha256").update(path.resolve(projectPath).toLowerCase()).digest("hex").slice(0, 24);
}

class SnapshotManager {
  constructor({ storageRoot, onAudit = null }) {
    this.storageRoot = storageRoot;
    this.onAudit = onAudit;
  }

  projectRoot(projectPath) {
    return path.join(this.storageRoot, projectStorageKey(projectPath));
  }

  async create(projectPath, { label = "Otomatik snapshot", reason = "manual", prune = true } = {}) {
    const root = await validateProjectRoot(projectPath);
    const inventory = await walkProject(root);
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
    const snapshotRoot = path.join(this.projectRoot(root), id);
    const filesRoot = path.join(snapshotRoot, "files");
    await fs.mkdir(filesRoot, { recursive: true });
    for (const file of inventory.files) {
      const source = path.resolve(root, file.path);
      const destination = path.resolve(filesRoot, file.path);
      if (!isPathInside(root, source) || !isPathInside(filesRoot, destination)) throw new Error("Snapshot yolu proje sınırını aştı.");
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    const metadata = {
      version: 1,
      id,
      projectPath: root,
      label: String(label || "Snapshot").trim().slice(0, 120) || "Snapshot",
      reason: String(reason || "manual").slice(0, 40),
      createdAt: new Date().toISOString(),
      fileCount: inventory.files.length,
      totalBytes: inventory.totalBytes,
      files: inventory.files,
      skipped: inventory.skipped.slice(0, 200)
    };
    await fs.writeFile(path.join(snapshotRoot, "snapshot.json"), JSON.stringify(metadata, null, 2), "utf8");
    if (prune) await this.prune(root);
    await this.onAudit?.("snapshot.create", { projectPath: root, snapshotId: id, fileCount: metadata.fileCount, reason: metadata.reason });
    return metadata;
  }

  async list(projectPath) {
    const root = await validateProjectRoot(projectPath);
    const snapshotsRoot = this.projectRoot(root);
    const entries = await fs.readdir(snapshotsRoot, { withFileTypes: true }).catch(() => []);
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(snapshotsRoot, entry.name, "snapshot.json"), "utf8"));
        if (path.resolve(metadata.projectPath).toLowerCase() === root.toLowerCase()) snapshots.push(metadata);
      } catch {
        // Ignore incomplete snapshots left by an interrupted copy.
      }
    }
    return snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async get(projectPath, snapshotId) {
    const root = await validateProjectRoot(projectPath);
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(String(snapshotId || ""))) throw new Error("Geçersiz snapshot kimliği.");
    const snapshotRoot = path.join(this.projectRoot(root), snapshotId);
    const metadata = JSON.parse(await fs.readFile(path.join(snapshotRoot, "snapshot.json"), "utf8"));
    if (path.resolve(metadata.projectPath).toLowerCase() !== root.toLowerCase()) throw new Error("Snapshot bu projeye ait değil.");
    return { root, snapshotRoot, metadata };
  }

  async restore(projectPath, snapshotId) {
    const { root, snapshotRoot, metadata } = await this.get(projectPath, snapshotId);
    const safetySnapshot = await this.create(root, {
      label: "Geri alma öncesi güvenlik snapshot’ı",
      reason: "pre-restore",
      prune: false
    });
    const filesRoot = path.join(snapshotRoot, "files");
    const current = await walkProject(root);
    const expected = new Set(metadata.files.map((file) => normalizeRelativePath(file.path)));
    let removedCount = 0;
    for (const file of current.files) {
      const relative = normalizeRelativePath(file.path);
      if (expected.has(relative)) continue;
      const target = path.resolve(root, relative);
      if (!isPathInside(root, target)) throw new Error("Geri alma yolu proje sınırını aştı.");
      await fs.rm(target, { force: true });
      removedCount += 1;
    }
    for (const file of metadata.files) {
      const relative = normalizeRelativePath(file.path);
      const source = path.resolve(filesRoot, relative);
      const target = path.resolve(root, relative);
      if (!isPathInside(filesRoot, source) || !isPathInside(root, target)) throw new Error("Geri alma yolu proje sınırını aştı.");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    }
    await this.onAudit?.("snapshot.restore", { projectPath: root, snapshotId, restoredCount: metadata.files.length, removedCount });
    await this.prune(root);
    return { ...metadata, restoredCount: metadata.files.length, removedCount, safetySnapshotId: safetySnapshot.id };
  }

  async remove(projectPath, snapshotId) {
    const { root, snapshotRoot } = await this.get(projectPath, snapshotId);
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    await this.onAudit?.("snapshot.delete", { projectPath: root, snapshotId });
    return true;
  }

  async prune(projectPath) {
    const snapshots = await this.list(projectPath);
    for (const snapshot of snapshots.slice(MAX_SNAPSHOTS_PER_PROJECT)) {
      const target = path.join(this.projectRoot(projectPath), snapshot.id);
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}

function runGit(cwd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Git işlemi zaman aşımına uğradı."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `Git ${code} koduyla kapandı.`));
      resolve({ stdout, stderr });
    });
  });
}

function parseGitStatus(raw = "") {
  const lines = String(raw).split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## ")) || "";
  const branch = branchLine.slice(3).split("...")[0].trim() || "detached";
  const files = lines.filter((line) => !line.startsWith("## ")).map((line) => {
    const index = line.slice(0, 1);
    const worktree = line.slice(1, 2);
    const rawPath = line.slice(3).trim();
    const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
    return {
      path: filePath,
      index,
      worktree,
      staged: index !== " " && index !== "?",
      changed: worktree !== " ",
      untracked: index === "?" && worktree === "?"
    };
  });
  return { branch, files };
}

class GitService {
  constructor({ runner = runGit, onAudit = null } = {}) {
    this.runner = runner;
    this.onAudit = onAudit;
  }

  async status(projectPath) {
    const root = await validateProjectRoot(projectPath);
    const repo = await this.runner(root, ["rev-parse", "--show-toplevel"]).catch(() => null);
    if (!repo) return { repository: false, projectPath: root, branch: "", files: [], log: [], diffStat: "" };
    const repositoryRoot = path.resolve(repo.stdout.trim());
    if (!isPathInside(repositoryRoot, root) && !isPathInside(root, repositoryRoot)) throw new Error("Git deposu proje sınırlarıyla eşleşmiyor.");
    const [status, diffStat, log] = await Promise.all([
      this.runner(root, ["status", "--porcelain", "--branch"]),
      this.runner(root, ["diff", "--stat", "--", "."]).catch(() => ({ stdout: "" })),
      this.runner(root, ["log", "-8", "--pretty=format:%h%x09%an%x09%ar%x09%s"]).catch(() => ({ stdout: "" }))
    ]);
    const parsed = parseGitStatus(status.stdout);
    return {
      repository: true,
      projectPath: root,
      repositoryRoot,
      branch: parsed.branch,
      files: parsed.files,
      diffStat: diffStat.stdout.trim(),
      log: log.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash, author, age, ...subject] = line.split("\t");
        return { hash, author, age, subject: subject.join("\t") };
      })
    };
  }

  validatedPaths(paths = []) {
    const values = Array.isArray(paths) ? paths : [];
    if (!values.length || values.length > 200) throw new Error("En az bir Git dosyası seçin.");
    return values.map(normalizeRelativePath);
  }

  async stage(projectPath, paths) {
    const root = await validateProjectRoot(projectPath);
    const safePaths = this.validatedPaths(paths);
    await this.runner(root, ["add", "--", ...safePaths]);
    await this.onAudit?.("git.stage", { projectPath: root, paths: safePaths });
    return this.status(root);
  }

  async unstage(projectPath, paths) {
    const root = await validateProjectRoot(projectPath);
    const safePaths = this.validatedPaths(paths);
    await this.runner(root, ["restore", "--staged", "--", ...safePaths]);
    await this.onAudit?.("git.unstage", { projectPath: root, paths: safePaths });
    return this.status(root);
  }

  async commit(projectPath, message) {
    const root = await validateProjectRoot(projectPath);
    const cleanMessage = String(message || "").replace(/[\r\n]+/g, " ").trim();
    if (!cleanMessage || cleanMessage.length > 200) throw new Error("Commit mesajı 1–200 karakter olmalıdır.");
    const result = await this.runner(root, ["commit", "-m", cleanMessage]);
    await this.onAudit?.("git.commit", { projectPath: root, message: cleanMessage });
    return { output: result.stdout.trim(), status: await this.status(root) };
  }

  async initialize(projectPath) {
    const root = await validateProjectRoot(projectPath);
    await this.runner(root, ["init"]);
    await this.onAudit?.("git.init", { projectPath: root });
    return this.status(root);
  }
}

module.exports = {
  SnapshotManager,
  GitService,
  EXCLUDED_DIRECTORIES,
  SENSITIVE_DIRECTORIES,
  findSensitivePaths,
  isPathInside,
  isSensitiveRelativePath,
  normalizeRelativePath,
  parseGitStatus,
  validateProjectRoot,
  walkProject
};
