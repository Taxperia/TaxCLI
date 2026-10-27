const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { resolveAgent } = require("../../src/agent-profiles");
const { findSensitivePaths } = require("../../electron/workspace-services");
const { redactSensitive, securityPromptDirectives } = require("../../electron/security-center");

// Run the real IPC adapter, replacing only OS/provider boundaries. No installed
// CLI, account or network connection is touched by these tests.
async function agentStartHarness(workbench, mobileBridge = null) {
  const source = await fs.readFile(path.join(__dirname, "..", "..", "electron", "main.js"), "utf8");
  const start = source.indexOf('ipcMain.handle("agent:start"');
  const end = source.indexOf('ipcMain.handle("agent:stop"', start);
  let handler, invocation;
  const context = vm.createContext({
    fs, path, crypto, workbench, mobileBridge, resolveAgent, findSensitivePaths, redactSensitive, securityPromptDirectives,
    ipcMain: { handle: (_channel, value) => { handler = value; } },
    ENGINE_COMMANDS: { codex: { command: "codex" } }, activeRuns: new Map(), parallelBatches: new Map(),
    createSecurityCenter: () => ({ workspaceStatus: async () => ({ trusted: true }), audit: async () => {} }),
    createSnapshotManager: () => workbench.snapshots,
    resolveEngineInvocation: async () => ({ command: "fixture-codex", prefix: [] }),
    resolveCodexModel: (value) => value,
    sanitizeHistoryForPrompt: (value) => Array.isArray(value) ? value : [], readChatHistory: async () => [],
    buildImagePromptSuffix: () => "", buildPromptWithHistory: (prompt) => prompt,
    readProviderKeys: async () => ({}), enrichedEnv: () => ({}), withProviderEnv: () => ({}),
    startCodexAppServerRun: async (value) => { invocation = value; }, emitAgentEvent() {}
  });
  vm.runInContext(source.slice(start, end), context);
  return { start: (payload) => handler({ sender: {} }, payload), invocation: () => invocation };
}

module.exports = { agentStartHarness };
