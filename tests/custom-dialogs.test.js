const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("user-facing confirmations do not fall back to native browser or Windows dialogs", () => {
  const files = [
    "src/app.js",
    "electron/mobile-bridge.js",
    "electron/main.js"
  ];
  const forbidden = [
    /window\.(?:confirm|alert|prompt)\s*\(/,
    /\balert\s*\(/,
    /showMessageBox\s*\(/,
    /showErrorBox\s*\(/
  ];

  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relativePath} still contains ${pattern}`);
    }
  }
});
