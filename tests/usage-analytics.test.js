const test = require("node:test");
const assert = require("node:assert/strict");
const usage = require("../src/usage-analytics");

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

test("normalizes a run with provider tokens, actual credits, duration and file edits", () => {
  const run = usage.normalizeRun({
    runId: "r-1",
    engineId: "Codex",
    model: "gpt-5.4",
    startedAt: "2026-10-05T11:59:55.000Z",
    finishedAt: "2026-10-05T12:00:00.000Z",
    usage: { input_tokens: 1200, output_tokens: 300, credits: 2.5 },
    status: "completed",
    fileChanges: [
      { path: "src/a.js", additions: 10, deletions: 2 },
      { path: "src/a.js", additions: 3 },
      { path: "src/b.js", additions: 1, deletions: 1 }
    ]
  }, { now: NOW });

  assert.equal(run.id, "r-1");
  assert.equal(run.engineId, "codex");
  assert.deepEqual([run.inputTokens, run.outputTokens, run.totalTokens], [1200, 300, 1500]);
  assert.equal(run.tokenQuality, "provider");
  assert.deepEqual(run.billing, { amount: 2.5, unit: "credits", quality: "actual", source: "provider" });
  assert.equal(run.durationMs, 5000);
  assert.equal(run.success, true);
  assert.deepEqual(run.fileEdits, { count: 3, uniqueFiles: 2, addedLines: 14, removedLines: 3, files: ["src/a.js", "src/b.js"] });
});

test("estimates tokens and configured cost without presenting it as provider truth", () => {
  const run = usage.normalizeRun({
    id: "estimated",
    engine: "gemini",
    modelId: "gemini-test",
    prompt: "a".repeat(400),
    reply: "b".repeat(200),
    exitCode: 0
  }, {
    now: NOW,
    pricing: { "gemini:gemini-test": { inputPerMillion: 1, outputPerMillion: 2, currency: "USD" } }
  });

  assert.equal(run.inputTokens, 100);
  assert.equal(run.outputTokens, 50);
  assert.equal(run.tokenQuality, "estimated");
  assert.equal(run.billing.amount, 0.0002);
  assert.equal(run.billing.unit, "USD");
  assert.equal(run.billing.quality, "estimated");
});

test("keeps billing unknown when neither provider usage nor pricing exists", () => {
  const run = usage.normalizeRun({ prompt: "hello", reply: "world", engineId: "cursor" }, { now: NOW });
  assert.equal(run.billing.amount, null);
  assert.equal(run.billing.quality, "unknown");
  assert.equal(run.billing.source, "unavailable");
});

test("migrates old usage counters without inventing model or daily attribution", () => {
  const state = usage.migrateState({
    sessionStarted: NOW - 100,
    totalMs: 3600000,
    projectsOpened: ["C:/one", "C:/one", "C:/two"],
    runs: 7,
    tokensEst: 9000,
    edits: 12
  }, { now: NOW });

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.runs.length, 0);
  assert.deepEqual(state.legacy, {
    runs: 7,
    totalTokens: 9000,
    durationMs: 3600000,
    fileEdits: 12,
    projectsOpened: ["C:/one", "C:/two"]
  });
  assert.equal(usage.aggregateRuns(state, { groupBy: "model" })[0].key, "unknown");
  assert.equal(usage.aggregateRuns(state, { groupBy: "day" })[0].key, "legacy");
});

test("appendRun upserts the same run and enforces retention", () => {
  let state = usage.createState(NOW);
  state = usage.appendRun(state, { id: "1", engineId: "codex", prompt: "one" }, { now: NOW, maxRuns: 2 });
  state = usage.appendRun(state, { id: "1", engineId: "codex", prompt: "updated", outputTokens: 9 }, { now: NOW + 1, maxRuns: 2 });
  state = usage.appendRun(state, { id: "2", engineId: "gemini" }, { now: NOW + 2, maxRuns: 2 });
  state = usage.appendRun(state, { id: "3", engineId: "cursor" }, { now: NOW + 3, maxRuns: 2 });
  assert.deepEqual(state.runs.map((run) => run.id), ["2", "3"]);
});

test("migration is idempotent for normalized token quality and file summaries", () => {
  let state = usage.createState(NOW);
  state = usage.appendRun(state, {
    id: "stable",
    engineId: "codex",
    prompt: "a".repeat(40),
    fileEdits: [{ path: "a.js", added: 4 }]
  }, { now: NOW });
  const migratedTwice = usage.migrateState(usage.migrateState(state, { now: NOW }), { now: NOW });
  assert.equal(migratedTwice.runs[0].tokenQuality, "estimated");
  assert.deepEqual(migratedTwice.runs[0].fileEdits, state.runs[0].fileEdits);
});

test("aggregates by engine, model and day with success and billing quality", () => {
  const state = {
    schemaVersion: 2,
    runs: [
      { id: "a", engineId: "codex", model: "m1", timestamp: "2026-10-04T10:00:00Z", inputTokens: 100, outputTokens: 50, billing: { amount: 1, unit: "credits", quality: "actual" }, durationMs: 1000, success: true, fileEdits: [{ path: "a.js" }] },
      { id: "b", engineId: "codex", model: "m2", timestamp: "2026-10-05T10:00:00Z", inputTokens: 20, outputTokens: 10, billing: { amount: 0.5, unit: "credits", quality: "estimated" }, durationMs: 3000, success: false, error: "bad", fileEdits: 2 },
      { id: "c", engineId: "gemini", model: "m1", timestamp: "2026-10-05T11:00:00Z", inputTokens: 40, outputTokens: 10, durationMs: 2000, success: true }
    ],
    legacy: { runs: 0 }
  };
  const engines = usage.aggregateRuns(state, { groupBy: "engine" });
  const codex = engines.find((row) => row.key === "codex");
  assert.equal(codex.runCount, 2);
  assert.equal(codex.successCount, 1);
  assert.equal(codex.errorCount, 1);
  assert.equal(codex.totalTokens, 180);
  assert.equal(codex.averageDurationMs, 2000);
  assert.equal(codex.fileEdits, 3);
  assert.deepEqual(codex.billingByUnit[0], { unit: "credits", amount: 1.5, actual: 1, estimated: 0.5, quality: "mixed" });
  assert.deepEqual(usage.aggregateRuns(state, { groupBy: "day" }).map((row) => row.key), ["2026-10-04", "2026-10-05"]);
  assert.deepEqual(usage.aggregateRuns(state, { groupBy: "model" }).map((row) => row.key), ["m1", "m2"]);
});

test("produces chart series, table rows and a detailed report", () => {
  let state = usage.createState(NOW);
  state = usage.appendRun(state, { id: "a", timestamp: "2026-10-04T10:00:00Z", engineId: "codex", model: "m1", inputTokens: 10, outputTokens: 5, status: "done" }, { now: NOW });
  state = usage.appendRun(state, { id: "b", timestamp: "2026-10-05T10:00:00Z", engineId: "gemini", model: "m2", inputTokens: 20, outputTokens: 5, error: "timeout" }, { now: NOW });
  const chart = usage.buildChartSeries(state, { metric: "totalTokens", splitBy: "engine" });
  assert.deepEqual(chart.labels, ["2026-10-04", "2026-10-05"]);
  assert.deepEqual(chart.series.find((item) => item.key === "codex").data, [15, 0]);
  assert.deepEqual(chart.series.find((item) => item.key === "gemini").data, [0, 25]);
  const rows = usage.buildTableRows(state, { groupBy: "model" });
  assert.equal(rows[0].billingQuality, "unknown");
  const report = usage.buildReport(state, { now: NOW });
  assert.equal(report.summary.runCount, 2);
  assert.equal(report.summary.errorCount, 1);
  assert.equal(report.byEngine.length, 2);
  assert.equal(report.charts.runs.metric, "runCount");
});

test("browser-style tracker persists, reloads, exports and clears state", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value)
  };
  const tracker = usage.createTracker({ storage, storageKey: "test", now: NOW });
  tracker.record({ id: "saved", engineId: "codex", outputTokens: 4 });
  assert.equal(JSON.parse(memory.get("test")).runs.length, 1);
  assert.equal(usage.createTracker({ storage, storageKey: "test", now: NOW }).report().summary.totalTokens, 4);
  assert.match(tracker.export(), /"saved"/);
  tracker.clear();
  assert.equal(tracker.getState().runs.length, 0);
});
