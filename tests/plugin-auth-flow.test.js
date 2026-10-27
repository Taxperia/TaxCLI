const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "src", "app.js"), "utf8");

test("browser plugins open in the system browser and never claim an unverified login", () => {
  assert.match(source, /id:"canva"[^\r\n]+url:"https:\/\/www\.canva\.com\/login\/"/);
  assert.match(source, /async function openBrowserPlugin[\s\S]*window\.agentHub\.openExternal\(plugin\.url\)/);
  assert.match(source, /plugin\.auth === "browser"\) action = "Bağla"/);
  assert.match(source, /if \(plugin\.auth === "browser"\) \{\s*connectedPlugins\.delete\(plugin\.id\)/);
  assert.doesNotMatch(source, /connectedPlugins\.add\(plugin\.id\);[\s\S]{0,300}openBrowserPane\(plugin\.url/);
});
