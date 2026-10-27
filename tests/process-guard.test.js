const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTasklistMemory } = require("../electron/process-guard");

test("Windows tasklist memory is parsed without trusting locale separators", () => {
  assert.equal(parseTasklistMemory('"node.exe","1234","Console","1","1.234.567 K"'), 1234567 * 1024);
  assert.equal(parseTasklistMemory("INFO: No tasks are running"), 0);
});
