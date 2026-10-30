const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { captureProject, safeFile } = require("./change-review");

// Candidates share an immutable baseline, never a writable working directory.
// A locked file may delay physical deletion, but must not block the next run.
class ComparisonWorkspaces {
  constructor({ batches, store, trustWorkspace, io = fs }) {
    Object.assign(this, { batches, store, trustWorkspace, io });
  }

  async directoryChain(root, target) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Karşılaştırma klasörü proje içinde olmalı.");
    for (const part of [root, ...relative.split(path.sep).map((_, i, parts) => path.join(root, ...parts.slice(0, i + 1)))]) {
      const info = await this.io.lstat(part).catch((error) => { if (error.code !== "ENOENT") throw error; });
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Karşılaştırma klasöründe bağlantı veya geçersiz dizin var.");
      if (!info) await this.io.mkdir(part);
    }
  }

  async prepare(source, requested) {
    const root = path.join(source, ".taxcli", "comparisons");
    await this.directoryChain(source, root);
    await this.io.writeFile(path.join(root, ".gitignore"), "*\n", { flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    const batchId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(6).toString("hex")}`;
    const batchRoot = path.join(root, batchId);
    await this.io.mkdir(batchRoot);
    const variants = requested.map((variant, index) => {
      const slug = String(variant.model || "auto").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "auto";
      return { ...variant, projectPath: path.join(batchRoot, `${String(index + 1).padStart(2, "0")}-${variant.engineId}-${slug}`) };
    });
    const batch = { source, root: batchRoot, variants: new Map(variants.map((v) => [v.variantId, v.projectPath])), activeVariantId: "", tail: Promise.resolve() };
    try { await this.store().seal(`batch-${batchId}`, await captureProject(source)); }
    catch (error) { await this.io.rmdir(batchRoot).catch(() => {}); throw error; }
    this.batches.set(batchId, batch);
    return { batchId, root: batchRoot, variants };
  }

  serial(batch, operation) {
    const pending = batch.tail.then(operation);
    batch.tail = pending.catch(() => {});
    return pending;
  }

  async validateDestination(batch, destination) {
    if (!destination || path.dirname(destination) !== batch.root || path.dirname(batch.root) !== path.join(batch.source, ".taxcli", "comparisons")) throw new Error("Karşılaştırma çalışma alanı doğrulanamadı.");
    // Recheck every ancestor immediately before writes or recursive deletion.
    for (const target of [batch.source, path.join(batch.source, ".taxcli"), path.dirname(batch.root), batch.root, destination]) {
      const info = await this.io.lstat(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Karşılaştırma çalışma alanında güvenli olmayan bağlantı var.");
    }
  }

  materialize({ batchId, variantId }) {
    const batch = this.batches.get(batchId);
    if (!batch) return Promise.reject(new Error("Karşılaştırma oturumu bulunamadı."));
    return this.serial(batch, async () => {
      if (batch.activeVariantId) throw new Error("Önceki model hâlâ çalışıyor.");
      const destination = batch.variants.get(variantId);
      await this.validateDestination(batch, destination);
      const info = await this.io.lstat(destination).catch((error) => { if (error.code !== "ENOENT") throw error; });
      if (info) throw new Error("Karşılaştırma çalışma alanı zaten mevcut.");
      const baseline = await this.store().unseal(`batch-${batchId}`);
      await this.io.mkdir(destination);
      for (const [relative, content] of Object.entries(baseline.files)) {
        const target = await safeFile(destination, relative);
        await this.io.mkdir(path.dirname(target), { recursive: true });
        await this.io.writeFile(target, Buffer.from(content, "base64"));
      }
      await this.trustWorkspace(destination);
      batch.activeVariantId = variantId;
      return { projectPath: destination };
    });
  }

  async remove(batch, destination) {
    await this.validateDestination(batch, destination);
    await this.io.rm(destination, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  deferRemoval(batch, destination, attempt = 0) {
    const timer = setTimeout(async () => {
      try { await this.remove(batch, destination); await this.io.rmdir(batch.root).catch(() => {}); }
      catch (error) { if (["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code) && attempt < 5) this.deferRemoval(batch, destination, attempt + 1); }
    }, 10000);
    timer.unref?.();
  }

  cleanup({ batchId, variantId }) {
    const batch = this.batches.get(batchId);
    if (!batch) return Promise.resolve({ cleaned: true });
    return this.serial(batch, async () => {
      const destination = batch.variants.get(variantId);
      if (!destination) return { cleaned: true }; // Repeated cleanup is harmless.
      if (batch.activeVariantId && batch.activeVariantId !== variantId) throw new Error("Çalışan model bitmeden başka çalışma alanı temizlenemez.");
      let warning = "";
      try { await this.remove(batch, destination); }
      catch (error) {
        if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
        warning = `Çalışma dosyası kullanımda; temizlik ertelendi: ${destination}`;
        this.deferRemoval(batch, destination);
      }
      if (batch.activeVariantId === variantId) batch.activeVariantId = "";
      batch.variants.delete(variantId);
      if (!batch.variants.size) {
        // Non-recursive: deferred candidates may still contain locked files.
        await this.io.rmdir(batch.root).catch((error) => { if (!["ENOENT", "ENOTEMPTY", "EBUSY", "EPERM"].includes(error.code)) throw error; });
        await this.io.rm(this.store().file(`batch-${batchId}`), { force: true });
        this.batches.delete(batchId);
      }
      return { cleaned: !warning, warning };
    });
  }
}

module.exports = { ComparisonWorkspaces };
