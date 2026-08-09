const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentHub", {
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
  getPluginStatus: () => ipcRenderer.invoke("plugins:status"),
  loginPlugin: (pluginId) => ipcRenderer.invoke("plugin:login", pluginId),
  loginEngine: (engineId) => ipcRenderer.invoke("engine:login", engineId),
  generateMemory: (payload) => ipcRenderer.invoke("memory:generate", payload),
  chooseImages: () => ipcRenderer.invoke("images:choose"),
  importImages: (payload) => ipcRenderer.invoke("images:import", payload),
  loadHistoryFile: (projectPath) => ipcRenderer.invoke("history:load", projectPath),
  saveHistoryFile: (payload) => ipcRenderer.invoke("history:save", payload),
  startAgent: (payload) => ipcRenderer.invoke("agent:start", payload),
  stopAgent: (runId) => ipcRenderer.invoke("agent:stop", runId),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
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
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update:event", listener);
    return () => ipcRenderer.removeListener("update:event", listener);
  }
});
