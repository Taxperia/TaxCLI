const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.argv[2] || "playwright");
const { MobileBridge } = require("../electron/mobile-bridge");

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-mobile-browser-"));
  let browser;
  const prompts = [], requests = [], errors = [], targets = [], approvals = [];
  const bridge = new MobileBridge({
    storagePath: path.join(temporary, "sessions.json"), tlsPath: path.join(temporary, "tls.json"),
    protect: async (value) => Buffer.from(String(value)).toString("base64"),
    unprotect: async (value) => Buffer.from(String(value), "base64").toString(),
    host: "127.0.0.1", port: 0, getAddresses: () => ["127.0.0.1"],
    getCatalog: async () => ({ projects: [{ id: "one", name: "Mobil test projesi", path: path.join(temporary, "one"), trusted: true }, { id: "two", name: "İkinci proje", path: path.join(temporary, "two"), trusted: true }], engines: [{ id: "codex", name: "Codex", installed: true, authenticated: true }, { id: "claude", name: "Claude Code", installed: true, authenticated: true }] }),
    getModels: async (engine) => engine === "codex" ? [{ id: "sol", label: "GPT Sol" }, { id: "astra", label: "GPT Astra" }] : [{ id: "sonnet", label: "Claude Sonnet" }],
    onApproval: async (payload) => {
      approvals.push(payload);
      bridge.handleAgentEvent(payload.runId, { type: "approval-resolved", requestId: payload.requestId });
      bridge.updateMessage({ requestId: targets[0].requestId, answer: "Mobil test yanıtı", status: "Tamamlandı", finished: true });
      return true;
    },
    onPrompt: async (payload) => {
      prompts.push(payload.prompt);
      targets.push(payload);
      bridge.bindRun(payload.requestId, "fixture-run", payload.target);
      bridge.handleAgentEvent("fixture-run", { type: "approval-request", requestId: "fixture-approval", approval: { title: "Testleri çalıştır", command: "npm test", cwd: payload.target.projectPath } });
      bridge.updateMessage({ requestId: payload.requestId, status: "İşlem onayı bekleniyor…" });
    }
  });
  try {
    const pairing = await bridge.createPairing({ projectName: "Mobil test projesi", engineName: "Test sağlayıcısı", agentName: "Kodlayıcı" });
    browser = await chromium.launch({ headless: true, channel: process.env.TAXCLI_TEST_BROWSER || "chrome" });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
    const phone = await context.newPage();
    phone.on("pageerror", (error) => errors.push(error.message));
    phone.on("request", (request) => {
      if (request.method() === "POST") requests.push({ path: new URL(request.url()).pathname.startsWith("/pair/") ? "/pair/[token]" : new URL(request.url()).pathname, origin: request.headers().origin || "(missing)" });
    });
    await phone.goto(pairing.pairUrl);
    const navigation = phone.waitForNavigation({ waitUntil: "domcontentloaded" });
    await phone.getByRole("button", { name: "Telefonu bağla", exact: true }).click();
    const response = await navigation;
    assert.equal(response.status(), 200, `Pairing navigation failed; browser POST origin: ${requests[0]?.origin}`);
    await phone.locator("#prompt").waitFor();
    await phone.waitForFunction(() => document.querySelector("#project")?.textContent === "Mobil test projesi");
    assert.equal(bridge.status().sessionCount, 1);
    assert.equal(await phone.locator("dialog[open]").count(), 0);
    assert.equal(await phone.locator("#send").isEnabled(), false);
    await phone.locator("#projectPicker").click();
    await phone.locator("#projectPanel").waitFor();
    assert.equal(await phone.locator("dialog[open] select").count(), 1);
    assert.equal(await phone.locator("#mobileEngine").isVisible(), false);
    assert.equal(await phone.locator("#mobileApproval").isVisible(), false);
    assert.equal(await phone.evaluate(() => document.activeElement.id), "mobileProject");
    await phone.locator("#mobileProject").selectOption("two");
    await phone.locator("#projectPanel .sheet-done").click();
    assert.equal(await phone.evaluate(() => document.activeElement.id), "projectPicker");
    await phone.locator("#modelPicker").click();
    await phone.locator("#modelPanel").waitFor();
    assert.equal(await phone.locator("dialog[open] select").count(), 2);
    assert.equal(await phone.locator("#mobileProject").isVisible(), false);
    assert.equal(await phone.locator("#mobileApproval").isVisible(), false);
    await phone.locator("#mobileEngine").selectOption("claude");
    await phone.waitForFunction(() => document.querySelector('#mobileModel option[value="sonnet"]'));
    await phone.locator("#mobileModel").selectOption("sonnet");
    await phone.locator("#mobileEngine").selectOption("codex");
    await phone.waitForFunction(() => document.querySelector('#mobileModel option[value="astra"]'));
    await phone.locator("#mobileModel").selectOption("astra");
    await phone.locator("#modelPanel .sheet-done").click();
    assert.equal(await phone.locator("dialog[open]").count(), 0);
    assert.equal(await phone.evaluate(() => document.activeElement.id), "modelPicker");
    await phone.waitForFunction(() => document.querySelector("#modelLabel").textContent === "GPT Astra");
    await phone.locator("#approvalPicker").click();
    await phone.locator("#approvalPanel").waitFor();
    assert.equal(await phone.locator("dialog[open] select").count(), 1);
    assert.equal(await phone.locator("#mobileProject").isVisible(), false);
    assert.equal(await phone.locator("#mobileModel").isVisible(), false);
    assert.equal(await phone.evaluate(() => document.activeElement.id), "mobileApproval");
    await phone.locator("#mobileApproval").selectOption("plan");
    await phone.locator("#mobileApproval").selectOption("auto_edit");
    await phone.keyboard.press("Escape");
    assert.equal(await phone.locator("#approvalPicker").getAttribute("data-mode"), "auto_edit");
    await phone.locator("#approvalPicker").click();
    await phone.locator("#mobileApproval").selectOption("ask");
    await phone.locator('#approvalPanel [aria-label="İzin seçimini kapat"]').click();
    await phone.locator("#modelPicker").click();
    assert.equal(await phone.evaluate(() => document.activeElement.id), "mobileModel");
    await phone.keyboard.press("Escape");
    await phone.locator("#prompt").fill("Mevcut taslağım");
    await phone.locator("#taskSettings").click();
    await phone.locator("#taskPanel").waitFor();
    assert.equal(await phone.locator("dialog[open] select").count(), 0);
    await phone.getByRole("button", { name: "Projeyi incele", exact: false }).click();
    assert.equal(await phone.locator("dialog[open]").count(), 0);
    assert.match(await phone.locator("#prompt").inputValue(), /^Mevcut taslağım\n\nProjenin yapısını incele/);
    assert.equal(await phone.evaluate(() => document.activeElement.id), "prompt");
    assert.equal(prompts.length, 0, "Task shortcuts should only add to the draft");
    const panelIds = await phone.evaluate(() => ["projectPicker", "modelPicker", "approvalPicker", "taskSettings"].map((id) => document.getElementById(id).getAttribute("aria-controls")));
    assert.equal(new Set(panelIds).size, 4);
    await phone.locator("#prompt").fill("Telefondan test görevi");
    await phone.locator("#prompt").press("Enter");
    assert.equal(prompts.length, 0, "Mobile Enter should add a newline, not submit the task");
    await phone.getByRole("button", { name: "Gönder", exact: true }).click();
    await phone.getByRole("button", { name: "Bir kez izin ver", exact: true }).click();
    await phone.waitForFunction(() => document.querySelector(".answer")?.textContent === "Mobil test yanıtı");
    assert.deepEqual(prompts, ["Telefondan test görevi"]);
    assert.equal(targets[0].target.projectId, "two");
    assert.equal(targets[0].target.model, "astra");
    assert.equal(targets[0].target.approvalMode, "ask");
    assert.deepEqual(approvals, [{ runId: "fixture-run", requestId: "fixture-approval", decision: "accept" }]);
    assert.equal(await phone.locator(".approval").count(), 0);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: pairing.baseUrl });
    await phone.getByRole("button", { name: "Yanıtı kopyala", exact: true }).click();
    assert.equal(await phone.evaluate(() => navigator.clipboard.readText()), "Mobil test yanıtı");
    assert.equal(requests.find((request) => request.path === "/pair/[token]")?.origin, pairing.baseUrl);
    assert.ok(requests.every((request) => request.origin === pairing.baseUrl || request.origin === "(missing)"), JSON.stringify(requests));
    assert.equal(await phone.evaluate(() => location.hash), "");
    const screenshot = path.join(os.tmpdir(), "taxcli-mobile-connected.png");
    await phone.screenshot({ path: screenshot, fullPage: true });
    // A short, narrow viewport also covers the layout with the phone keyboard open.
    await phone.setViewportSize({ width: 320, height: 480 });
    await phone.locator("#prompt").fill("Çok satırlı taslak\n".repeat(12));
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const sendBox = await phone.locator("#send").boundingBox();
    assert.ok(sendBox.x >= 0 && sendBox.x + sendBox.width <= 320 && sendBox.y + sendBox.height <= 480);
    await phone.locator("#modelPicker").click();
    const sheetBox = await phone.locator("#modelPanel").boundingBox();
    assert.ok(sheetBox.x >= 0 && sheetBox.y >= 0 && sheetBox.width <= 320 && sheetBox.height <= 480);
    await phone.locator("#modelPanel .sheet-done").click();
    assert.equal(await phone.locator("#prompt").inputValue(), "Çok satırlı taslak\n".repeat(12));
    await phone.locator("#prompt").fill("");
    await phone.setViewportSize({ width: 393, height: 851 });
    // Some mobile browsers reject cookies for a self-signed local certificate.
    // The tab-local bearer obtained at pairing must survive a reload on its own.
    await context.clearCookies();
    await phone.reload();
    await phone.locator("#prompt").waitFor();
    await phone.waitForFunction(() => document.querySelector(".answer")?.textContent === "Mobil test yanıtı");
    await phone.waitForFunction(() => document.querySelector("#mobileModel")?.value === "astra");
    assert.equal(await phone.locator("#mobileProject").inputValue(), "two");
    await phone.locator("#moreButton").click();
    assert.equal(await phone.locator("#moreButton").getAttribute("aria-expanded"), "true");
    await phone.keyboard.press("Escape");
    assert.equal(await phone.locator("#connectionMenu").isVisible(), false);
    await phone.locator("#moreButton").click();
    await phone.getByRole("menuitem", { name: "Bu telefondan çıkış yap", exact: true }).click();
    await phone.waitForURL("**/paired-out");
    assert.equal(bridge.status().sessionCount, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: "passed", chatLayout: true, distinctButtonPanels: true, taskShortcutPreservesDraft: true, compactSelectors: true, accessibleSettingsSheet: true, narrowViewport: true, responseCopy: true, nativeFormPairing: true, browserOriginVerified: true, projectAndProviderModelSelection: true, approvalModes: true, remoteOperationApproval: true, preferencesPersist: true, mobilePromptAndAnswer: true, cookielessReloadSession: true, logout: true, screenshot }));
  } finally {
    await browser?.close();
    await bridge.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
