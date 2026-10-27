const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appServerNotificationToEvent,
  codexPermissionConfig,
  normalizeThreadItem
} = require("../electron/codex-app-server");

test("ask mode gates every Codex write and command behind read-only approvals", () => {
  assert.deepEqual(codexPermissionConfig("ask"), {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "read-only"
  });
});

test("auto edit permits workspace changes while preserving boundary approvals", () => {
  assert.deepEqual(codexPermissionConfig("auto_edit"), {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write"
  });
});

test("plan mode cannot escalate into a mutation", () => {
  assert.deepEqual(codexPermissionConfig("plan"), {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "read-only"
  });
});

test("app-server events keep the renderer's existing event contract", () => {
  assert.deepEqual(
    appServerNotificationToEvent({ method: "item/agentMessage/delta", params: { delta: "Merhaba" } }),
    { type: "item.agentMessage.delta", delta: "Merhaba" }
  );
  assert.deepEqual(normalizeThreadItem({
    type: "commandExecution",
    command: "npm test",
    aggregatedOutput: "ok",
    exitCode: 0
  }), {
    type: "command_execution",
    command: "npm test",
    aggregatedOutput: "ok",
    aggregated_output: "ok",
    exitCode: 0,
    exit_code: 0
  });
});
