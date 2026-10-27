const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const marketplace = require("../src/mcp-marketplace");
const { McpIntegrationManager } = require("../electron/mcp-integration");

async function readJson(root, relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
}

test("MCP integration writes verified project configs for supported CLIs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-mcp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".gemini"), { recursive: true });
  await fs.writeFile(path.join(root, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { personal: { command: "keep" } } }));

  let config = marketplace.addServer("", "memory");
  config = marketplace.addServer(config, "filesystem");
  const audits = [];
  const manager = new McpIntegrationManager({ onAudit: (event, details) => audits.push({ event, details }) });
  const state = await manager.apply(root, config);

  assert.deepEqual(state.names.sort(), ["taxcli-filesystem", "taxcli-memory"]);
  assert.deepEqual(state.files, [".gemini/settings.json", ".cursor/mcp.json", ".mcp.json"]);
  const gemini = await readJson(root, ".gemini/settings.json");
  const cursor = await readJson(root, ".cursor/mcp.json");
  const copilot = await readJson(root, ".mcp.json");
  assert.equal(gemini.mcpServers.personal.command, "keep");
  assert.ok(gemini.mcp.allowed.includes("taxcli-filesystem"));
  assert.equal(gemini.mcpServers["taxcli-filesystem"].args.at(-1), path.resolve(root));
  assert.equal(cursor.mcpServers["taxcli-memory"].command, "npx");
  assert.equal(copilot.mcpServers["taxcli-memory"].type, "stdio");
  assert.deepEqual(copilot.mcpServers["taxcli-memory"].tools, ["*"]);
  assert.equal(audits[0].event, "mcp.apply");

  const runtime = manager.runtime(root, config);
  assert.ok(runtime.codexArgs.some((value) => String(value).includes("mcp_servers.taxcli-memory.command")));
  assert.deepEqual(runtime.opencodeConfig.mcp["taxcli-memory"].command.slice(0, 3), ["npx", "-y", "@modelcontextprotocol/server-memory@2026.8.31"]);
  assert.equal(runtime.opencodeConfig.permission["taxcli-memory_*"], "ask");
});

test("MCP integration removes only TaxCLI-managed entries and rejects tampering", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-mcp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new McpIntegrationManager();
  await manager.apply(root, marketplace.addServer("", "memory"));
  await manager.apply(root, "");

  const gemini = await readJson(root, ".gemini/settings.json");
  assert.deepEqual(gemini.mcpServers, {});
  assert.deepEqual(gemini.mcp.allowed, []);
  await assert.rejects(
    manager.apply(root, JSON.stringify({ mcpServers: { memory: { command: "powershell", args: [] } } })),
    /değiştirilmiş/i
  );
  await assert.rejects(
    manager.apply(root, JSON.stringify({ mcpServers: { unverified: { command: "npx", args: [] } } })),
    /doğrulanmamış/i
  );
});
