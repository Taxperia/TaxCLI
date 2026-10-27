const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { walkProject, validateProjectRoot, isPathInside, isSensitiveRelativePath, EXCLUDED_DIRECTORIES } = require("./workspace-services");

const MAX_CAPTURE = 64 * 1024 * 1024;
const hash = (value) => value == null ? null : crypto.createHash("sha256").update(value).digest("hex");
const lines = (text) => String(text).match(/[^\n]*\n|[^\n]+$/g) || [];

function diffHunks(before, after) {
  const a = lines(before), b = lines(after);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const x = a.slice(prefix, a.length - suffix), y = b.slice(prefix, b.length - suffix);
  if (!x.length && !y.length) return [];
  if ((x.length + 1) * (y.length + 1) > 1000000) return [{ id: "h0", oldStart: prefix, newStart: prefix, oldLines: x, newLines: y }];
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const hunks = [];
  let i = 0, j = 0, current = null;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { current = null; i++; j++; continue; }
    if (!current) { current = { id: `h${hunks.length}`, oldStart: prefix + i, newStart: prefix + j, oldLines: [], newLines: [] }; hunks.push(current); }
    if (j < y.length && (i === x.length || table[i][j + 1] >= table[i + 1][j])) current.newLines.push(y[j++]);
    else current.oldLines.push(x[i++]);
  }
  return hunks;
}

async function safeFile(root, relative) {
  if (typeof relative !== "string" || !relative || /[\x00-\x1f:]/.test(relative) || relative.includes("\\")) throw new Error("Geçersiz dosya yolu.");
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || EXCLUDED_DIRECTORIES.has(part.toLowerCase())) || isSensitiveRelativePath(relative)) throw new Error("Korunan dosya yolu.");
  const target = path.resolve(root, ...parts);
  if (!isPathInside(root, target) || target === root) throw new Error("Dosya proje sınırını aşıyor.");
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const info = await fs.lstat(cursor).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error("Sembolik bağlantı üzerinden dosya işlemi yapılamaz.");
    if (info && cursor !== target && !info.isDirectory()) throw new Error("Üst yol klasör değil.");
    if (info && cursor === target && !info.isFile()) throw new Error("Hedef normal bir dosya değil.");
  }
  return target;
}

async function captureProject(projectPath) {
  const root = await validateProjectRoot(projectPath);
  const inventory = await walkProject(root);
  const limitError = () => Object.assign(new Error("İnceleme kaydı 64 MB sınırını aşıyor. Büyük varlıkları proje dışında tutun."), { code: "CAPTURE_SIZE_LIMIT" });
  if (inventory.totalBytes > MAX_CAPTURE) throw limitError();
  const files = {};
  let bytes = 0;
  for (const file of inventory.files) {
    const target = await safeFile(root, file.path);
    const content = await fs.readFile(target);
    bytes += content.length;
    if (bytes > MAX_CAPTURE) throw limitError();
    files[file.path] = content.toString("base64");
  }
  return { files, skipped: inventory.skipped, bytes };
}

function buildChanges(before, after) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort().flatMap((name) => {
    const oldValue = before.files[name] ?? null, newValue = after.files[name] ?? null;
    if (oldValue === newValue) return [];
    const oldBuffer = oldValue == null ? null : Buffer.from(oldValue, "base64");
    const newBuffer = newValue == null ? null : Buffer.from(newValue, "base64");
    const binary = [oldBuffer, newBuffer].some((value) => value && (value.includes(0) || value.toString("utf8").includes("\ufffd")));
    const hunks = binary ? [] : diffHunks(oldBuffer?.toString("utf8") || "", newBuffer?.toString("utf8") || "");
    return [{ path: name, kind: oldValue == null ? "added" : newValue == null ? "deleted" : "modified", before: oldValue, after: newValue, beforeHash: hash(oldBuffer), afterHash: hash(newBuffer), binary, hunks, decisions: {} }];
  });
}

function composeChange(change, include = () => true) {
  if (change.binary || !change.hunks.length) return include("file") ? change.after : change.before;
  const result = lines(Buffer.from(change.before || "", "base64").toString("utf8"));
  for (const hunk of [...change.hunks].reverse()) if (include(hunk.id)) result.splice(hunk.oldStart, hunk.oldLines.length, ...hunk.newLines);
  const value = result.join("");
  if (!value && ((change.before == null && !change.hunks.some((h) => include(h.id))) || (change.after == null && change.hunks.every((h) => include(h.id))))) return null;
  return Buffer.from(value).toString("base64");
}

async function applyChanges(projectPath, changes, { expected = "before", selection = null, backup = null } = {}) {
  const root = await validateProjectRoot(projectPath);
  const selected = changes.filter((change) => !selection || selection.some((item) => item.path === change.path));
  if (!selected.length) throw new Error("Uygulanacak değişiklik seçilmedi.");
  const prepared = [];
  for (const change of selected) {
    const target = await safeFile(root, change.path);
    const current = await fs.readFile(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    const base = expected === "current" ? composeChange(change, (id) => change.decisions[id] !== "rejected") : expected === "applied" ? composeChange(change, (id) => change.decisions[id] === "applied") : change.before;
    if (hash(current) !== hash(base == null ? null : Buffer.from(base, "base64"))) throw new Error(`Çakışma: ${change.path} bu çalışmadan sonra değişti. Önce farkları inceleyin.`);
    const item = selection?.find((entry) => entry.path === change.path);
    const content = expected === "current" ? composeChange(change, (id) => change.decisions[id] !== "rejected" && !(item?.hunkIds || ["file", ...change.hunks.map((h) => h.id)]).includes(id)) : composeChange(change, (id) => change.decisions[id] === "applied" || !item?.hunkIds || item.hunkIds.includes(id));
    prepared.push({ relative: change.path, target, current, content });
  }
  const safety = await backup?.(root);
  const verifyCurrent = async (item) => {
    await safeFile(root, item.relative);
    const current = await fs.readFile(item.target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (hash(current) !== hash(item.current)) throw new Error(`Çakışma: ${item.relative} uygulama hazırlanırken değişti. Kullanıcı düzenlemesi korundu.`);
  };
  // Snapshot creation can take seconds. Revalidate the entire batch before any
  // write, then each target immediately before its mutation.
  for (const item of prepared) await verifyCurrent(item);
  const written = [];
  try {
    for (const item of prepared) {
      await verifyCurrent(item);
      if (item.content == null) await fs.rm(item.target, { force: true });
      else {
        await fs.mkdir(path.dirname(item.target), { recursive: true });
        const temporary = path.join(path.dirname(item.target), `.taxcli-apply-${crypto.randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, Buffer.from(item.content, "base64"), { flag: "wx" });
          await verifyCurrent(item);
          await fs.rename(temporary, item.target);
        } finally { await fs.rm(temporary, { force: true }); }
      }
      written.push(item);
    }
  } catch (error) {
    for (const item of written.reverse()) {
      try {
        await safeFile(root, item.relative);
        const current = await fs.readFile(item.target).catch((readError) => { if (readError.code === "ENOENT") return null; throw readError; });
        const applied = item.content == null ? null : Buffer.from(item.content, "base64");
        // A separate editor may have changed an already-written file. Do not
        // replace that edit during rollback; the safety snapshot remains available.
        if (hash(current) !== hash(applied)) continue;
        if (item.current == null) await fs.rm(item.target, { force: true });
        else await fs.writeFile(item.target, item.current);
      } catch { /* Keep the pre-apply snapshot available for manual recovery. */ }
    }
    throw error;
  }
  return { count: prepared.length, safetySnapshotId: safety?.id || "" };
}

module.exports = { hash, diffHunks, safeFile, captureProject, buildChanges, composeChange, applyChanges };
