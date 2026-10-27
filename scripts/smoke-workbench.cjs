const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.argv[2] || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TAXCLI_TEST_BROWSER || "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const project = "C:\\TestProject";
    const status = ["codex", "claude", "cursor", "copilot", "gemini", "opencode", "nvidia"].map((id) => ({ id, installed: true, authenticated: true, detail: "Test oturumu" }));
    const run = { id: "11111111-1111-4111-8111-111111111111", projectPath: project, workingPath: project, startedAt: new Date().toISOString(), status: "completed", engineId: "codex", model: "test-model", effort: "high", prompt: "UI smoke test", durationMs: 1500, changedFiles: 1, tokens: { total: 120, source: "provider" }, changes: [{ path: "src/example.js", kind: "modified", binary: false, before: "", after: "", hunks: [{ id: "h0", oldStart: 0, newStart: 0, oldLines: ["old\n"], newLines: ["new\n"] }], decisions: {} }], response: "Done", timeline: [{ kind: "command", detail: "npm test", elapsedMs: 10 }] };
    const data = { runs: [run], arenas: [], recipes: [{ id: "tests", name: "Test yaz", steps: ["Analyze", "Test"] }], branches: [], knowledge: [{ id: "doc-1", name: "API.md", projectPath: project, characters: 100, enabled: true }], health: [] };
    const listeners = [], events = [];
    window.__smokeEvents = events;
    const values = {
      listProjects: { projects: [{ id: "project-1", name: "Test Project", path: project }, ...Array.from({ length: 18 }, (_, i) => ({ id: `fixture-project-${i}`, name: `Fixture Project ${i + 1}`, path: `C:\\Fixture\\Project${i}` }))], selectedId: "project-1" },
      detectEngines: status,
      listModels: [{ id: "test-model", label: "Test Model" }, { id: "test-model-2", label: "Test Model 2" }],
      getProviderUsage: {}, getPluginStatus: {}, listChatGptAccounts: [],
      listHistoryConversations: { activeId: "main", conversations: [{ id: "main", title: "Test sohbet", createdAt: new Date().toISOString() }] },
      loadHistoryFile: [], getMobileStatus: { running: false },
      getTaskQueue: { tasks: [], paused: true }, listQueuedTasks: { tasks: [], paused: true },
      getSecurityStatus: { workspace: { trusted: true }, controls: {}, vault: [] }, getWorkspaceTrust: { trusted: true },
      listSnapshots: [], listVaultSecrets: [], listSecurityAudit: [], getMcpStatus: {},
      getGitStatus: { repository: false, files: [], log: [] }
    };
    window.agentHub = new Proxy({}, { get: (_target, key) => {
      if (key === "onAgentEvent") return (callback) => { listeners.push(callback); return () => {}; };
      if (key === "onMobilePrompt") return (callback) => { window.__mobilePrompt = callback; return () => {}; };
      if (key === "onUpdateEvent") return (callback) => { window.__updateEvent = callback; return () => {}; };
      if (key === "updateMobileMessage") return async (payload) => { events.push({ action: "mobileUpdate", ...payload }); return true; };
      if (String(key).startsWith("on")) return () => () => {};
      if (key === "prepareParallelWorkspaces") return async (payload) => ({ batchId: "test-batch", variants: payload.variants.map((variant, i) => ({ ...variant, projectPath: `C:\\Fixture\\variant-${i + 1}` })) });
      if (key === "materializeParallelWorkspace" || key === "cleanupParallelWorkspace") return async (payload) => { events.push({ action: key, variantId: payload.variantId }); return true; };
      if (key === "startAgent") return async (payload) => {
        events.push({ action: "startAgent", role: payload.workbenchRole || "agent", engineId: payload.engineId, model: payload.model, projectPath: payload.projectPath, replayId: payload.replayId, approvalMode: payload.approvalMode, mobileRequestId: payload.mobileRequestId });
        if (window.__smokeFailNextRun) { window.__smokeFailNextRun = false; throw new Error("Fixture startup failure"); }
        const runId = payload.runId || crypto.randomUUID();
        setTimeout(() => {
          const text = payload.workbenchRole === "judge" ? JSON.stringify({ winner: "variant-1", evaluations: [{ variantId: "variant-1", quality: 90, reason: "tested" }, { variantId: "variant-2", quality: 80, reason: "tested" }] }) : "Fixture solution";
          for (const callback of listeners) {
            callback({ runId, type: "started", engineId: payload.engineId });
            callback({ runId, type: "output", event: { kind: "json", engineId: payload.engineId, data: { type: "item.completed", item: { type: "agent_message", text } } } });
            callback({ runId, type: "finished", code: 0 });
          }
        }, 30);
        return { runId };
      };
      if (key === "workbenchRequest") return async (action, payload) => {
        if (action === "list") return data;
        if (action === "run") return run;
        if (action === "run-replay") return { engineId: "codex", model: "test-model", prompt: run.prompt, projectPath: "C:\\Fixture\\replay", displayProjectPath: project, replayId: "fixture-replay", history: [], images: [] };
        if (action === "replay-cleanup") { events.push({ action, replayId: payload.replayId }); return true; }
        if (action === "checks-plan") return [];
        if (action === "recipe-save") { data.recipes.push({ id: "custom", ...payload }); return payload; }
        if (action === "arena-create") { const arena = { ...payload, id: "fixture-arena", status: "running", createdAt: new Date().toISOString(), variants: payload.variants.map((variant, i) => ({ ...variant, alias: `Çözüm ${i + 1}`, status: "pending" })) }; data.arenas.unshift(arena); return arena; }
        if (action === "run-tests") { events.push({ action }); return { checks: [{ id: "test", code: 0 }] }; }
        if (action === "arena-result") { Object.assign(data.arenas[0].variants.find((v) => v.variantId === payload.variantId), { runId: payload.runId, status: "completed", durationMs: 100, tests: payload.tests }); return data.arenas[0]; }
        if (action === "arena-judge-prompt") return "Evaluate fixture solutions as JSON";
        if (action === "arena-judge-workspace") return { projectPath: "C:\\Fixture\\judge" };
        if (action === "arena-judgment") { const result = JSON.parse(payload.text); Object.assign(data.arenas[0], { winner: result.winner, status: "judged" }); return data.arenas[0]; }
        return {};
      };
      return async () => values[key] ?? {};
    } });
    localStorage.setItem("taxcli:onboarding-version", "1");
  });
  try {
    await page.goto(pathToFileURL(path.resolve(__dirname, "../src/index.html")).href);
    await page.waitForTimeout(600);
    await page.locator("#projectPath").evaluate((input) => { input.value = "C:\\TestProject"; });
    const lastProject = page.locator('[data-project-id="fixture-project-17"]');
    await lastProject.scrollIntoViewIfNeeded();
    const projectBox = await lastProject.boundingBox(), clickX = projectBox.x + 30, clickY = projectBox.y + projectBox.height / 2;
    await page.mouse.click(clickX, clickY, { button: "right" });
    const projectMenu = await page.locator("#projectContextMenu").boundingBox();
    assert.ok(Math.abs(projectMenu.x - clickX) <= 1);
    assert.ok(Math.abs(projectMenu.y - clickY) <= projectMenu.height + 8);
    assert.ok(projectMenu.x >= 0 && projectMenu.y >= 0 && projectMenu.x + projectMenu.width <= 1440 && projectMenu.y + projectMenu.height <= 1000);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#projectContextMenu").isVisible(), false);
    assert.equal(await lastProject.evaluate((el) => el === document.activeElement), true);
    await lastProject.click({ button: "right" });
    await page.locator("#projectList").hover();
    await page.mouse.wheel(0, -400);
    await page.waitForFunction(() => !document.querySelector("#projectContextMenu").classList.contains("open"));
    const assertNoEngineScroll = async () => {
      const layout = await page.locator("#engineStrip").evaluate((strip) => ({ wrap: getComputedStyle(strip).flexWrap, scrollWidth: strip.scrollWidth, width: strip.clientWidth, overflow: getComputedStyle(strip).overflowX }));
      assert.equal(layout.wrap, "wrap");
      assert.ok(layout.scrollWidth <= layout.width + 1);
      assert.equal(layout.overflow, "visible");
    };
    await assertNoEngineScroll();
    assert.equal(await page.locator(".composer-actions > .agent-anchor").count(), 1);
    await page.locator("#runTuningButton").click();
    assert.deepEqual(await page.locator(".tuning-category-button strong").allTextContents(), ["Profil", "Tür", "Efor"]);
    assert.equal(await page.locator(".tuning-submenu:visible").count(), 0);
    await page.locator('[data-tuning-menu="profile"]').hover();
    await page.locator("#agentDropdown").waitFor({ state: "visible" });
    await page.locator('[data-agent-id="analyst"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("agenthub:agent")), "analyst");
    await page.locator("#runTuningButton").click();
    await page.locator('[data-tuning-menu="type"]').hover();
    await page.locator('[data-routing-policy="quality"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("agenthub:routing-policy")), "quality");
    await page.locator("#runTuningButton").click();
    await page.locator('[data-tuning-menu="effort"]').hover();
    await page.locator('[data-effort="high"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("agenthub:effort")), "high");
    assert.equal(await page.locator("#runTuningLabel").textContent(), "Analiz · Kalite · Yüksek");
    await page.locator("#runTuningButton").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#agentDropdown").isVisible(), true);
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#agentButton").evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#runTuningButton").getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#runTuningButton").evaluate((el) => el === document.activeElement), true);
    await page.setViewportSize({ width: 1080, height: 720 });
    await assertNoEngineScroll();
    await page.locator("#runTuningButton").click();
    await page.locator('[data-tuning-menu="effort"]').hover();
    const rootMenu = await page.locator("#runTuningDropdown").boundingBox();
    const flyout = await page.locator("#tuningEffortMenu").boundingBox();
    assert.ok(flyout.x >= rootMenu.x + rootMenu.width - 2);
    assert.ok(flyout.x + flyout.width <= 1080 && flyout.y >= 0 && flyout.y + flyout.height <= 720);
    const tuningScreenshot = path.join(os.tmpdir(), "taxcli-tuning-dark.png");
    await page.screenshot({ path: tuningScreenshot });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const workspacePalette = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".main")).backgroundColor, side: getComputedStyle(document.querySelector(".sidebar")).backgroundColor, card: getComputedStyle(document.querySelector(".composer")).backgroundColor, image: getComputedStyle(document.querySelector(".main")).backgroundImage }));
    assert.equal(workspacePalette.image, "none");
    await page.locator('[data-view="userSettings"]').click();
    await page.evaluate(() => window.__updateEvent({ type: "progress", phase: "downloading", currentVersion: "0.1.0", version: "0.2.0", percent: 52, supported: true }));
    assert.match(await page.locator("#updateStatus").textContent(), /%52/);
    assert.equal(await page.locator("#installUpdate").isVisible(), false);
    await page.evaluate(() => window.__updateEvent({ type: "downloaded", phase: "downloaded", currentVersion: "0.1.0", version: "0.2.0", percent: 100, supported: true }));
    assert.equal(await page.locator("#installUpdate").isVisible(), true);
    await page.setViewportSize({ width: 900, height: 600 });
    const settingsNav = page.locator("#settingsNav");
    assert.equal(await settingsNav.evaluate((el) => getComputedStyle(el).scrollbarWidth), "none");
    assert.ok(await settingsNav.evaluate((el) => el.scrollHeight > el.clientHeight));
    await settingsNav.hover();
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => document.querySelector("#settingsNav").scrollTop > 0);
    await page.locator('[data-settings-section="general"]').click();
    await page.locator(".settings-content").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const closeSettingsBox = await page.locator("#settingsClose").boundingBox();
    const settingsContentBox = await page.locator(".settings-content").boundingBox();
    assert.ok(closeSettingsBox.y + closeSettingsBox.height <= settingsContentBox.y, "Close button must not cover scrolled settings controls");
    assert.ok(closeSettingsBox.x >= 0 && closeSettingsBox.y >= 0 && closeSettingsBox.x + closeSettingsBox.width <= 900 && closeSettingsBox.y + closeSettingsBox.height <= 600);
    assert.equal(await page.locator("#settingsClose").evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
    const settingsScreenshot = path.join(os.tmpdir(), "taxcli-settings-close.png");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: settingsScreenshot });
    await page.getByRole("button", { name: "Ayarları kapat", exact: true }).click();
    assert.equal(await page.locator("#workspaceView").isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-view="userSettings"]').click();
    await page.locator('[data-settings-section="appearance"]').click();
    const settingsPalette = await page.evaluate(() => { const s = getComputedStyle(document.querySelector(".settings-shell")); return { bg: s.getPropertyValue("--s-bg").trim(), side: s.getPropertyValue("--s-side").trim(), card: s.getPropertyValue("--s-card").trim() }; });
    assert.deepEqual(workspacePalette, { bg: "rgb(10, 10, 11)", side: "rgb(17, 17, 19)", card: "rgb(28, 28, 31)", image: "none" });
    assert.deepEqual(settingsPalette, { bg: "#0a0a0b", side: "#111113", card: "#1c1c1f" });
    await page.locator('[data-theme="midnight"]').click();
    await page.locator("#settingsBack").click();
    assert.notEqual(await page.locator(".main").evaluate((el) => getComputedStyle(el).backgroundImage), "none");
    assert.equal(await page.locator(".composer").evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains("theme-midnight"));
    await page.locator('[data-view="userSettings"]').click();
    await page.locator('[data-settings-section="appearance"]').click();
    await page.locator('[data-theme="dark"]').click();
    await page.locator("#settingsBack").click();
    await page.locator('[data-view="workbench"]').click();
    await page.locator('[data-wb-action="open-run"]').first().waitFor();
    await page.locator('[data-wb-action="open-run"]').first().click();
    await page.locator(".wb-file-diff").waitFor();
    assert.equal(await page.locator(".wb-line-added").textContent(), "+ new\n");
    await page.locator('[data-wb-hunk="0"]').check();
    await page.locator('[data-wb-tab="recipes"]').click();
    await page.locator('#wbRecipeForm [name="name"]').fill("Custom smoke recipe");
    await page.locator('#wbRecipeForm [name="steps"]').fill("Analyze\nImplement\nTest");
    await page.locator('#wbRecipeForm button[type="submit"]').click();
    await page.getByRole("heading", { name: "Custom smoke recipe" }).waitFor();
    for (const tab of ["arena", "runs", "health", "branches", "knowledge", "doctor", "sessions", "review"]) {
      await page.locator(`[data-wb-tab="${tab}"]`).click();
      assert.ok(await page.locator("#workbenchContent").innerText());
    }
    await page.locator('[data-view="workspace"]').click();
    await page.locator("#toolMenuButton").click();
    await page.locator("#openMultiAiTool").click();
    assert.equal(await page.locator("#multiAiModelsDropdown").isVisible(), false);
    await page.locator("#multiAiModelsButton").click();
    await page.locator('[data-multi-engine="codex"] [data-multi-model="test-model-2"]').waitFor();
    while (await page.locator("[data-multi-model-option]:checked").count()) await page.locator("[data-multi-model-option]:checked").first().uncheck();
    await page.locator('[data-multi-engine="codex"] [data-multi-model="test-model"]').check();
    await page.locator('[data-multi-engine="codex"] [data-multi-model="test-model-2"]').check();
    await page.locator("#multiAiModelSearch").fill("claude");
    assert.equal(await page.locator('[data-multi-engine="claude"]').isVisible(), true);
    assert.equal(await page.locator('[data-multi-engine="codex"]').isVisible(), false);
    assert.equal(await page.locator('[data-multi-engine="claude"] [data-multi-model="test-model"]:visible').count(), 1);
    assert.equal(await page.locator('[data-multi-model-row]:visible .engine-logo').count(), await page.locator('[data-multi-model-row]:visible').count());
    await page.locator("#multiAiModelSearch").fill("missing-model-that-does-not-exist");
    assert.equal(await page.locator("#multiAiNoMatches").isVisible(), true);
    await page.locator("#multiAiModelSearch").fill("");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#multiAiModelsDropdown").isVisible(), false);
    assert.equal(await page.locator("#multiAiSelectedModels button").count(), 2);
    await page.locator("#multiAiModelsButton").click();
    const comparisonScreenshot = path.join(os.tmpdir(), "taxcli-comparison-dropdown.png");
    await page.screenshot({ path: comparisonScreenshot });
    await page.locator("#multiAiModelsButton").click();
    await page.locator(".multi-ai-judge summary").click();
    await page.locator("#multiAiJudgeEngine").selectOption("codex");
    await page.locator("#startMultiAi").click();
    await page.locator("#prompt").fill("Implement a fixture function");
    await page.locator("#sendButton").click();
    await page.getByText("Hakem değerlendirdi", { exact: true }).waitFor();
    const events = await page.evaluate(() => window.__smokeEvents);
    assert.equal(events.filter((event) => event.action === "startAgent").length, 3);
    assert.equal(events.filter((event) => event.action === "run-tests").length, 2);
    assert.ok(events.findIndex((event) => event.action === "cleanupParallelWorkspace") < events.findIndex((event) => event.action === "materializeParallelWorkspace" && event.variantId === "variant-2"));
    await page.locator('[data-view="workspace"]').click();
    await page.locator('[data-remove-chip="multiAi"]').click();
    await page.locator("#prompt").fill("Normal run after arena");
    await page.locator("#sendButton").click();
    await page.waitForFunction(() => !document.querySelector("#sendButton").classList.contains("running") && document.querySelector("#conversation").textContent.includes("Fixture solution"));
    assert.equal(await page.locator(".message-content[data-record-id]").count(), 2);
    await page.locator('[data-view="workbench"]').click();
    await page.locator('[data-wb-tab="review"]').click();
    await page.locator('[data-wb-action="open-run"]').first().click();
    await page.locator('[data-wb-action="replay"]').click();
    await page.waitForFunction(() => window.__smokeEvents.some((event) => event.action === "replay-cleanup"));
    const replayEvent = await page.evaluate(() => window.__smokeEvents.find((event) => event.action === "startAgent" && event.replayId));
    assert.equal(replayEvent.projectPath, "C:\\Fixture\\replay");
    assert.equal(replayEvent.replayId, "fixture-replay");
    assert.equal(await page.locator("#projectPath").inputValue(), "C:\\TestProject");
    await page.locator('[data-view="workbench"]').click();
    await page.locator('[data-wb-action="open-run"]').first().click();
    await page.evaluate(() => { window.__smokeFailNextRun = true; });
    await page.locator('[data-wb-action="replay"]').click();
    await page.waitForFunction(() => window.__smokeEvents.filter((event) => event.action === "replay-cleanup").length === 2);
    assert.equal(await page.locator("#projectPath").inputValue(), "C:\\TestProject");
    await page.locator('[data-view="workbench"]').click();
    await page.locator('[data-wb-tab="arena"]').click();
    await page.locator('[data-view="workspace"]').click();
    await page.locator("#prompt").fill("Masaüstündeki taslak");
    const conversationBeforeMobile = await page.locator("#conversation").innerText();
    await page.evaluate(async () => window.__mobilePrompt({ requestId: "mobile-fixture", prompt: "Telefondan başka projede çalış", history: [], target: { projectPath: "C:\\MobileProject", engineId: "claude", model: "test-model-2", approvalMode: "plan" } }));
    const mobileRun = await page.evaluate(() => window.__smokeEvents.find((e) => e.mobileRequestId === "mobile-fixture"));
    assert.equal(mobileRun.projectPath, "C:\\MobileProject");
    assert.equal(mobileRun.engineId, "claude");
    assert.equal(mobileRun.model, "test-model-2");
    assert.equal(mobileRun.approvalMode, "plan");
    assert.equal(await page.locator("#projectPath").inputValue(), "C:\\TestProject");
    assert.equal(await page.locator("#prompt").inputValue(), "Masaüstündeki taslak");
    assert.equal(await page.locator("#conversation").innerText(), conversationBeforeMobile);
    assert.ok(await page.evaluate(() => window.__smokeEvents.some((e) => e.action === "mobileUpdate" && e.finished && e.answer === "Fixture solution")));
    await page.locator('[data-view="workbench"]').click();
    await page.locator('[data-wb-tab="arena"]').click();
    const screenshot = path.join(os.tmpdir(), "taxcli-workbench-smoke.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: "passed", groupedModelDropdown: true, automaticUpdateStatus: true, projectMenuAnchored: true, settingsCloseAlwaysVisible: true, hiddenScrollableSettingsNav: true, cascadingMenus: true, noProviderScrollbar: true, matchingDarkPalette: true, midnightThemePersists: true, tabs: 9, fixtureArenaRuns: 3, fixtureTests: 2, normalRunAfterArena: true, isolatedReplay: true, failedReplayCleanup: true, errors, comparisonScreenshot, tuningScreenshot, settingsScreenshot, screenshot }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
