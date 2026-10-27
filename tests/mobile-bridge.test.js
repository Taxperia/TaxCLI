const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { MobileBridge, parseCookies, sha256 } = require("../electron/mobile-bridge");

function localFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      rejectUnauthorized: false
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode,
          headers: { get: (name) => {
            const value = response.headers[String(name).toLowerCase()];
            return Array.isArray(value) ? value.join(", ") : value || null;
          } },
          text: async () => body,
          json: async () => JSON.parse(body || "{}")
        });
      });
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

test("mobile bridge helpers parse cookies and hash secrets consistently", () => {
  assert.deepEqual(parseCookies("one=1; taxcli_mobile=abc.def; theme=dark"), {
    one: "1",
    taxcli_mobile: "abc.def",
    theme: "dark"
  });
  assert.equal(sha256("secret"), sha256("secret"));
  assert.notEqual(sha256("secret"), sha256("other"));
});

test("mobile selections are validated per device and approvals belong to their originating session", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-mobile-options-"));
  const prompts = [], decisions = [];
  const projects = [{ id: "one", name: "One", path: path.join(root, "one"), trusted: true }, { id: "two", name: "Two", path: path.join(root, "two"), trusted: true }, { id: "locked", name: "Locked", path: root, trusted: false }];
  const bridge = new MobileBridge({ storagePath: path.join(root, "sessions.json"),
    protect: async (value) => Buffer.from(value).toString("base64"), unprotect: async (value) => Buffer.from(value, "base64").toString(),
    host: "127.0.0.1", port: 0, getAddresses: () => ["127.0.0.1"],
    getCatalog: async () => ({ projects, engines: [{ id: "codex", installed: true, authenticated: true }, { id: "claude", installed: true, authenticated: true }, { id: "cursor", installed: true, authenticated: false }] }),
    getModels: async (engine) => engine === "codex" ? [{ id: "sol", label: "Sol" }, { id: "astra", label: "Astra" }] : ["sonnet"],
    onPrompt: async (payload) => prompts.push(payload),
    onApproval: async (payload) => { decisions.push(payload); return true; }
  });
  t.after(async () => { await bridge.stop(); await fs.rm(root, { recursive: true, force: true }); });
  async function pair() {
    const pairing = await bridge.createPairing({ projectId: "one", engineId: "codex", model: "sol", approvalMode: "ask" });
    const res = await localFetch(pairing.pairUrl, { method: "POST", headers: { Origin: pairing.baseUrl } });
    return { base: pairing.baseUrl, cookie: res.headers.get("set-cookie").split(";")[0] };
  }
  const a = await pair(), b = await pair();
  async function request(device, route, body, origin = device.base) {
    return localFetch(device.base + route, { method: body ? "POST" : "GET", headers: { Cookie: device.cookie, Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  assert.equal((await localFetch(a.base + "/api/options")).status, 401);
  const options = await (await request(a, "/api/options")).json();
  assert.equal(options.selection.projectId, "one");
  assert.equal(options.projects[0].path, undefined);
  const selection = { projectId: "two", engineId: "codex", model: "astra", approvalMode: "auto_edit", projectPath: "C:\\attacker" };
  assert.equal((await request(a, "/api/selection", selection)).status, 200);
  const saved = JSON.parse(await fs.readFile(path.join(root, "sessions.json"), "utf8"));
  assert.equal(saved.sessions.find((s) => s.selection)?.selection.model, "astra");
  assert.equal((await (await request(b, "/api/options")).json()).selection.projectId, "one");
  for (const invalid of [{ projectId: "locked" }, { projectId: "missing" }, { engineId: "cursor" }, { model: "sonnet" }, { approvalMode: "bypass" }]) {
    assert.equal((await request(a, "/api/selection", { ...selection, ...invalid })).status, 400);
  }
  assert.equal((await request(a, "/api/selection", selection, "null")).status, 403);
  assert.equal((await request(a, "/api/selection", { ...selection, engineId: "claude", model: "sonnet", approvalMode: "plan" })).status, 200);
  assert.equal((await request(a, "/api/selection", selection)).status, 200);
  const sent = await request(a, "/api/messages", { prompt: "Work here" });
  assert.equal(sent.status, 202);
  const requestId = (await sent.json()).requestId;
  assert.equal(prompts[0].target.projectPath, projects[1].path);
  assert.equal(prompts[0].target.model, "astra");
  assert.equal(prompts[0].target.approvalMode, "auto_edit");
  assert.throws(() => bridge.bindRun(requestId, "bad", { ...prompts[0].target, engineId: "claude" }), /eşleşmiyor/);
  bridge.bindRun(requestId, "run-a", prompts[0].target);
  bridge.handleAgentEvent("run-a", { type: "approval-request", requestId: "native-1", approval: { title: "Run tests?", kind: "command", command: "npm test" } });
  const state = await (await request(a, "/api/state")).json();
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].runId, undefined);
  assert.equal(state.messages[0].target.projectPath, undefined);
  assert.equal((await (await request(b, "/api/state")).json()).approvals.length, 0);
  const route = "/api/approvals/" + state.approvals[0].id;
  assert.equal((await request(b, route, { decision: "accept" })).status, 404);
  assert.equal((await request(a, route, { decision: "accept" }, "https://evil.invalid")).status, 403);
  assert.equal((await request(a, route, { decision: "always" })).status, 400);
  assert.equal((await request(a, route, { decision: "accept", runId: "arbitrary" })).status, 200);
  assert.deepEqual(decisions, [{ runId: "run-a", requestId: "native-1", decision: "accept" }]);
  assert.equal((await request(a, route, { decision: "accept" })).status, 404);
  bridge.handleAgentEvent("run-a", { type: "approval-request", requestId: "native-2", approval: {} });
  bridge.handleAgentEvent("run-a", { type: "approval-resolved", requestId: "native-2" });
  assert.equal(bridge.clientState(prompts[0].sessionId).approvals.length, 0);
  bridge.handleAgentEvent("run-a", { type: "approval-request", requestId: "native-3", approval: {} });
  bridge.handleAgentEvent("run-a", { type: "finished" });
  assert.equal(bridge.clientState(prompts[0].sessionId).approvals.length, 0);
  // A revoked project's stale selection must be checked again at send time.
  projects[1].trusted = false;
  bridge.rateLimits.clear();
  assert.equal((await request(a, "/api/messages", { prompt: "Stale choice" })).status, 400);
  assert.equal(prompts.length, 1);
});

test("one-use QR pairing creates an authenticated mobile session", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-mobile-test-"));
  const prompts = [];
  const bridge = new MobileBridge({
    storagePath: path.join(tempRoot, "sessions.json"),
    tlsPath: path.join(tempRoot, "tls.json"),
    protect: async (value) => Buffer.from(String(value), "utf8").toString("base64"),
    unprotect: async (value) => Buffer.from(String(value), "base64").toString("utf8"),
    host: "127.0.0.1",
    port: 0,
    getAddresses: () => ["127.0.0.1"],
    onPrompt: async (payload) => prompts.push(payload)
  });
  t.after(async () => {
    await bridge.stop();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const pairing = await bridge.createPairing({ projectName: "Demo", engineName: "Codex", agentName: "Kodlayıcı" });
  assert.match(pairing.baseUrl, /^https:\/\//);
  assert.match(pairing.tlsFingerprint, /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  assert.match(pairing.qrDataUrl, /^data:image\/png;base64,/);
  assert.equal(pairing.sessionCount, 0);

  const rebindingResponse = await localFetch(pairing.pairUrl, { headers: { Host: `attacker.invalid:${pairing.port}` } });
  assert.equal(rebindingResponse.status, 421);

  // Link previews may GET a QR target before the user opens it. GET renders a
  // confirmation page and must not consume the one-use pairing token.
  const previewResponse = await localFetch(pairing.pairUrl, { redirect: "manual" });
  assert.equal(previewResponse.status, 200);
  assert.match(await previewResponse.text(), /Telefonu bağla/);
  assert.equal(previewResponse.headers.get("set-cookie"), null);
  assert.equal(previewResponse.headers.get("referrer-policy"), "same-origin");

  const secondPreviewResponse = await localFetch(pairing.pairUrl, { redirect: "manual" });
  assert.equal(secondPreviewResponse.status, 200);

  // Fix the browser's request policy, not the origin guard. Failed requests
  // must not consume the one-use QR or create any session.
  for (const origin of ["null", "https://attacker.invalid", pairing.baseUrl.replace("https:", "http:")]) {
    const rejected = await localFetch(pairing.pairUrl, { method: "POST", headers: { Origin: origin } });
    assert.equal(rejected.status, 403);
    assert.equal(bridge.status().sessionCount, 0);
    assert.equal((await localFetch(pairing.pairUrl)).status, 200);
  }

  const pairResponse = await localFetch(pairing.pairUrl, {
    method: "POST",
    headers: { Origin: pairing.baseUrl },
    redirect: "manual"
  });
  assert.equal(pairResponse.status, 303);
  const cookie = pairResponse.headers.get("set-cookie").split(";")[0];
  const location = pairResponse.headers.get("location");
  assert.match(cookie, /^taxcli_mobile=/);
  assert.match(pairResponse.headers.get("set-cookie"), /; Secure;/);
  assert.match(pairResponse.headers.get("set-cookie"), /SameSite=Lax/);
  assert.match(pairResponse.headers.get("set-cookie"), /Max-Age=604800/);
  assert.match(location, /^\/#session=/);

  const sessionToken = decodeURIComponent(location.split("#session=")[1]);
  const mobileShell = await localFetch(`${pairing.baseUrl}/`);
  assert.equal(mobileShell.status, 200);
  assert.match(await mobileShell.text(), /TaxCLI Mobil/);
  const bearerState = await localFetch(`${pairing.baseUrl}/api/state`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(bearerState.status, 200);

  const reusedPairing = await localFetch(pairing.pairUrl, { method: "POST", redirect: "manual" });
  assert.equal(reusedPairing.status, 410);

  const stateResponse = await localFetch(`${pairing.baseUrl}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(stateResponse.status, 200);
  const initialState = await stateResponse.json();
  assert.equal(initialState.context.projectName, "Demo");
  assert.deepEqual(initialState.messages, []);

  for (const origin of ["null", "https://attacker.invalid"]) {
    const rejected = await localFetch(`${pairing.baseUrl}/api/messages`, {
      method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Must not be forwarded" })
    });
    assert.equal(rejected.status, 403);
    assert.equal(prompts.length, 0);
    const logout = await localFetch(`${pairing.baseUrl}/api/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin } });
    assert.equal(logout.status, 403);
    assert.equal(bridge.status().sessionCount, 1);
  }

  const messageResponse = await localFetch(`${pairing.baseUrl}/api/messages`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: pairing.baseUrl,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: "Testleri çalıştır" })
  });
  assert.equal(messageResponse.status, 202);
  const accepted = await messageResponse.json();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].prompt, "Testleri çalıştır");

  assert.equal(bridge.updateMessage({ requestId: accepted.requestId, answer: "Tamam", status: "Tamamlandı", finished: true }), true);
  const updatedResponse = await localFetch(`${pairing.baseUrl}/api/state`, { headers: { Cookie: cookie } });
  const updatedState = await updatedResponse.json();
  assert.equal(updatedState.messages[0].answer, "Tamam");
  assert.equal(updatedState.messages[0].finished, true);
});
