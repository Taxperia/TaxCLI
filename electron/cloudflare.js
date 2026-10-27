"use strict";

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGES = 100;

class CloudflareApiError extends Error {
  constructor(message, { status = null, code = null, details = [] } = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = Number.isFinite(Number(status)) ? Number(status) : null;
    this.code = Number.isFinite(Number(code)) ? Number(code) : null;
    this.details = Array.isArray(details) ? details : [];
  }
}

function requireToken(token) {
  const value = String(token || "").trim();
  if (!value) throw new CloudflareApiError("Cloudflare API tokeni gerekli.");
  return value;
}

function safeText(value, token) {
  const text = String(value || "");
  return token ? text.split(token).join("[REDACTED]") : text;
}

function normalizeApiErrors(errors, token) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 10).map((error) => ({
    code: Number.isFinite(Number(error?.code)) ? Number(error.code) : null,
    message: safeText(error?.message || "Cloudflare API hatası", token)
  }));
}

function normalizeAccount(account = {}) {
  return {
    id: String(account.id || ""),
    name: String(account.name || "Adsız hesap"),
    type: account.type ? String(account.type) : null,
    createdOn: account.created_on || null
  };
}

function normalizeZone(zone = {}) {
  const plan = zone.plan && typeof zone.plan === "object" ? zone.plan : {};
  return {
    id: String(zone.id || ""),
    name: String(zone.name || ""),
    status: zone.status ? String(zone.status) : "unknown",
    paused: Boolean(zone.paused),
    type: zone.type ? String(zone.type) : null,
    developmentMode: Number.isFinite(Number(zone.development_mode))
      ? Number(zone.development_mode)
      : null,
    account: zone.account && typeof zone.account === "object"
      ? { id: String(zone.account.id || ""), name: String(zone.account.name || "") }
      : null,
    plan: {
      id: plan.id ? String(plan.id) : null,
      name: plan.name ? String(plan.name) : null,
      price: Number.isFinite(Number(plan.price)) ? Number(plan.price) : null,
      currency: plan.currency ? String(plan.currency) : null,
      frequency: plan.frequency ? String(plan.frequency) : null,
      legacyId: plan.legacy_id ? String(plan.legacy_id) : null,
      isSubscribed: Boolean(plan.is_subscribed)
    },
    nameServers: Array.isArray(zone.name_servers)
      ? zone.name_servers.map(String)
      : [],
    originalNameServers: Array.isArray(zone.original_name_servers)
      ? zone.original_name_servers.map(String)
      : [],
    createdOn: zone.created_on || null,
    modifiedOn: zone.modified_on || null,
    activatedOn: zone.activated_on || null
  };
}

function createCloudflareClient({
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Cloudflare istemcisi için fetch fonksiyonu gerekli.");
  }
  const apiRoot = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const requestTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_TIMEOUT_MS;

  async function request(pathname, { token, query = null } = {}) {
    const secret = requireToken(token);
    const path = String(pathname || "");
    if (!path.startsWith("/") || /^\/\//.test(path)) {
      throw new CloudflareApiError("Geçersiz Cloudflare API yolu.");
    }
    const url = new URL(`${apiRoot}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } catch (error) {
      const timeout = error?.name === "AbortError";
      const message = timeout
        ? "Cloudflare bağlantısı zaman aşımına uğradı."
        : `Cloudflare bağlantısı kurulamadı: ${safeText(error?.message || "Bilinmeyen ağ hatası", secret)}`;
      throw new CloudflareApiError(message);
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new CloudflareApiError("Cloudflare API geçerli JSON döndürmedi.", {
        status: response.status
      });
    }

    const errors = normalizeApiErrors(payload?.errors, secret);
    if (!response.ok || payload?.success === false) {
      const first = errors[0];
      throw new CloudflareApiError(
        first?.message || `Cloudflare isteği başarısız oldu (HTTP ${response.status}).`,
        { status: response.status, code: first?.code, details: errors }
      );
    }
    return payload;
  }

  async function listAll(pathname, { token, query = {}, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const size = Math.max(1, Math.min(50, Number(pageSize) || DEFAULT_PAGE_SIZE));
    const results = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await request(pathname, {
        token,
        query: { ...query, page, per_page: size }
      });
      const batch = Array.isArray(payload?.result) ? payload.result : [];
      results.push(...batch);
      const info = payload?.result_info || {};
      const totalPages = Number(info.total_pages);
      if ((Number.isFinite(totalPages) && page >= totalPages) || batch.length < size) break;
    }
    return results;
  }

  return Object.freeze({
    async testConnection(token) {
      const payload = await request("/user/tokens/verify", { token });
      const result = payload?.result || {};
      return {
        valid: result.status === "active",
        status: result.status || "unknown",
        id: result.id || null,
        notBefore: result.not_before || null,
        expiresOn: result.expires_on || null
      };
    },

    async listAccounts(token, options = {}) {
      const accounts = await listAll("/accounts", {
        token,
        pageSize: options.pageSize
      });
      return accounts.map(normalizeAccount).filter((account) => account.id);
    },

    async listZones(token, options = {}) {
      const zones = await listAll("/zones", {
        token,
        pageSize: options.pageSize,
        query: {
          account_id: options.accountId || null,
          name: options.name || null,
          status: options.status || null
        }
      });
      return zones.map(normalizeZone).filter((zone) => zone.id);
    },

    async getZoneSummary(token, zoneId) {
      const id = String(zoneId || "").trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new CloudflareApiError("Geçerli bir Cloudflare zone kimliği gerekli.");
      }
      const payload = await request(`/zones/${encodeURIComponent(id)}`, { token });
      return normalizeZone(payload?.result || {});
    }
  });
}

module.exports = {
  CloudflareApiError,
  createCloudflareClient,
  normalizeAccount,
  normalizeZone
};
