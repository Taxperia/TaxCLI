const fs = require("node:fs/promises");
const path = require("node:path");
const marketplace = require("../src/mcp-marketplace");

const MANAGED_PREFIX = "taxcli-";
const MAX_CONFIG_BYTES = 128 * 1024;

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function managedName(id) {
  const clean = String(id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 60);
  if (!clean) throw new Error("MCP kimliği geçersiz.");
  return `${MANAGED_PREFIX}${clean}`;
}

function expandServer(server, workspace) {
  return {
    command: String(server.command || ""),
    args: (Array.isArray(server.args) ? server.args : []).map((arg) => String(arg).replaceAll("${workspace}", workspace))
  };
}

function normalizeManagedConfig(value, workspace) {
  const parsed = marketplace.parseConfig(value);
  const catalogById = new Map(marketplace.catalog.map((item) => [item.id, item]));
  const servers = {};
  for (const id of Object.keys(parsed.mcpServers)) {
    const item = catalogById.get(id);
    if (!item?.verified) throw new Error(`Doğrulanmamış MCP sunucusu reddedildi: ${id}`);
    const requested = parsed.mcpServers[id];
    if (requested.command !== item.server.command || JSON.stringify(requested.args || []) !== JSON.stringify(item.server.args || [])) {
      throw new Error(`MCP kataloğu değiştirilmiş görünüyor: ${id}`);
    }
    servers[managedName(id)] = expandServer(item.server, workspace);
  }
  return servers;
}

async function readJson(filePath, fallback = {}) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_CONFIG_BYTES) throw new Error(`${path.basename(filePath)} çok büyük.`);
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`${path.basename(filePath)} okunamadı: ${error.message}`);
  }
}

async function writeJsonInside(root, relativePath, value) {
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target)) throw new Error("MCP yapılandırma yolu proje dışına çıktı.");
  const parent = path.dirname(target);
  const parentInfo = await fs.lstat(parent).catch(() => null);
  if (parentInfo?.isSymbolicLink()) throw new Error("MCP yapılandırma klasörü sembolik bağlantı olamaz.");
  await fs.mkdir(parent, { recursive: true });
  const temporary = `${target}.taxcli.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, target);
  return target;
}

function removeManagedEntries(source = {}) {
  return Object.fromEntries(Object.entries(source || {}).filter(([name]) => !name.startsWith(MANAGED_PREFIX)));
}

class McpIntegrationManager {
  constructor({ onAudit = null } = {}) {
    this.onAudit = onAudit;
  }

  async validateProject(projectPath) {
    const root = path.resolve(String(projectPath || ""));
    const info = await fs.lstat(root).catch(() => null);
    if (!projectPath || !info?.isDirectory() || info.isSymbolicLink()) throw new Error("Geçerli proje klasörü seçin.");
    return root;
  }

  async apply(projectPath, configValue) {
    const root = await this.validateProject(projectPath);
    const servers = normalizeManagedConfig(configValue, root);
    const names = Object.keys(servers);

    const geminiPath = path.join(root, ".gemini", "settings.json");
    const gemini = await readJson(geminiPath, {});
    gemini.mcpServers = { ...removeManagedEntries(gemini.mcpServers), ...servers };
    gemini.mcp = { ...(gemini.mcp || {}), allowed: [...new Set([...(gemini.mcp?.allowed || []).filter((name) => !String(name).startsWith(MANAGED_PREFIX)), ...names])] };
    await writeJsonInside(root, ".gemini/settings.json", gemini);

    const cursorPath = path.join(root, ".cursor", "mcp.json");
    const cursor = await readJson(cursorPath, {});
    cursor.mcpServers = { ...removeManagedEntries(cursor.mcpServers), ...servers };
    await writeJsonInside(root, ".cursor/mcp.json", cursor);

    const copilotPath = path.join(root, ".mcp.json");
    const copilot = await readJson(copilotPath, {});
    copilot.mcpServers = {
      ...removeManagedEntries(copilot.mcpServers),
      ...Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, { type: "stdio", ...server, tools: ["*"] }]))
    };
    await writeJsonInside(root, ".mcp.json", copilot);

    const state = { version: 1, updatedAt: new Date().toISOString(), names, files: [".gemini/settings.json", ".cursor/mcp.json", ".mcp.json"] };
    await writeJsonInside(root, ".taxcli/mcp-state.json", state);
    await this.onAudit?.("mcp.apply", { projectPath: root, servers: names });
    return state;
  }

  async status(projectPath) {
    const root = await this.validateProject(projectPath);
    return readJson(path.join(root, ".taxcli", "mcp-state.json"), { version: 1, names: [], files: [] });
  }

  runtime(projectPath, configValue) {
    const root = path.resolve(String(projectPath || ""));
    const servers = normalizeManagedConfig(configValue, root);
    const codexArgs = [];
    const opencodeMcp = {};
    const permission = {};
    for (const [name, server] of Object.entries(servers)) {
      codexArgs.push("-c", `mcp_servers.${name}.command=${JSON.stringify(server.command)}`);
      codexArgs.push("-c", `mcp_servers.${name}.args=${JSON.stringify(server.args)}`);
      opencodeMcp[name] = { type: "local", command: [server.command, ...server.args], enabled: true };
      permission[`${name}_*`] = "ask";
    }
    return {
      names: Object.keys(servers),
      codexArgs,
      opencodeConfig: { mcp: opencodeMcp, permission }
    };
  }
}

module.exports = { McpIntegrationManager, normalizeManagedConfig, managedName, removeManagedEntries };
