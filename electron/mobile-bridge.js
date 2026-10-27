const https = require("node:https");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const QRCode = require("qrcode");
const selfsigned = require("selfsigned");

const COOKIE_NAME = "taxcli_mobile";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_LENGTH = 20000;
const MAX_MESSAGES = 100;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function parseCookies(header = "") {
  return String(header).split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function listLanIPv4() {
  const results = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (/^169\.254\./.test(entry.address)) continue;
      const virtual = /vethernet|wsl|docker|virtualbox|vmware|loopback/i.test(name);
      const preferred = /wi-?fi|wlan|wireless|ethernet|lan/i.test(name) && !virtual;
      const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      results.push({ address: entry.address, score: (preferred ? 4 : 0) + (privateAddress ? 2 : 0) - (virtual ? 5 : 0) });
    }
  }
  return [...new Map(results.sort((a, b) => b.score - a.score).map((item) => [item.address, item])).keys()];
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left), "hex");
    const b = Buffer.from(String(right), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function jsonResponse(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  res.end(body);
}

function textResponse(res, status, contentType, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  res.end(body);
}

function readJson(req, maxBytes = 32768) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("İstek çok büyük."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Geçersiz JSON."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const readMobileAsset = (name) => require("node:fs").readFileSync(path.join(__dirname, name), "utf8");
const MOBILE_CSS = readMobileAsset("mobile.css");
const MOBILE_JS = readMobileAsset("mobile-client.js");
const MOBILE_HTML = readMobileAsset("mobile.html");

function pairingHtml(token) {
  const action = `/pair/${encodeURIComponent(token)}`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000000"><title>TaxCLI Mobil Eşleştirme</title><link rel="stylesheet" href="/app.css"></head><body><main><header class="top"><div class="mark">T</div><div><h1>TaxCLI Mobil</h1><p>Bilgisayarına güvenli bağlantı</p></div></header><section class="empty pair-card"><strong>Bu telefonu bağla</strong><p>Bu işlem telefonu, aynı yerel ağdaki TaxCLI masaüstü uygulamasıyla eşleştirir.</p><form method="post" action="${action}"><button class="pair-button" type="submit">Telefonu bağla</button></form></section><p class="foot">Kod tek kullanımlıktır ve beş dakika içinde geçerliliğini yitirir.</p></main></body></html>`;
}

const PAIRED_OUT_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000000"><title>TaxCLI Mobil</title><link rel="stylesheet" href="/app.css"></head><body><main><header class="top"><div class="mark">T</div><div><h1>Oturum kapalı</h1><p>Bu cihazın TaxCLI bağlantısı yok.</p></div></header><section class="empty">TaxCLI masaüstü uygulamasında Ayarlar → Mobil erişim bölümünü açıp yeni QR kodu okut.</section></main></body></html>`;

class MobileBridge {
  constructor({ storagePath, tlsPath, protect, unprotect, onPrompt, getCatalog, getModels, onApproval, getAddresses = listLanIPv4, host = "0.0.0.0", port = 47831 }) {
    this.storagePath = storagePath;
    this.tlsPath = tlsPath || path.join(path.dirname(storagePath), "mobile-tls.json");
    this.protect = protect;
    this.unprotect = unprotect;
    this.onPrompt = onPrompt;
    this.getCatalog = getCatalog;
    this.getModels = getModels;
    this.onApproval = onApproval;
    this.approvals = new Map();
    this.getAddresses = getAddresses;
    this.host = host;
    this.preferredPort = port;
    this.server = null;
    this.port = 0;
    this.addresses = [];
    this.sessions = new Map();
    this.pairings = new Map();
    this.messages = [];
    this.context = { projectName: "", engineName: "", agentName: "" };
    this.rateLimits = new Map();
    this.tlsFingerprint = "";
  }

  async loadTlsMaterial(addresses) {
    if (typeof this.protect !== "function" || typeof this.unprotect !== "function") {
      throw new Error("Mobil HTTPS anahtarı için güvenli kasa kullanılamıyor.");
    }
    const normalizedAddresses = [...new Set(addresses.map(String))].sort();
    try {
      const saved = JSON.parse(await fs.readFile(this.tlsPath, "utf8"));
      const savedAddresses = Array.isArray(saved.addresses) ? [...saved.addresses].map(String).sort() : [];
      if (saved.cert && saved.privateEncrypted && Number(saved.expiresAt) > Date.now() + 7 * 24 * 60 * 60 * 1000
        && JSON.stringify(savedAddresses) === JSON.stringify(normalizedAddresses)) {
        const privateKey = await this.unprotect(saved.privateEncrypted);
        this.tlsFingerprint = String(saved.fingerprint || new crypto.X509Certificate(saved.cert).fingerprint256);
        return { key: privateKey, cert: saved.cert };
      }
    } catch {
      // Missing, expired or unreadable material is replaced below.
    }

    const notAfterDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const altNames = [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }];
    for (const address of normalizedAddresses) if (address !== "127.0.0.1") altNames.push({ type: 7, ip: address });
    const pems = await selfsigned.generate([{ name: "commonName", value: "TaxCLI Mobile" }], {
      keyType: "rsa",
      keySize: 2048,
      algorithm: "sha256",
      notAfterDate,
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames }
      ]
    });
    const fingerprint = new crypto.X509Certificate(pems.cert).fingerprint256;
    const record = {
      version: 1,
      cert: pems.cert,
      privateEncrypted: await this.protect(pems.private),
      fingerprint,
      addresses: normalizedAddresses,
      expiresAt: notAfterDate.getTime()
    };
    await fs.mkdir(path.dirname(this.tlsPath), { recursive: true });
    await fs.writeFile(this.tlsPath, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
    this.tlsFingerprint = fingerprint;
    return { key: pems.private, cert: pems.cert };
  }

  async loadSessions() {
    try {
      const payload = JSON.parse(await fs.readFile(this.storagePath, "utf8"));
      const now = Date.now();
      for (const session of payload.sessions || []) {
        if (session?.id && session?.secretHash && Number(session.expiresAt) > now) {
          this.sessions.set(session.id, session);
        }
      }
    } catch {
      // First run or malformed state: start with no paired devices.
    }
  }

  async persistSessions() {
    await fs.mkdir(require("node:path").dirname(this.storagePath), { recursive: true });
    const sessions = [...this.sessions.values()].map(({ id, secretHash, createdAt, lastSeen, expiresAt, device, selection }) => ({ id, secretHash, createdAt, lastSeen, expiresAt, device, selection }));
    await fs.writeFile(this.storagePath, JSON.stringify({ sessions }, null, 2), "utf8");
  }

  async start(context = {}) {
    this.updateContext(context);
    if (this.server) return this.status();
    await this.loadSessions();
    this.addresses = this.getAddresses();
    if (!this.addresses.length) throw new Error("Yerel ağ adresi bulunamadı. Wi‑Fi veya Ethernet bağlantısını kontrol edin.");
    const tls = await this.loadTlsMaterial(this.addresses);
    this.server = https.createServer(tls, (req, res) => this.handleRequest(req, res).catch((error) => {
      if (!res.headersSent) jsonResponse(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Mobil köprü hatası." });
      else res.end();
    }));
    const listen = (port) => new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, this.host);
    });
    try {
      await listen(this.preferredPort);
    } catch (error) {
      if (error.code !== "EADDRINUSE" || this.preferredPort === 0) throw error;
      this.server.removeAllListeners("error");
      this.server.removeAllListeners("listening");
      await listen(0);
    }
    this.port = this.server.address().port;
    return this.status();
  }

  async stop() {
    this.pairings.clear();
    if (!this.server) return this.status();
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
    this.port = 0;
    this.addresses = [];
    return this.status();
  }

  updateContext(context = {}) {
    this.context = {
      projectName: String(context.projectName || "").slice(0, 120),
      engineName: String(context.engineName || "").slice(0, 80),
      agentName: String(context.agentName || "").slice(0, 80),
      projectId: String(context.projectId || ""), engineId: String(context.engineId || ""),
      model: String(context.model || ""), approvalMode: String(context.approvalMode || "ask")
    };
    return this.status();
  }

  status() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (Number(session.expiresAt) <= now) this.sessions.delete(id);
    }
    const address = this.addresses[0] || "";
    return {
      running: Boolean(this.server),
      address,
      port: this.port,
      baseUrl: address && this.port ? `https://${address}:${this.port}` : "",
      baseUrls: this.addresses.map((item) => `https://${item}:${this.port}`),
      tlsFingerprint: this.tlsFingerprint,
      sessionCount: this.sessions.size,
      context: this.context
    };
  }

  async createPairing(context = {}) {
    await this.start(context);
    const token = randomToken(24);
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.pairings.clear();
    this.pairings.set(token, expiresAt);
    const pairUrl = `${this.status().baseUrl}/pair/${token}`;
    const qrDataUrl = await QRCode.toDataURL(pairUrl, { errorCorrectionLevel: "M", margin: 2, width: 360, color: { dark: "#08100aff", light: "#ffffffff" } });
    return { ...this.status(), pairUrl, qrDataUrl, expiresAt };
  }

  authenticate(req) {
    const authorization = String(req.headers.authorization || "");
    const bearer = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{20,})$/i)?.[1] || "";
    const raw = bearer || parseCookies(req.headers.cookie || "")[COOKIE_NAME] || "";
    const dot = raw.indexOf(".");
    if (dot < 1) return null;
    const id = raw.slice(0, dot);
    const secret = raw.slice(dot + 1);
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= Date.now() || !safeEqualHex(session.secretHash, sha256(secret))) return null;
    session.lastSeen = Date.now();
    return session;
  }

  assertSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let parsed;
    try { parsed = new URL(origin); } catch { throw Object.assign(new Error("Geçersiz kaynak."), { statusCode: 403 }); }
    if (parsed.host !== req.headers.host || parsed.protocol !== "https:") {
      throw Object.assign(new Error("Bu istek reddedildi."), { statusCode: 403 });
    }
  }

  isAllowedHostHeader(hostHeader) {
    try {
      const parsed = new URL(`https://${String(hostHeader || "")}`);
      const allowedHosts = new Set([...this.addresses, "127.0.0.1", "localhost"]);
      return allowedHosts.has(parsed.hostname) && Number(parsed.port || 443) === Number(this.port || 443);
    } catch {
      return false;
    }
  }

  allowPrompt(sessionId) {
    const now = Date.now();
    const previous = this.rateLimits.get(sessionId) || [];
    const recent = previous.filter((time) => now - time < 60 * 60 * 1000);
    if (recent.length && now - recent[recent.length - 1] < 1500) return false;
    if (recent.length >= 60) return false;
    recent.push(now);
    this.rateLimits.set(sessionId, recent);
    return true;
  }

  clientState(sessionId) {
    return {
      connected: true,
      context: this.context,
      approvals: [...this.approvals.values()].filter((item) => item.sessionId === sessionId).map(({ sessionId: _, runId, requestId, ...item }) => item),
      messages: this.messages.filter((item) => item.sessionId === sessionId).slice(-MAX_MESSAGES).map(({ sessionId: _sessionId, target, ...item }) => ({ ...item, target: target ? { projectId: target.projectId, projectName: target.projectName, engineId: target.engineId, model: target.model, approvalMode: target.approvalMode } : null }))
    };
  }

  async options(session) {
    const catalog = await this.getCatalog?.() || { projects: [], engines: [] };
    const projects = (catalog.projects || []).map(({ id, name, trusted }) => ({ id, name, trusted: trusted === true }));
    const engines = (catalog.engines || []).map(({ id, name, installed, authenticated }) => ({ id, name: name || id, installed: !!installed, authenticated: !!authenticated }));
    const defaults = {
      projectId: projects.find((p) => p.id === this.context.projectId && p.trusted)?.id || projects.find((p) => p.trusted)?.id || "",
      engineId: engines.find((e) => e.id === this.context.engineId && e.installed && e.authenticated)?.id || engines.find((e) => e.installed && e.authenticated)?.id || "",
      model: this.context.model === "__auto__" ? "" : this.context.model || "", approvalMode: this.context.approvalMode || "ask"
    };
    return { projects, engines, selection: session.selection || defaults };
  }

  async models(engineId) {
    const catalog = await this.getCatalog();
    if (!catalog.engines.some((e) => e.id === engineId && e.installed && e.authenticated)) {
      throw Object.assign(new Error("Bu sağlayıcı hazır değil. Masaüstünde kurulum ve giriş durumunu kontrol edin."), { statusCode: 400 });
    }
    let rows;
    try { rows = await this.getModels(engineId); }
    catch { throw Object.assign(new Error("Model listesi alınamadı. Masaüstündeki sağlayıcı bağlantısını kontrol edip yeniden deneyin."), { statusCode: 502 }); }
    return (rows || []).map((m) => typeof m === "string" ? { id: m, label: m } : { id: m.id, label: m.label || m.name || m.id }).filter((m) => m.id && m.id !== "__auto__");
  }

  async validateSelection(selection) {
    const catalog = await this.getCatalog();
    const project = catalog.projects.find((p) => p.id === selection?.projectId);
    if (!project?.trusted) throw Object.assign(new Error("Güvenilen bir proje seçin. Proje güvenini masaüstünden verebilirsiniz."), { statusCode: 400 });
    const models = await this.models(String(selection?.engineId || ""));
    const model = String(selection?.model || "");
    if (model && !models.some((m) => m.id === model)) throw Object.assign(new Error("Seçilen model bu sağlayıcıda bulunamadı."), { statusCode: 400 });
    if (!["ask", "auto_edit", "plan"].includes(selection?.approvalMode)) throw Object.assign(new Error("Geçersiz onay modu."), { statusCode: 400 });
    return { projectId: project.id, projectPath: project.path, projectName: project.name, engineId: selection.engineId, model, approvalMode: selection.approvalMode };
  }

  bindRun(requestId, runId, target) {
    const item = this.messages.find((m) => m.id === requestId && !m.finished && !m.runId);
    if (!item || (item.target && (path.resolve(item.target.projectPath) !== path.resolve(target.projectPath) || item.target.engineId !== target.engineId || item.target.model !== target.model || item.target.approvalMode !== target.approvalMode))) {
      throw new Error("Mobil görev seçimleri çalışma ile eşleşmiyor.");
    }
    item.runId = runId;
  }

  handleAgentEvent(runId, event) {
    if (event.type === "finished" || event.type === "approval-resolved") {
      for (const [id, pending] of this.approvals) if (pending.runId === runId && (event.type === "finished" || pending.requestId === event.requestId)) this.approvals.delete(id);
    }
    if (event.type !== "approval-request") return;
    const item = this.messages.find((m) => m.runId === runId && !m.finished);
    if (!item || !this.sessions.has(item.sessionId)) return;
    if ([...this.approvals.values()].some((p) => p.runId === runId && p.requestId === event.requestId)) return;
    const id = crypto.randomUUID();
    const approval = event.approval || {};
    this.approvals.set(id, { id, runId, requestId: event.requestId, messageId: item.id, sessionId: item.sessionId,
      title: String(approval.title || "İşlem onayı gerekiyor"), reason: String(approval.reason || ""),
      command: String(approval.command || ""), cwd: String(approval.cwd || ""), changes: approval.changes || [] });
  }

  updateMessage(payload = {}) {
    const item = this.messages.find((message) => message.id === String(payload.requestId || ""));
    if (!item) return false;
    if (payload.runId) item.runId = String(payload.runId);
    if (payload.status) item.status = String(payload.status).slice(0, 160);
    if (payload.answer != null) item.answer = String(payload.answer).slice(0, 100000);
    if (payload.error != null) item.error = String(payload.error).slice(0, 1000);
    if (payload.finished != null) item.finished = Boolean(payload.finished);
    item.updatedAt = new Date().toISOString();
    return true;
  }

  async revokeAll() {
    this.sessions.clear();
    this.rateLimits.clear();
    this.approvals.clear();
    await this.persistSessions();
    return this.status();
  }

  async handleRequest(req, res) {
    const securityHeaders = {
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      // Chromium serializes a form POST's Origin as "null" under no-referrer.
      // Keep the real origin for this same-origin pairing form while still
      // withholding referrers from every cross-origin destination.
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
    };
    if (!this.isAllowedHostHeader(req.headers.host)) {
      return textResponse(res, 421, "text/plain; charset=utf-8", "Geçersiz sunucu adresi.", securityHeaders);
    }
    const url = new URL(req.url || "/", `https://${req.headers.host}`);

    if ((req.method === "GET" || req.method === "POST") && url.pathname.startsWith("/pair/")) {
      const token = url.pathname.slice("/pair/".length);
      const expiresAt = this.pairings.get(token);
      if (!expiresAt || expiresAt <= Date.now()) {
        this.pairings.delete(token);
        return textResponse(res, 410, "text/html; charset=utf-8", PAIRED_OUT_HTML, securityHeaders);
      }
      // QR readers and messaging apps often prefetch links. A GET must never
      // consume the one-use secret, otherwise the real browser sees an expired QR.
      if (req.method === "GET") {
        return textResponse(res, 200, "text/html; charset=utf-8", pairingHtml(token), securityHeaders);
      }
      this.assertSameOrigin(req);
      this.pairings.delete(token);
      const id = randomToken(12);
      const secret = randomToken(32);
      const now = Date.now();
      this.sessions.set(id, {
        id,
        secretHash: sha256(secret),
        createdAt: now,
        lastSeen: now,
        expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
        device: String(req.headers["user-agent"] || "Mobil cihaz").slice(0, 240)
      });
      await this.persistSessions();
      res.writeHead(303, {
        Location: `/#session=${encodeURIComponent(`${id}.${secret}`)}`,
        "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(`${id}.${secret}`)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        ...securityHeaders
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/app.css") return textResponse(res, 200, "text/css; charset=utf-8", MOBILE_CSS, securityHeaders);
    if (req.method === "GET" && url.pathname === "/app.js") return textResponse(res, 200, "text/javascript; charset=utf-8", MOBILE_JS, securityHeaders);
    if (req.method === "GET" && url.pathname === "/paired-out") return textResponse(res, 200, "text/html; charset=utf-8", PAIRED_OUT_HTML, securityHeaders);
    // Load the static shell even if a mobile browser rejects the cookie for a
    // self-signed certificate. The URL fragment supplies a tab-local fallback
    // bearer and is removed before any API request or referrer can expose it.
    if (req.method === "GET" && url.pathname === "/") return textResponse(res, 200, "text/html; charset=utf-8", MOBILE_HTML, securityHeaders);

    const session = this.authenticate(req);
    if (!session) {
      return jsonResponse(res, 401, { error: "Oturum kapalı. Yeni QR kodu okutun." }, securityHeaders);
    }

    if (req.method === "GET" && url.pathname === "/api/state") return jsonResponse(res, 200, this.clientState(session.id), securityHeaders);

    if (req.method === "GET" && url.pathname === "/api/options") return jsonResponse(res, 200, await this.options(session), securityHeaders);
    if (req.method === "GET" && url.pathname === "/api/models" && this.getCatalog) return jsonResponse(res, 200, { models: await this.models(url.searchParams.get("engineId")) }, securityHeaders);

    if (req.method === "POST" && (url.pathname === "/api/selection" || url.pathname.startsWith("/api/approvals/"))) {
      this.assertSameOrigin(req);
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return jsonResponse(res, 415, { error: "Yalnızca JSON kabul edilir." }, securityHeaders);
      const body = await readJson(req);
      if (url.pathname === "/api/selection") {
        const target = await this.validateSelection(body);
        session.selection = { projectId: target.projectId, engineId: target.engineId, model: target.model, approvalMode: target.approvalMode };
        await this.persistSessions();
        return jsonResponse(res, 200, { selection: session.selection }, securityHeaders);
      }
      const id = url.pathname.slice("/api/approvals/".length);
      const pending = this.approvals.get(id);
      if (!pending || pending.sessionId !== session.id) return jsonResponse(res, 404, { error: "Onay isteği artık etkin değil." }, securityHeaders);
      if (!["accept", "decline"].includes(body.decision)) return jsonResponse(res, 400, { error: "Geçersiz onay kararı." }, securityHeaders);
      if (pending.responding) return jsonResponse(res, 409, { error: "Bu onay yanıtlanıyor." }, securityHeaders);
      pending.responding = true;
      try {
        const accepted = await this.onApproval?.({ runId: pending.runId, requestId: pending.requestId, decision: body.decision });
        this.approvals.delete(id);
        return jsonResponse(res, accepted ? 200 : 409, accepted ? { accepted: true } : { error: "Onay isteği artık etkin değil." }, securityHeaders);
      } catch (error) { pending.responding = false; throw error; }
    }

    if (req.method === "POST" && url.pathname === "/api/messages") {
      this.assertSameOrigin(req);
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        return jsonResponse(res, 415, { error: "Yalnızca JSON kabul edilir." }, securityHeaders);
      }
      if (!this.allowPrompt(session.id)) return jsonResponse(res, 429, { error: "Çok hızlı istek gönderildi. Biraz bekleyin." }, securityHeaders);
      const body = await readJson(req);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return jsonResponse(res, 400, { error: "Görev boş olamaz." }, securityHeaders);
      if (prompt.length > MAX_PROMPT_LENGTH) return jsonResponse(res, 413, { error: `Görev en fazla ${MAX_PROMPT_LENGTH} karakter olabilir.` }, securityHeaders);
      const target = this.getCatalog ? await this.validateSelection(body.selection || session.selection || (await this.options(session)).selection) : null;
      const history = this.messages.filter((m) => m.sessionId === session.id && m.finished && !m.error && m.target?.projectId === target?.projectId).slice(-8).flatMap((m) => [{ role: "user", content: m.prompt.slice(0, 4000) }, { role: "assistant", content: m.answer.slice(0, 4000) }]);
      const item = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        prompt,
        target,
        answer: "",
        status: "Masaüstüne gönderiliyor…",
        error: "",
        finished: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.messages.push(item);
      if (this.messages.length > MAX_MESSAGES * 4) this.messages.splice(0, this.messages.length - MAX_MESSAGES * 4);
      try {
        await this.onPrompt?.({ requestId: item.id, prompt, sessionId: session.id, target, history });
      } catch (error) {
        item.status = "Gönderilemedi";
        item.error = error.message || "Masaüstü uygulamasına ulaşılamadı.";
        item.finished = true;
      }
      return jsonResponse(res, 202, { accepted: true, requestId: item.id }, securityHeaders);
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      this.assertSameOrigin(req);
      this.sessions.delete(session.id);
      for (const [id, pending] of this.approvals) if (pending.sessionId === session.id) this.approvals.delete(id);
      await this.persistSessions();
      res.writeHead(204, {
        "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        ...securityHeaders
      });
      res.end();
      return;
    }

    return jsonResponse(res, 404, { error: "Bulunamadı." }, securityHeaders);
  }
}

module.exports = {
  MobileBridge,
  listLanIPv4,
  parseCookies,
  sha256,
  MAX_PROMPT_LENGTH,
  PAIRING_TTL_MS
};
