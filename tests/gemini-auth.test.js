const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("Gemini allows supported Google Cloud auth without requiring an API key", () => {
  assert.match(mainSource, /if \(await hasGeminiCloudProjectConfig\(\)\) return \{ authenticated: true/);
  assert.match(mainSource, /const hasLocal = await hasGeminiLocalAuthFiles\(\);/);
  assert.match(mainSource, /if \(!hasApiKey && !hasLocal\)/);
  assert.doesNotMatch(mainSource, /kişisel Google OAuth hesaplarını artık desteklemiyor/);
});

test("Gemini exposes CLI aliases and both Google and API-key connection choices", () => {
  assert.match(mainSource, /if \(!apiKey\) return aliases;/);
  assert.match(mainSource, /launchInteractiveTerminal\(invocation, \[\], "Gemini Google Girişi"\)/);
  assert.match(rendererSource, /data-api-key="\$\{engine\.id\}"/);
  assert.match(rendererSource, /login: "Kurumsal Google girişi"/);
});
