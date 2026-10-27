const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentHub", {
  workbenchRequest: (action, payload) => ipcRenderer.invoke("workbench:request", action, payload),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: () => ipcRenderer.invoke("projects:add"),
  selectProject: (projectId) => ipcRenderer.invoke("projects:select", projectId),
  removeProject: (projectId) => ipcRenderer.invoke("projects:remove", projectId),
  detectEngines: () => ipcRenderer.invoke("engines:detect"),
  getProviderKey: (providerId) => ipcRenderer.invoke("providers:get-key", providerId),
  setProviderKey: (payload) => ipcRenderer.invoke("providers:set-key", payload),
  clearProviderKey: (providerId) => ipcRenderer.invoke("providers:clear-key", providerId),
  listModels: (engineId) => ipcRenderer.invoke("models:list", engineId),
  getProviderUsage: () => ipcRenderer.invoke("usage:providers"),
  getPluginStatus: () => ipcRenderer.invoke("plugins:status"),
  loginPlugin: (pluginId) => ipcRenderer.invoke("plugin:login", pluginId),
  getCloudflareSummary: () => ipcRenderer.invoke("cloudflare:summary"),
  installEngine: (engineId) => ipcRenderer.invoke("engine:install", engineId),
  loginEngine: (engineId) => ipcRenderer.invoke("engine:login", engineId),
  listChatGptAccounts: () => ipcRenderer.invoke("chatgpt-accounts:list"),
  loginChatGptAccount: async (payload) => {
    const result = await ipcRenderer.invoke("chatgpt-accounts:login", payload);
    if (!result?.ok) throw new Error(result?.error || "ChatGPT hesabı bağlanamadı.");
    return result.account;
  },
  removeChatGptAccount: (accountId) => ipcRenderer.invoke("chatgpt-accounts:remove", accountId),
  generateMemory: (payload) => ipcRenderer.invoke("memory:generate", payload),
  chooseImages: () => ipcRenderer.invoke("images:choose"),
  importImages: (payload) => ipcRenderer.invoke("images:import", payload),
  listHistoryConversations: (projectPath) => ipcRenderer.invoke("history:list", projectPath),
  loadHistoryFile: (projectPath) => ipcRenderer.invoke("history:load", projectPath),
  saveHistoryFile: (payload) => ipcRenderer.invoke("history:save", payload),
  clearHistoryFile: (projectPath) => ipcRenderer.invoke("history:clear", projectPath),
  setActiveHistoryConversation: (payload) => ipcRenderer.invoke("history:activate", payload),
  prepareParallelWorkspaces: (payload) => ipcRenderer.invoke("parallel:prepare", payload),
  materializeParallelWorkspace: (payload) => ipcRenderer.invoke("parallel:materialize", payload),
  cleanupParallelWorkspace: (payload) => ipcRenderer.invoke("parallel:cleanup", payload),
  prepareOfficeWorkspaces: (payload) => ipcRenderer.invoke("office:prepare", payload),
  startAgent: (payload) => ipcRenderer.invoke("agent:start", payload),
  stopAgent: (runId) => ipcRenderer.invoke("agent:stop", runId),
  respondToApproval: (payload) => ipcRenderer.invoke("agent:approval", payload),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  configureApp: (payload) => ipcRenderer.invoke("settings:apply", payload),
  listSnapshots: (projectPath) => ipcRenderer.invoke("snapshots:list", projectPath),
  createSnapshot: (payload) => ipcRenderer.invoke("snapshots:create", payload),
  restoreSnapshot: (payload) => ipcRenderer.invoke("snapshots:restore", payload),
  deleteSnapshot: (payload) => ipcRenderer.invoke("snapshots:delete", payload),
  getGitStatus: (projectPath) => ipcRenderer.invoke("git:status", projectPath),
  initializeGit: (projectPath) => ipcRenderer.invoke("git:init", projectPath),
  stageGitPaths: (payload) => ipcRenderer.invoke("git:stage", payload),
  unstageGitPaths: (payload) => ipcRenderer.invoke("git:unstage", payload),
  commitGit: (payload) => ipcRenderer.invoke("git:commit", payload),
  listQueuedTasks: () => ipcRenderer.invoke("queue:list"),
  enqueueTask: (payload) => ipcRenderer.invoke("queue:enqueue", payload),
  updateQueuedTask: (payload) => ipcRenderer.invoke("queue:update", payload),
  retryQueuedTask: (taskId) => ipcRenderer.invoke("queue:retry", taskId),
  removeQueuedTask: (taskId) => ipcRenderer.invoke("queue:remove", taskId),
  clearCompletedTasks: () => ipcRenderer.invoke("queue:clear-completed"),
  setTaskQueuePaused: (paused) => ipcRenderer.invoke("queue:set-paused", paused),
  applyProjectMcpConfig: (payload) => ipcRenderer.invoke("mcp:apply-project", payload),
  getProjectMcpStatus: (projectPath) => ipcRenderer.invoke("mcp:project-status", projectPath),
  getSecuritySummary: (projectPath) => ipcRenderer.invoke("security:summary", projectPath),
  getWorkspaceTrust: (projectPath) => ipcRenderer.invoke("security:workspace-status", projectPath),
  trustWorkspace: (projectPath) => ipcRenderer.invoke("security:trust-workspace", projectPath),
  revokeWorkspaceTrust: (projectPath) => ipcRenderer.invoke("security:revoke-workspace", projectPath),
  listVaultSecrets: () => ipcRenderer.invoke("security:vault-list"),
  setVaultSecret: (payload) => ipcRenderer.invoke("security:vault-set", payload),
  deleteVaultSecret: (id) => ipcRenderer.invoke("security:vault-delete", id),
  listSecurityAudit: (limit) => ipcRenderer.invoke("security:audit-list", limit),
  clearSecurityAudit: () => ipcRenderer.invoke("security:audit-clear"),
  exportSecurityAudit: () => ipcRenderer.invoke("security:audit-export"),
  recordSecurityEvent: (payload) => ipcRenderer.invoke("security:audit-record", payload),
  assessCommand: (command) => ipcRenderer.invoke("security:assess-command", command),
  getMobileStatus: () => ipcRenderer.invoke("mobile:status"),
  startMobileAccess: (context) => ipcRenderer.invoke("mobile:start", context),
  refreshMobilePairing: (context) => ipcRenderer.invoke("mobile:pairing", context),
  stopMobileAccess: () => ipcRenderer.invoke("mobile:stop"),
  revokeMobileSessions: () => ipcRenderer.invoke("mobile:revoke-all"),
  updateMobileContext: (context) => ipcRenderer.invoke("mobile:context", context),
  updateMobileMessage: (payload) => ipcRenderer.invoke("mobile:update", payload),
  clearLocalData: () => ipcRenderer.invoke("data:clear-local"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  getUpdateStatus: () => ipcRenderer.invoke("app:update-status"),
  downloadUpdate: () => ipcRenderer.invoke("app:download-update"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  startTerminal: (projectPath) => ipcRenderer.invoke("terminal:start", projectPath),
  writeTerminal: (terminalId, data) => ipcRenderer.invoke("terminal:write", terminalId, data),
  stopTerminal: (terminalId) => ipcRenderer.invoke("terminal:stop", terminalId),
  onTerminalEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:event", listener);
    return () => ipcRenderer.removeListener("terminal:event", listener);
  },
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onMobilePrompt: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("mobile:prompt", listener);
    return () => ipcRenderer.removeListener("mobile:prompt", listener);
  },
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update:event", listener);
    return () => ipcRenderer.removeListener("update:event", listener);
  }
});
