"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CloudflareApiError,
  createCloudflareClient,
  normalizeZone
} = require("../electron/cloudflare");
const fs = require("node:fs");
const path = require("node:path");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

test("Cloudflare bağlantı testi tokenı yalnızca Authorization başlığında taşır", async () => {
  const calls = [];
  const client = createCloudflareClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        success: true,
        result: { id: "token-id", status: "active", expires_on: "2027-01-01T00:00:00Z" }
      });
    }
  });
  const result = await client.testConnection("cf-secret-token");
  assert.equal(result.valid, true);
  assert.equal(result.status, "active");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer cf-secret-token");
  assert.doesNotMatch(calls[0].url, /cf-secret-token/);
  assert.match(calls[0].url, /\/user\/tokens\/verify$/);
});

test("hesapları sayfalayarak listeler ve yalnızca güvenli alanları döndürür", async () => {
  const pages = [];
  const client = createCloudflareClient({
    fetchImpl: async (url, options) => {
      assert.equal(options.method, "GET");
      const page = Number(new URL(url).searchParams.get("page"));
      pages.push(page);
      const items = page === 1
        ? [{ id: "a1", name: "Bir", type: "standard", secret: "ignore" }]
        : [{ id: "a2", name: "İki", type: "enterprise" }];
      return jsonResponse({ success: true, result: items, result_info: { total_pages: 2 } });
    }
  });
  const accounts = await client.listAccounts("token", { pageSize: 1 });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(accounts.map((account) => account.id), ["a1", "a2"]);
  assert.equal("secret" in accounts[0], false);
});

test("zone listesi hesap filtresi ile durum, plan ve nameserver özetini döndürür", async () => {
  let requestedUrl = "";
  const client = createCloudflareClient({
    fetchImpl: async (url) => {
      requestedUrl = url;
      return jsonResponse({
        success: true,
        result: [{
          id: "zone-1",
          name: "example.com",
          status: "active",
          paused: false,
          account: { id: "account-1", name: "Taxperia" },
          plan: { id: "free", name: "Free Website", price: 0, currency: "USD" },
          name_servers: ["alice.ns.cloudflare.com", "bob.ns.cloudflare.com"]
        }],
        result_info: { total_pages: 1 }
      });
    }
  });
  const zones = await client.listZones("token", { accountId: "account-1" });
  assert.equal(new URL(requestedUrl).searchParams.get("account_id"), "account-1");
  assert.equal(zones[0].status, "active");
  assert.equal(zones[0].plan.name, "Free Website");
  assert.deepEqual(zones[0].nameServers, ["alice.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
});

test("tek zone özetini salt-okunur GET çağrısıyla getirir", async () => {
  let request = null;
  const client = createCloudflareClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        success: true,
        result: {
          id: "abc_123",
          name: "example.net",
          status: "pending",
          plan: { name: "Pro" },
          name_servers: ["ns1.example.net"]
        }
      });
    }
  });
  const zone = await client.getZoneSummary("token", "abc_123");
  assert.equal(request.options.method, "GET");
  assert.match(request.url, /\/zones\/abc_123$/);
  assert.equal(zone.status, "pending");
  assert.equal(zone.plan.name, "Pro");
});

test("API ve ağ hatalarında tokenı hata metninden temizler", async () => {
  const secret = "very-secret-token";
  const apiClient = createCloudflareClient({
    fetchImpl: async () => jsonResponse({
      success: false,
      errors: [{ code: 1000, message: `Geçersiz ${secret}` }]
    }, 403)
  });
  await assert.rejects(
    apiClient.testConnection(secret),
    (error) => error instanceof CloudflareApiError
      && error.status === 403
      && !error.message.includes(secret)
      && error.message.includes("[REDACTED]")
  );

  const networkClient = createCloudflareClient({
    fetchImpl: async () => { throw new Error(`socket closed ${secret}`); }
  });
  await assert.rejects(networkClient.listAccounts(secret), (error) => !error.message.includes(secret));
});

test("zone normalizasyonu eksik API alanlarında güvenli varsayılanlar kullanır", () => {
  const zone = normalizeZone({ id: "z", name: "empty.example" });
  assert.equal(zone.status, "unknown");
  assert.deepEqual(zone.nameServers, []);
  assert.equal(zone.plan.name, null);
});

test("token ve zone kimliği doğrulaması fetch çağrısından önce yapılır", async () => {
  let calls = 0;
  const client = createCloudflareClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ success: true, result: {} });
    }
  });
  await assert.rejects(client.listAccounts(""), /tokeni gerekli/);
  await assert.rejects(client.getZoneSummary("token", "../../unsafe"), /zone kimliği/);
  assert.equal(calls, 0);
});

test("Electron entegrasyonu Cloudflare tokenini safeStorage ile şifreler", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  assert.match(source, /safeStorage\.encryptString\(apiKey\)/);
  assert.match(source, /cloudflareEncrypted/);
  assert.match(source, /ipcMain\.handle\("cloudflare:summary"/);
});
