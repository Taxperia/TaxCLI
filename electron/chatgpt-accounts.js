const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const OPENAI_DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration";
const OPENAI_RESOURCE = "https://api.openai.com/v1";
const OPENAI_SCOPES = "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

function randomValue(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function parseJwtPart(value) {
  try { return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")); }
  catch { throw new Error("OpenAI kimlik belirteci okunamadı."); }
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("OpenAI kimlik belirteci geçersiz.");
  return {
    header: parseJwtPart(parts[0]),
    payload: parseJwtPart(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url")
  };
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(30000) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const requestId = response.headers?.get?.("openai-request-id") || response.headers?.get?.("x-request-id") || "";
    const detail = body?.error_description || body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI oturum isteği başarısız: ${detail}${requestId ? ` (${requestId})` : ""}`);
  }
  return body;
}

async function discoverOpenAi(fetchImpl) {
  const discovery = await fetchJson(fetchImpl, OPENAI_DISCOVERY_URL);
  if (discovery.issuer !== "https://auth.openai.com") throw new Error("OpenAI kimlik sağlayıcısı doğrulanamadı.");
  if (!/^https:\/\/auth\.openai\.com\//.test(String(discovery.authorization_endpoint || ""))) throw new Error("OpenAI yetkilendirme adresi geçersiz.");
  if (!/^https:\/\/auth\.openai\.com\//.test(String(discovery.token_endpoint || ""))) throw new Error("OpenAI token adresi geçersiz.");
  if (!/^https:\/\/auth\.openai\.com\//.test(String(discovery.jwks_uri || ""))) throw new Error("OpenAI imza anahtarı adresi geçersiz.");
  return discovery;
}

async function verifyIdToken(fetchImpl, discovery, idToken, { clientId, nonce = null, subject = null } = {}) {
  const parsed = parseJwt(idToken);
  if (parsed.header.alg !== "RS256" || !parsed.header.kid) throw new Error("OpenAI kimlik belirteci desteklenmeyen bir imza kullanıyor.");
  const jwks = await fetchJson(fetchImpl, discovery.jwks_uri);
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((item) => item.kid === parsed.header.kid && item.kty === "RSA") : null;
  if (!jwk) throw new Error("OpenAI kimlik imza anahtarı bulunamadı.");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto.verify("RSA-SHA256", Buffer.from(parsed.signingInput), publicKey, parsed.signature);
  if (!verified) throw new Error("OpenAI kimlik belirtecinin imzası doğrulanamadı.");

  const claims = parsed.payload;
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== discovery.issuer) throw new Error("OpenAI kimlik sağlayıcısı eşleşmedi.");
  if (!audience.includes(clientId)) throw new Error("OpenAI kimlik belirtecinin hedefi eşleşmedi.");
  if (!Number.isFinite(claims.exp) || claims.exp < now - 5) throw new Error("OpenAI kimlik belirtecinin süresi dolmuş.");
  if (!Number.isFinite(claims.iat) || claims.iat > now + 5) throw new Error("OpenAI kimlik belirtecinin zamanı geçersiz.");
  if (!claims.sub || typeof claims.sub !== "string") throw new Error("OpenAI hesap kimliği bulunamadı.");
  if (nonce !== null && claims.nonce !== nonce) throw new Error("OpenAI giriş doğrulaması eşleşmedi.");
  if (subject !== null && claims.sub !== subject) throw new Error("OpenAI hesabı seçilen kayıtla eşleşmedi.");
  return claims;
}

function publicAccount(record) {
  return {
    id: record.id,
    label: record.label,
    email: record.email || "",
    name: record.name || "",
    picture: record.picture || "",
    clientId: record.clientId,
    scopes: Array.isArray(record.scopes) ? record.scopes : [],
    expiresAt: Number(record.expiresAt) || 0,
    connected: Boolean(record.encryptedCredentials),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

class ChatGptAccountStore {
  constructor({ filePath, protect, unprotect }) {
    this.filePath = filePath;
    this.protect = protect;
    this.unprotect = unprotect;
    this.state = null;
  }

  async load() {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.state = {
        version: 1,
        hostId: /^urn:uuid:[0-9a-f-]{36}$/i.test(String(parsed.hostId || "")) ? parsed.hostId : `urn:uuid:${crypto.randomUUID()}`,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts.filter((item) => item?.id && item?.clientId) : []
      };
    } catch {
      this.state = { version: 1, hostId: `urn:uuid:${crypto.randomUUID()}`, accounts: [] };
      await this.persist();
    }
    return this.state;
  }

  async persist() {
    if (!this.state) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
    try { await fs.rename(tempPath, this.filePath); }
    catch {
      await fs.rm(this.filePath, { force: true });
      await fs.rename(tempPath, this.filePath);
    }
  }

  async list() {
    const state = await this.load();
    return state.accounts.map(publicAccount);
  }

  async hostId() {
    return (await this.load()).hostId;
  }

  async getRecord(accountId) {
    const state = await this.load();
    return state.accounts.find((item) => item.id === accountId) || null;
  }

  async getCredentials(accountId) {
    const record = await this.getRecord(accountId);
    if (!record?.encryptedCredentials) throw new Error("Seçilen ChatGPT hesabı bağlı değil.");
    try { return JSON.parse(await this.unprotect(record.encryptedCredentials)); }
    catch { throw new Error("ChatGPT hesabının güvenli oturumu açılamadı. Hesabı yeniden bağlayın."); }
  }

  async saveAccount({ accountId, clientId, identity, tokens, scopes, label }) {
    const state = await this.load();
    const existingIndex = state.accounts.findIndex((item) => item.id === accountId);
    const existing = existingIndex >= 0 ? state.accounts[existingIndex] : null;
    const now = new Date().toISOString();
    const savedAtMs = Date.parse(tokens.saved_at || now) || Date.now();
    const expiresAt = savedAtMs + Math.max(0, Number(tokens.expires_in) || 0) * 1000;
    const credentials = {
      ...tokens,
      saved_at: tokens.saved_at || now,
      client_id: clientId,
      issuer: identity.iss,
      subject: identity.sub,
      ext_agent_host_id: state.hostId,
      scopes
    };
    const baseLabel = String(label || existing?.label || identity.name || identity.email || "ChatGPT hesabı").trim().slice(0, 72);
    const occupiedLabels = new Set(state.accounts.filter((item) => item.id !== existing?.id).map((item) => String(item.label || "").toLocaleLowerCase("tr-TR")));
    let distinctLabel = baseLabel;
    let labelIndex = 2;
    while (occupiedLabels.has(distinctLabel.toLocaleLowerCase("tr-TR"))) {
      distinctLabel = `${baseLabel} (${labelIndex})`.slice(0, 80);
      labelIndex += 1;
    }
    const record = {
      id: existing?.id || accountId || crypto.randomUUID(),
      label: distinctLabel,
      email: String(identity.email || existing?.email || "").slice(0, 254),
      name: String(identity.name || existing?.name || "").slice(0, 120),
      picture: /^https:\/\//.test(String(identity.picture || "")) ? String(identity.picture).slice(0, 1000) : "",
      clientId,
      subject: identity.sub,
      issuer: identity.iss,
      scopes,
      expiresAt,
      encryptedCredentials: await this.protect(JSON.stringify(credentials)),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existingIndex >= 0) state.accounts[existingIndex] = record;
    else state.accounts.push(record);
    await this.persist();
    return publicAccount(record);
  }

  async remove(accountId) {
    const state = await this.load();
    const before = state.accounts.length;
    state.accounts = state.accounts.filter((item) => item.id !== accountId);
    if (state.accounts.length !== before) await this.persist();
    return state.accounts.length !== before;
  }

  async clear() {
    this.state = { version: 1, hostId: `urn:uuid:${crypto.randomUUID()}`, accounts: [] };
    await fs.rm(this.filePath, { force: true });
  }
}

function callbackHtml(success, message) {
  const safe = String(message || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  return `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TaxCLI</title><style>body{font:16px system-ui;background:#101417;color:#e8eee9;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:480px;padding:32px;border:1px solid #2d3931;border-radius:18px;background:#151c18;text-align:center}h1{font-size:22px;color:${success ? "#a9f58c" : "#ff9393"}}p{line-height:1.55;color:#aab5ad}</style><div class="box"><h1>${success ? "ChatGPT hesabı bağlandı" : "Bağlantı tamamlanamadı"}</h1><p>${safe}</p><p>Bu sekmeyi kapatıp TaxCLI'ye dönebilirsiniz.</p></div></html>`;
}

function waitForOAuthCallback() {
  let timer;
  let settled = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.replace(/\/+$/, "") !== "/auth/callback") {
      response.writeHead(404).end();
      return;
    }
    if (settled) {
      response.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false, "Bu giriş bağlantısı daha önce kullanıldı."));
      return;
    }
    settled = true;
    clearTimeout(timer);
    resolveResult({
      params: url.searchParams,
      respond: (success, message) => {
        if (response.writableEnded) return;
        response.writeHead(success ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(callbackHtml(success, message));
        setImmediate(() => server.close());
      }
    });
  });
  server.on("error", rejectResult);
  server.listen(0, "127.0.0.1");
  const ready = new Promise((resolve, reject) => {
    server.once("listening", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/auth/callback`);
    });
    server.once("error", reject);
  });
  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    server.close();
    rejectResult(new Error("ChatGPT girişi tamamlanmadı. Tarayıcıdaki izin ekranını bitirip yeniden deneyin; giriş sırasında TaxCLI'yi kapatmayın."));
  }, LOGIN_TIMEOUT_MS);
  timer.unref?.();
  return { ready, result, close: () => { clearTimeout(timer); server.close(); } };
}

class ChatGptAccountManager {
  constructor({ store, fetchImpl = globalThis.fetch, openExternal }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.openExternal = openExternal;
    this.refreshes = new Map();
    this.loginActive = false;
  }

  list() { return this.store.list(); }

  async login({ accountId = "", label = "" } = {}) {
    if (this.loginActive) throw new Error("Başka bir ChatGPT hesabı için giriş zaten devam ediyor.");
    this.loginActive = true;
    const callback = waitForOAuthCallback();
    let callbackResult = null;
    try {
      const discovery = await discoverOpenAi(this.fetchImpl);
      const existing = accountId ? await this.store.getRecord(accountId) : null;
      if (accountId && !existing) throw new Error("Yeniden bağlanacak ChatGPT hesabı bulunamadı.");
      const existingCredentials = existing ? await this.store.getCredentials(existing.id).catch(() => null) : null;
      const redirectUri = await callback.ready;
      const state = randomValue();
      const nonce = randomValue();
      const codeVerifier = randomValue(48);
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      const clientId = existing?.clientId || "dynamic_agent_client";
      const authorize = new URL(discovery.authorization_endpoint);
      const params = {
        client_id: clientId,
        ext_agent_host_id: await this.store.hostId(),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: OPENAI_SCOPES,
        resource: OPENAI_RESOURCE,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: codeChallenge
      };
      if (!existing) params.agent_name_hint = "TaxCLI";
      if (existingCredentials?.id_token) params.id_token_hint = existingCredentials.id_token;
      if (existing?.email) params.login_hint = existing.email;
      authorize.search = new URLSearchParams(params).toString();
      await this.openExternal(authorize.toString());

      callbackResult = await callback.result;
      const returned = callbackResult.params;
      if (returned.get("state") !== state) throw new Error("ChatGPT giriş durumu eşleşmedi.");
      if (returned.get("error")) throw new Error(returned.get("error_description") || "ChatGPT girişi iptal edildi.");
      const code = returned.get("code");
      const returnedClientId = returned.get("client_id");
      const issuedClientId = existing?.clientId || returnedClientId;
      if (!code || !issuedClientId || issuedClientId === "dynamic_agent_client") throw new Error("OpenAI hesap kaydı tamamlanamadı.");
      if (existing && returnedClientId && returnedClientId !== existing.clientId) throw new Error("OpenAI hesap kaydı seçilen hesapla eşleşmedi.");

      const tokens = await fetchJson(this.fetchImpl, discovery.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: issuedClientId,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          resource: OPENAI_RESOURCE
        })
      });
      if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) throw new Error("OpenAI gerekli oturum bilgilerini döndürmedi.");
      const scopes = String(tokens.scope || returned.get("scope") || "").split(/\s+/).filter(Boolean);
      if (!scopes.includes("chatgpt.tokens.use.direct")) throw new Error("Bu hesap ChatGPT planıyla AI kullanımına izin vermedi.");
      const identity = await verifyIdToken(this.fetchImpl, discovery, tokens.id_token, {
        clientId: issuedClientId,
        nonce,
        subject: existing?.subject || null
      });
      const account = await this.store.saveAccount({
        accountId: existing?.id || crypto.randomUUID(),
        clientId: issuedClientId,
        identity,
        tokens: { ...tokens, saved_at: new Date().toISOString() },
        scopes,
        label
      });
      callbackResult.respond(true, `${account.label} TaxCLI ofisine güvenli biçimde bağlandı.`);
      return account;
    } catch (error) {
      callbackResult?.respond(false, error.message);
      throw error;
    } finally {
      callback.close();
      this.loginActive = false;
    }
  }

  async refresh(accountId) {
    if (this.refreshes.has(accountId)) return this.refreshes.get(accountId);
    const operation = (async () => {
      const record = await this.store.getRecord(accountId);
      if (!record) throw new Error("Seçilen ChatGPT hesabı bulunamadı.");
      const credentials = await this.store.getCredentials(accountId);
      if (!credentials.refresh_token) throw new Error("ChatGPT oturumu yenilenemiyor. Hesabı yeniden bağlayın.");
      const discovery = await discoverOpenAi(this.fetchImpl);
      const tokens = await fetchJson(this.fetchImpl, discovery.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: record.clientId,
          refresh_token: credentials.refresh_token,
          resource: OPENAI_RESOURCE
        })
      });
      const merged = {
        ...credentials,
        ...tokens,
        refresh_token: tokens.refresh_token || credentials.refresh_token,
        id_token: tokens.id_token || credentials.id_token,
        saved_at: new Date().toISOString()
      };
      const scopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
      const effectiveScopes = scopes.length ? scopes : record.scopes;
      if (!effectiveScopes.includes("chatgpt.tokens.use.direct")) throw new Error("ChatGPT plan kullanım izni artık etkin değil.");
      let identity = { iss: record.issuer, sub: record.subject, email: record.email, name: record.name, picture: record.picture };
      if (tokens.id_token) identity = await verifyIdToken(this.fetchImpl, discovery, tokens.id_token, { clientId: record.clientId, subject: record.subject });
      await this.store.saveAccount({ accountId, clientId: record.clientId, identity, tokens: merged, scopes: effectiveScopes, label: record.label });
      return merged;
    })();
    this.refreshes.set(accountId, operation);
    try { return await operation; }
    finally { this.refreshes.delete(accountId); }
  }

  async accessToken(accountId) {
    const record = await this.store.getRecord(accountId);
    if (!record) throw new Error("Seçilen ChatGPT hesabı bulunamadı.");
    let credentials = await this.store.getCredentials(accountId);
    if (!credentials.access_token || record.expiresAt <= Date.now() + 120000) credentials = await this.refresh(accountId);
    return credentials.access_token;
  }

  async remove(accountId) {
    const record = await this.store.getRecord(accountId);
    if (!record) return { removed: false, revoked: false };
    let revoked = false;
    try {
      const credentials = await this.store.getCredentials(accountId);
      const discovery = await discoverOpenAi(this.fetchImpl);
      if (credentials.refresh_token && discovery.revocation_endpoint) {
        const response = await this.fetchImpl(discovery.revocation_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: credentials.refresh_token, token_type_hint: "refresh_token", client_id: record.clientId })
        });
        revoked = response.ok;
      }
    } catch { revoked = false; }
    const removed = await this.store.remove(accountId);
    return { removed, revoked };
  }
}

function codexChatGptPlanArgs() {
  return [
    "-c", 'model_provider="openai_chatgpt_plan"',
    "-c", 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
    "-c", 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
    "-c", 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
    "-c", 'model_providers.openai_chatgpt_plan.wire_api="responses"',
    "-c", 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
    "-c", 'model_providers.openai_chatgpt_plan.supports_websockets=false'
  ];
}

module.exports = {
  ChatGptAccountManager,
  ChatGptAccountStore,
  codexChatGptPlanArgs,
  parseJwt,
  publicAccount,
  verifyIdToken
};
