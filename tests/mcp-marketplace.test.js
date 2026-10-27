const test = require("node:test");
const assert = require("node:assert/strict");
const marketplace = require("../src/mcp-marketplace");

test("MCP marketplace adds and removes only catalog entries", () => {
  const config = marketplace.addServer("", "filesystem");
  const parsed = marketplace.parseConfig(config);
  assert.equal(parsed.mcpServers.filesystem.command, "npx");
  assert.equal(parsed.mcpServers.filesystem.args.at(-1), "${workspace}");
  assert.match(parsed.mcpServers.filesystem.args[1], /@2026\.8\.31$/);
  assert.deepEqual(marketplace.installedIds(config), ["filesystem"]);
  assert.deepEqual(marketplace.installedIds(marketplace.removeServer(config, "filesystem")), []);
  assert.throws(() => marketplace.addServer("", "unknown"), /bulunamadı/i);
});

test("MCP marketplace migrates servers alias without discarding other config", () => {
  const result = marketplace.parseConfig(JSON.stringify({ servers: { custom: { command: "custom" } }, note: "keep" }));
  assert.equal(result.mcpServers.custom.command, "custom");
  assert.equal(result.note, "keep");
});
