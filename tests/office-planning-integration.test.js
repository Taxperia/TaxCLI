const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { resolveAgent } = require("../src/agent-profiles");
const { codexPermissionConfig } = require("../electron/codex-app-server");

function officeHarness(allowShell = true) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const start = source.indexOf("function officeAgentProfile(");
  const end = source.indexOf("async function finishOfficeJob(", start);
  let payload;
  const context = vm.createContext({
    crypto, userSettings: { allowShell }, approvalMode: "auto_edit", runMeta: new Map(),
    officeOutput: () => ({ innerHTML: "", dataset: {}, classList: { remove() {} } }),
    streamState: { delete() {} }, ensureAssistantParts() {}, setThinking() {}, updateOfficeMemberState() {},
    selectedEffortFor: () => "high",
    window: { agentHub: { startAgent: async (value) => {
      payload = value;
      if (!value.allowShell) throw new Error("Shell kapalı");
      return { runId: value.runId };
    } } }
  });
  vm.runInContext(source.slice(start, end), context);
  const job = { id: "office-test", projectPath: "C:\\test-project", conversationId: "main", prompt: "Implement feature", images: [], runIds: new Set() };
  const member = { id: "manager", name: "Manager", engineId: "codex", role: "manager" };
  return { start: () => context.startOfficeAgent(job, { member, phase: "planning", prompt: "Plan work", runPath: job.projectPath }), payload: () => payload };
}

test("office manager planning can start and keeps the provider in non-escalating read-only mode", async () => {
  const harness = officeHarness();
  const runId = await harness.start(), payload = harness.payload();
  assert.equal(runId, payload.runId);
  assert.equal(payload.allowShell, true);
  const agent = resolveAgent(payload.agentId, payload.routingPrompt, { plan: payload.approvalMode === "plan" });
  assert.equal(agent.profile.forceReadOnly, true);
  assert.deepEqual(codexPermissionConfig(payload.approvalMode), { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" });
});

test("office planning does not bypass an explicit user shell prohibition", async () => {
  const harness = officeHarness(false);
  await assert.rejects(harness.start(), /Shell kapalı/);
  assert.equal(harness.payload().allowShell, false);
});
