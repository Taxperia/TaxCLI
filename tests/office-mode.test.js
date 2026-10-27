const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const office = require("../src/office-mode");

test("office team keeps one manager and unique employee ids", () => {
  const team = office.normalizeTeam([
    { id: "boss", name: "Ada", role: "manager", engineId: "codex" },
    { id: "boss", name: "İkinci", role: "manager", engineId: "gemini" },
    { id: "dev", name: "Mert", role: "developer", engineId: "codex" }
  ]);
  assert.equal(team.filter((member) => member.role === "manager").length, 1);
  assert.equal(new Set(team.map((member) => member.id)).size, team.length);
  assert.equal(office.workersOf(team).length, 2);
});

test("office members retain only valid ChatGPT account profile ids", () => {
  const accountId = "d6db8242-10bd-47eb-9656-f19fded972c5";
  assert.equal(office.normalizeMember({ role: "developer", accountId }).accountId, accountId);
  assert.equal(office.normalizeMember({ role: "developer", accountId: "../../auth.json" }).accountId, "");
});

test("office members retain safe character presets", () => {
  assert.equal(office.normalizeMember({ role: "designer", avatarPreset: "rose" }).avatarPreset, "rose");
  assert.equal(office.normalizeMember({ role: "designer", avatarPreset: "../../rose" }).avatarPreset, "");
});

test("office exposes separate frontend and backend specialties", () => {
  assert.match(office.roles.frontend.defaultInstructions, /arayüz/i);
  assert.match(office.roles.backend.defaultInstructions, /API/i);
  const roles = office.defaultTeam.map((member) => member.role);
  assert.ok(roles.includes("frontend"));
  assert.ok(roles.includes("backend"));
});

test("legacy office roles migrate instead of collapsing to quality reviewers", () => {
  const team = office.normalizeTeam([
    { id: "boss", name: "Ada", role: "lead" },
    { id: "frontend-old", name: "UI Uzmanı", role: "reviewer" },
    { id: "api-old", name: "API Uzmanı", role: "reviewer" },
    { id: "visual-old", name: "Tasarımcı", specialty: "visual designer" }
  ], { repairCollapsedRoles: true });

  assert.deepEqual(team.map((member) => member.role), ["manager", "frontend", "backend", "designer"]);
  assert.equal(office.normalizeMember({ role: "coder" }).role, "developer");
  assert.equal(office.normalizeMember({ role: "security-auditor" }).role, "security");
});

test("manager JSON plan is parsed and missing workers receive fallback assignments", () => {
  const team = office.normalizeTeam(office.defaultTeam.slice(0, 3));
  const plan = office.parsePlan(`\`\`\`json
  {"summary":"Böl ve doğrula","assignments":[{"workerId":"backend","task":"API'yi uygula","acceptance":"Testler geçsin"}],"integrationCriteria":["Test"]}
  \`\`\``, "Bir API geliştir", team);
  assert.equal(plan.summary, "Böl ve doğrula");
  assert.equal(plan.assignments.length, 2);
  assert.equal(plan.assignments.find((item) => item.workerId === "backend").task, "API'yi uygula");
  assert.ok(plan.assignments.find((item) => item.workerId === "frontend").task);
});

test("worker and synthesis prompts carry the office contract", () => {
  const team = office.normalizeTeam(office.defaultTeam);
  const worker = team.find((member) => member.role === "security");
  const workerPrompt = office.buildWorkerPrompt({
    task: "Uygulamayı geliştir",
    worker,
    assignment: { task: "Kimlik doğrulamayı incele", acceptance: "Tehdit modeli" },
    managerName: "Ada",
    workspacePath: "C:/variant/security"
  });
  assert.match(workerPrompt, /Projeyi değiştirme/);
  assert.match(workerPrompt, /Kimlik doğrulamayı incele/);

  const synthesis = office.buildSynthesisPrompt({
    task: "Uygulamayı geliştir",
    manager: office.managerOf(team),
    plan: { summary: "Plan", integrationCriteria: ["Güvenlik"] },
    results: [{ worker, workspacePath: "C:/variant/security", answer: "Bulgu", error: "" }]
  });
  assert.match(synthesis, /ANA PROJEYE uygula/);
  assert.match(synthesis, /Bulgu/);
});

test("planning prompt requires non-overlapping frontend and backend work", () => {
  const prompt = office.buildPlanningPrompt("Bir web sitesi geliştir", office.defaultTeam);
  assert.match(prompt, /frontend\/UI ile backend\/API-veri-auth/i);
  assert.match(prompt, /Aynı dosyayı iki çalışana değiştirtme/i);
  assert.match(prompt, /endpoint, veri şekli, hata biçimi/i);
});

test("office worker UI coalesces rapid toggles and throttles streamed markdown", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const dashboardSource = appSource.slice(appSource.indexOf("const officeWorkerToggleFrames"), appSource.indexOf("function officeOutput"));

  assert.match(appSource, /const richTextRenderTimers = new WeakMap\(\)/);
  assert.match(appSource, /compactWorker \? 120 : 32/);
  assert.match(dashboardSource, /button\.dataset\.toggleBusy === "1"/);
  assert.match(dashboardSource, /requestAnimationFrame/);
  assert.doesNotMatch(dashboardSource, /button\.innerHTML/);
  assert.match(styles, /\.office-worker-card \{ contain:layout paint;/);
  assert.match(styles, /\.office-worker-toggle\.busy \{ pointer-events:none;/);
});
