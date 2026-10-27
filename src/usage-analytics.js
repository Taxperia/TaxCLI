(function exposeUsageAnalytics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root) root.TaxCliUsageAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createUsageAnalytics() {
  "use strict";

  const SCHEMA_VERSION = 2;
  const DEFAULT_STORAGE_KEY = "agenthub:usage-analytics";
  const DEFAULT_MAX_RUNS = 5000;
  const GROUP_FIELDS = Object.freeze({
    engine: "engineId",
    model: "model",
    day: "day"
  });

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegative(value, fallback = 0) {
    return Math.max(0, finiteNumber(value, fallback));
  }

  function firstNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (value !== "" && value != null && Number.isFinite(number)) return Math.max(0, number);
    }
    return null;
  }

  function firstText(...values) {
    for (const value of values) {
      const text = String(value == null ? "" : value).trim();
      if (text) return text;
    }
    return "";
  }

  function isoTime(value, fallbackMs = Date.now()) {
    const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
    return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString();
  }

  function textContent(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) return textContent(value.content);
    if (Array.isArray(value.messages)) return textContent(value.messages);
    return "";
  }

  /** A conservative local approximation for providers that do not return usage. */
  function estimateTokens(value) {
    const text = textContent(value);
    if (!text) return 0;
    const codePoints = Array.from(text).length;
    const words = (text.match(/[\p{L}\p{N}_]+/gu) || []).length;
    return Math.max(1, Math.ceil(Math.max(codePoints / 4, words * 1.18)));
  }

  function usageObject(raw) {
    return raw?.usage || raw?.stats?.usage || raw?.result?.usage || raw?.response?.usage || raw?.usageMetadata || {};
  }

  function normalizeTokens(raw = {}) {
    const usage = usageObject(raw);
    const actualInput = firstNumber(
      raw.inputTokens, raw.input_tokens, raw.promptTokens, raw.prompt_tokens,
      usage.inputTokens, usage.input_tokens, usage.promptTokens, usage.prompt_tokens,
      usage.promptTokenCount, usage.inputTokenCount
    );
    const actualOutput = firstNumber(
      raw.outputTokens, raw.output_tokens, raw.completionTokens, raw.completion_tokens,
      usage.outputTokens, usage.output_tokens, usage.completionTokens, usage.completion_tokens,
      usage.candidatesTokenCount, usage.outputTokenCount
    );
    const reportedTotal = firstNumber(raw.totalTokens, raw.total_tokens, usage.totalTokens, usage.total_tokens, usage.totalTokenCount);
    const estimatedInput = estimateTokens(raw.prompt ?? raw.input ?? raw.request ?? raw.messages);
    const estimatedOutput = estimateTokens(raw.reply ?? raw.output ?? raw.responseText ?? raw.text);
    const inputTokens = actualInput == null ? estimatedInput : actualInput;
    let outputTokens = actualOutput == null ? estimatedOutput : actualOutput;
    if (actualOutput == null && !estimatedOutput && reportedTotal != null) outputTokens = Math.max(0, reportedTotal - inputTokens);
    const totalTokens = reportedTotal == null ? inputTokens + outputTokens : Math.max(reportedTotal, inputTokens + outputTokens);
    const exactParts = Number(actualInput != null) + Number(actualOutput != null);
    const preservedQuality = ["provider", "mixed", "estimated"].includes(raw.tokenQuality) ? raw.tokenQuality : "";
    const source = preservedQuality || (exactParts === 2 || (reportedTotal != null && exactParts > 0)
      ? "provider"
      : (exactParts > 0 || reportedTotal != null ? "mixed" : "estimated"));
    return {
      input: Math.round(inputTokens),
      output: Math.round(outputTokens),
      total: Math.round(totalTokens),
      source
    };
  }

  function pricingFor(pricing, engineId, model) {
    if (!pricing || typeof pricing !== "object") return null;
    const engine = String(engineId || "unknown");
    const modelId = String(model || "auto");
    return pricing[`${engine}:${modelId}`]
      || pricing[modelId]
      || pricing[engine]?.[modelId]
      || pricing[engine]?.default
      || pricing[engine]
      || pricing.default
      || null;
  }

  function explicitBilling(raw) {
    const usage = usageObject(raw);
    const object = raw.billing || raw.actualCost || raw.costDetails || {};
    const creditAmount = firstNumber(raw.creditsUsed, raw.creditUsage, usage.creditsUsed, usage.credits);
    const costAmount = firstNumber(
      typeof raw.cost === "number" ? raw.cost : null,
      raw.costAmount, raw.amount,
      typeof usage.cost === "number" ? usage.cost : null,
      usage.costAmount,
      object.amount, object.value
    );
    const amount = creditAmount == null ? costAmount : creditAmount;
    if (amount == null) return null;
    const unit = firstText(
      object.unit,
      creditAmount != null ? (raw.creditUnit || usage.creditUnit || "credits") : "",
      raw.costUnit, raw.currency, usage.costUnit, usage.currency,
      "credits"
    );
    const declared = firstText(object.quality, object.precision, raw.costQuality, raw.billingQuality).toLowerCase();
    return {
      amount,
      unit,
      quality: declared === "estimated" || declared === "estimate" ? "estimated" : "actual",
      source: firstText(object.source, raw.billingSource, "provider")
    };
  }

  function estimatedBilling(tokens, rate) {
    if (!rate || typeof rate !== "object") return null;
    const inputRate = firstNumber(rate.inputPerMillion, rate.inputCreditsPerMillion, rate.input, rate.promptPerMillion, rate.creditsPerMillion, rate.perMillion);
    const outputRate = firstNumber(rate.outputPerMillion, rate.outputCreditsPerMillion, rate.output, rate.completionPerMillion, rate.creditsPerMillion, rate.perMillion);
    if (inputRate == null && outputRate == null) return null;
    const amount = ((tokens.input * (inputRate || 0)) + (tokens.output * (outputRate || 0))) / 1000000;
    return {
      amount,
      unit: firstText(rate.unit, rate.currency, rate.creditsPerMillion != null ? "credits" : "USD"),
      quality: "estimated",
      source: firstText(rate.source, "configured-pricing")
    };
  }

  function normalizeBilling(raw, tokens, options, engineId, model) {
    return explicitBilling(raw)
      || estimatedBilling(tokens, pricingFor(options.pricing, engineId, model))
      || { amount: null, unit: firstText(raw.creditUnit, raw.costUnit, "credits"), quality: "unknown", source: "unavailable" };
  }

  function normalizeFileEdits(raw = {}) {
    const source = raw.fileEdits ?? raw.filesChanged ?? raw.fileChanges ?? raw.changes ?? raw.files ?? [];
    if (typeof source === "number") {
      return { count: Math.round(nonNegative(source)), uniqueFiles: Math.round(nonNegative(source)), addedLines: 0, removedLines: 0, files: [] };
    }
    if (source && !Array.isArray(source) && typeof source === "object" && source.count != null) {
      const files = Array.isArray(source.files) ? [...new Set(source.files.map(String).filter(Boolean))].slice(0, 100) : [];
      return {
        count: Math.round(nonNegative(source.count)),
        uniqueFiles: Math.round(nonNegative(source.uniqueFiles, files.length)) || files.length,
        addedLines: Math.round(nonNegative(source.addedLines ?? source.added ?? source.additions)),
        removedLines: Math.round(nonNegative(source.removedLines ?? source.removed ?? source.deletions)),
        files
      };
    }
    const entries = Array.isArray(source) ? source : (source && typeof source === "object" ? Object.values(source) : []);
    const files = [];
    let addedLines = 0;
    let removedLines = 0;
    for (const entry of entries) {
      if (typeof entry === "string") files.push(entry);
      else if (entry && typeof entry === "object") {
        const path = firstText(entry.path, entry.file, entry.filename, entry.uri);
        if (path) files.push(path);
        addedLines += nonNegative(entry.added ?? entry.additions ?? entry.addedLines);
        removedLines += nonNegative(entry.removed ?? entry.deletions ?? entry.removedLines);
      }
    }
    const unique = [...new Set(files)];
    return {
      count: entries.length,
      uniqueFiles: unique.length || entries.length,
      addedLines: Math.round(addedLines),
      removedLines: Math.round(removedLines),
      files: unique.slice(0, 100)
    };
  }

  function runSucceeded(raw) {
    if (typeof raw.success === "boolean") return raw.success;
    if (raw.error || raw.failure) return false;
    const status = String(raw.status || raw.state || "").toLowerCase();
    if (/fail|error|cancel|abort|timeout/.test(status)) return false;
    const code = raw.exitCode ?? raw.code;
    if (code != null && code !== "") return Number(code) === 0;
    return /success|complete|finished|done/.test(status) || !status;
  }

  function normalizeRun(raw = {}, options = {}) {
    const now = finiteNumber(options.now, Date.now());
    const engineId = firstText(raw.engineId, raw.engine, raw.provider, "unknown").toLowerCase();
    const model = firstText(raw.model, raw.modelId, raw.modelName, "auto");
    const startedMs = Date.parse(raw.startedAt || raw.startTime || raw.createdAt || "");
    const finishedMs = Date.parse(raw.finishedAt || raw.endTime || raw.completedAt || "");
    const timestamp = isoTime(raw.timestamp || raw.finishedAt || raw.startedAt || raw.createdAt, now);
    const durationMs = Math.round(nonNegative(
      raw.durationMs ?? raw.elapsedMs ?? raw.duration
      ?? (Number.isFinite(startedMs) && Number.isFinite(finishedMs) ? finishedMs - startedMs : 0)
    ));
    const tokens = normalizeTokens(raw);
    const success = runSucceeded(raw);
    const error = success ? "" : firstText(raw.error?.message, raw.error, raw.failure?.message, raw.failure, raw.message, "Bilinmeyen hata");
    const fileEdits = normalizeFileEdits(raw);
    const id = firstText(raw.id, raw.runId, raw.requestId, `run-${now}-${Math.random().toString(36).slice(2, 9)}`);
    return {
      id,
      timestamp,
      day: timestamp.slice(0, 10),
      engineId,
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      totalTokens: tokens.total,
      tokenQuality: tokens.source,
      billing: normalizeBilling(raw, tokens, options, engineId, model),
      durationMs,
      success,
      error,
      fileEdits,
      projectId: firstText(raw.projectId, raw.projectPath, raw.cwd),
      agentId: firstText(raw.agentId, raw.agent, raw.role),
      runCount: Math.max(1, Math.round(nonNegative(raw.runCount, 1))),
      legacy: Boolean(raw.legacy)
    };
  }

  function emptyLegacy() {
    return { runs: 0, totalTokens: 0, durationMs: 0, fileEdits: 0, projectsOpened: [] };
  }

  function normalizeLegacy(value = {}) {
    return {
      runs: Math.round(nonNegative(value.runs ?? value.runCount)),
      totalTokens: Math.round(nonNegative(value.totalTokens ?? value.tokensEst ?? value.tokens)),
      durationMs: Math.round(nonNegative(value.durationMs ?? value.totalMs ?? value.timeMs)),
      fileEdits: Math.round(nonNegative(value.fileEdits ?? value.edits)),
      projectsOpened: Array.isArray(value.projectsOpened) ? [...new Set(value.projectsOpened.map(String).filter(Boolean))].slice(-200) : []
    };
  }

  function createState(now = Date.now()) {
    const stamp = isoTime(now, Date.now());
    return { schemaVersion: SCHEMA_VERSION, createdAt: stamp, updatedAt: stamp, runs: [], legacy: emptyLegacy() };
  }

  /** Migrates both the old agenthub:usage-stats counters and early entries/records formats. */
  function migrateState(input, options = {}) {
    const now = finiteNumber(options.now, Date.now());
    let source = input;
    if (typeof source === "string") {
      try { source = JSON.parse(source); } catch { source = {}; }
    }
    if (!source || typeof source !== "object") return createState(now);
    const rawRuns = Array.isArray(source) ? source : (source.runs || source.records || source.entries || []);
    const runs = Array.isArray(rawRuns) ? rawRuns.map((run) => normalizeRun(run, options)) : [];
    let legacy = normalizeLegacy(source.legacy || source.legacyTotals || {});
    const looksLikeOldCounters = !Array.isArray(source) && (
      source.tokensEst != null || source.totalMs != null || source.edits != null || source.projectsOpened != null
    );
    if (looksLikeOldCounters) legacy = normalizeLegacy(source);
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: isoTime(source.createdAt, now),
      updatedAt: isoTime(source.updatedAt, now),
      runs,
      legacy
    };
  }

  function appendRun(state, rawRun, options = {}) {
    const now = finiteNumber(options.now, Date.now());
    const next = migrateState(state, { ...options, now });
    const run = normalizeRun(rawRun, { ...options, now });
    const existing = next.runs.findIndex((item) => item.id === run.id);
    if (existing >= 0) next.runs[existing] = run;
    else next.runs.push(run);
    const maxRuns = Math.max(1, Math.round(nonNegative(options.maxRuns, DEFAULT_MAX_RUNS)) || DEFAULT_MAX_RUNS);
    if (next.runs.length > maxRuns) next.runs = next.runs.slice(-maxRuns);
    next.updatedAt = isoTime(now, Date.now());
    return next;
  }

  function legacyContribution(legacy, groupBy) {
    if (!legacy || !(legacy.runs || legacy.totalTokens || legacy.durationMs || legacy.fileEdits)) return null;
    return {
      key: groupBy === "day" ? "legacy" : "unknown",
      label: groupBy === "day" ? "Önceki kullanım" : "Bilinmeyen",
      runCount: legacy.runs,
      successCount: 0,
      errorCount: 0,
      inputTokens: legacy.totalTokens,
      outputTokens: 0,
      totalTokens: legacy.totalTokens,
      estimatedTokenRuns: legacy.runs,
      durationMs: legacy.durationMs,
      fileEdits: legacy.fileEdits,
      uniqueFiles: 0,
      addedLines: 0,
      removedLines: 0,
      billingByUnit: [],
      unknownBillingRuns: legacy.runs,
      actualBillingRuns: 0,
      estimatedBillingRuns: 0,
      legacy: true
    };
  }

  function inRange(run, options) {
    const time = Date.parse(run.timestamp);
    const from = options.from ? Date.parse(options.from) : NaN;
    const to = options.to ? Date.parse(options.to) : NaN;
    return (!Number.isFinite(from) || time >= from) && (!Number.isFinite(to) || time <= to);
  }

  function aggregateRuns(stateOrRuns, options = {}) {
    const state = migrateState(Array.isArray(stateOrRuns) ? { runs: stateOrRuns } : stateOrRuns, options);
    const groupBy = GROUP_FIELDS[options.groupBy] ? options.groupBy : "engine";
    const field = GROUP_FIELDS[groupBy];
    const groups = new Map();
    for (const run of state.runs.filter((item) => inRange(item, options))) {
      const key = firstText(run[field], "unknown");
      if (!groups.has(key)) groups.set(key, {
        key,
        label: key,
        runCount: 0,
        successCount: 0,
        errorCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedTokenRuns: 0,
        durationMs: 0,
        fileEdits: 0,
        uniqueFiles: 0,
        addedLines: 0,
        removedLines: 0,
        billingByUnit: [],
        unknownBillingRuns: 0,
        actualBillingRuns: 0,
        estimatedBillingRuns: 0,
        legacy: false,
        _files: new Set(),
        _billing: new Map()
      });
      const group = groups.get(key);
      group.runCount += run.runCount;
      group.successCount += run.success ? run.runCount : 0;
      group.errorCount += run.success ? 0 : run.runCount;
      group.inputTokens += run.inputTokens;
      group.outputTokens += run.outputTokens;
      group.totalTokens += run.totalTokens;
      group.estimatedTokenRuns += run.tokenQuality === "provider" ? 0 : run.runCount;
      group.durationMs += run.durationMs;
      group.fileEdits += run.fileEdits.count;
      group.addedLines += run.fileEdits.addedLines;
      group.removedLines += run.fileEdits.removedLines;
      run.fileEdits.files.forEach((file) => group._files.add(file));
      if (run.billing.quality === "unknown" || run.billing.amount == null) group.unknownBillingRuns += run.runCount;
      else {
        const unit = run.billing.unit || "credits";
        const current = group._billing.get(unit) || { unit, amount: 0, actual: 0, estimated: 0 };
        current.amount += run.billing.amount;
        current[run.billing.quality] += run.billing.amount;
        group._billing.set(unit, current);
        if (run.billing.quality === "actual") group.actualBillingRuns += run.runCount;
        else group.estimatedBillingRuns += run.runCount;
      }
    }
    const result = [...groups.values()].map((group) => {
      group.uniqueFiles = group._files.size;
      group.billingByUnit = [...group._billing.values()].map((item) => ({
        ...item,
        quality: item.actual > 0 && item.estimated > 0 ? "mixed" : (item.actual > 0 ? "actual" : "estimated")
      }));
      delete group._files;
      delete group._billing;
      group.successRate = group.runCount ? group.successCount / group.runCount : null;
      group.averageDurationMs = group.runCount ? Math.round(group.durationMs / group.runCount) : 0;
      return group;
    });
    if (options.includeLegacy !== false) {
      const legacy = legacyContribution(state.legacy, groupBy);
      if (legacy) result.push({ ...legacy, successRate: null, averageDurationMs: legacy.runCount ? Math.round(legacy.durationMs / legacy.runCount) : 0 });
    }
    return result.sort(groupBy === "day"
      ? (a, b) => (a.key === "legacy" ? -1 : b.key === "legacy" ? 1 : a.key.localeCompare(b.key))
      : (a, b) => b.totalTokens - a.totalTokens || b.runCount - a.runCount || a.label.localeCompare(b.label));
  }

  function summary(state, options = {}) {
    const rows = aggregateRuns(state, { ...options, groupBy: "engine" });
    const result = rows.reduce((total, row) => {
      for (const key of ["runCount", "successCount", "errorCount", "inputTokens", "outputTokens", "totalTokens", "durationMs", "fileEdits", "addedLines", "removedLines", "unknownBillingRuns", "actualBillingRuns", "estimatedBillingRuns"]) {
        total[key] += row[key] || 0;
      }
      for (const item of row.billingByUnit) {
        const found = total.billingByUnit.find((entry) => entry.unit === item.unit);
        if (found) {
          found.amount += item.amount;
          found.actual += item.actual;
          found.estimated += item.estimated;
          found.quality = found.actual > 0 && found.estimated > 0 ? "mixed" : (found.actual > 0 ? "actual" : "estimated");
        } else total.billingByUnit.push({ ...item });
      }
      return total;
    }, {
      runCount: 0, successCount: 0, errorCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
      durationMs: 0, fileEdits: 0, addedLines: 0, removedLines: 0, unknownBillingRuns: 0,
      actualBillingRuns: 0, estimatedBillingRuns: 0, billingByUnit: []
    });
    result.successRate = result.successCount + result.errorCount ? result.successCount / (result.successCount + result.errorCount) : null;
    result.averageDurationMs = result.runCount ? Math.round(result.durationMs / result.runCount) : 0;
    return result;
  }

  function buildChartSeries(state, options = {}) {
    const metric = firstText(options.metric, "totalTokens");
    const splitBy = options.splitBy === "model" ? "model" : (options.splitBy === "engine" ? "engine" : null);
    const normalized = migrateState(state, options);
    const days = aggregateRuns(normalized, { ...options, groupBy: "day" }).map((row) => row.key);
    if (!splitBy) {
      const byDay = new Map(aggregateRuns(normalized, { ...options, groupBy: "day" }).map((row) => [row.key, row]));
      return { metric, labels: days, series: [{ key: metric, name: metric, data: days.map((day) => finiteNumber(byDay.get(day)?.[metric])) }] };
    }
    const keys = [...new Set(normalized.runs.filter((run) => inRange(run, options)).map((run) => firstText(run[GROUP_FIELDS[splitBy]], "unknown")))].sort();
    const matrix = new Map();
    for (const run of normalized.runs.filter((item) => inRange(item, options))) {
      const key = firstText(run[GROUP_FIELDS[splitBy]], "unknown");
      const cell = `${run.day}\u0000${key}`;
      const previous = matrix.get(cell) || 0;
      matrix.set(cell, previous + finiteNumber(metric === "runCount" ? run.runCount : run[metric]));
    }
    return {
      metric,
      labels: days.filter((day) => day !== "legacy"),
      series: keys.map((key) => ({ key, name: key, data: days.filter((day) => day !== "legacy").map((day) => matrix.get(`${day}\u0000${key}`) || 0) }))
    };
  }

  function buildTableRows(state, options = {}) {
    const groupBy = GROUP_FIELDS[options.groupBy] ? options.groupBy : "model";
    return aggregateRuns(state, { ...options, groupBy }).map((row) => ({
      id: row.key,
      label: row.label,
      runs: row.runCount,
      successes: row.successCount,
      errors: row.errorCount,
      successRate: row.successRate,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      tokenQuality: row.estimatedTokenRuns ? (row.estimatedTokenRuns === row.runCount ? "estimated" : "mixed") : "provider",
      durationMs: row.durationMs,
      averageDurationMs: row.averageDurationMs,
      fileEdits: row.fileEdits,
      uniqueFiles: row.uniqueFiles,
      addedLines: row.addedLines,
      removedLines: row.removedLines,
      billing: row.billingByUnit,
      billingQuality: row.unknownBillingRuns
        ? (row.actualBillingRuns || row.estimatedBillingRuns ? "mixed" : "unknown")
        : (row.actualBillingRuns && row.estimatedBillingRuns ? "mixed" : (row.actualBillingRuns ? "actual" : "estimated")),
      unknownBillingRuns: row.unknownBillingRuns,
      legacy: row.legacy
    }));
  }

  function buildReport(state, options = {}) {
    const normalized = migrateState(state, options);
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: isoTime(options.now, Date.now()),
      summary: summary(normalized, options),
      byEngine: aggregateRuns(normalized, { ...options, groupBy: "engine" }),
      byModel: aggregateRuns(normalized, { ...options, groupBy: "model" }),
      byDay: aggregateRuns(normalized, { ...options, groupBy: "day" }),
      tableRows: buildTableRows(normalized, { ...options, groupBy: options.tableGroupBy || "model" }),
      charts: {
        tokens: buildChartSeries(normalized, { ...options, metric: "totalTokens", splitBy: options.chartSplitBy || "engine" }),
        runs: buildChartSeries(normalized, { ...options, metric: "runCount", splitBy: options.chartSplitBy || "engine" }),
        duration: buildChartSeries(normalized, { ...options, metric: "durationMs", splitBy: options.chartSplitBy || "engine" })
      }
    };
  }

  function createTracker(options = {}) {
    const storage = options.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const key = firstText(options.storageKey, DEFAULT_STORAGE_KEY);
    let state;
    try { state = migrateState(storage?.getItem(key), options); } catch { state = createState(options.now); }
    const save = () => {
      try { storage?.setItem(key, JSON.stringify(state)); } catch { /* storage is optional */ }
      return state;
    };
    return {
      record(rawRun) {
        state = appendRun(state, rawRun, options);
        save();
        const id = firstText(rawRun?.id, rawRun?.runId, rawRun?.requestId);
        return (id && state.runs.find((run) => run.id === id)) || state.runs[state.runs.length - 1];
      },
      getState() { return migrateState(state, options); },
      report(reportOptions = {}) { return buildReport(state, { ...options, ...reportOptions }); },
      replace(nextState) { state = migrateState(nextState, options); return save(); },
      clear() { state = createState(options.now); return save(); },
      export() { return JSON.stringify(state, null, 2); }
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    DEFAULT_STORAGE_KEY,
    estimateTokens,
    normalizeTokens,
    normalizeBilling,
    normalizeFileEdits,
    normalizeRun,
    createState,
    migrateState,
    appendRun,
    recordRun: appendRun,
    aggregateRuns,
    summary,
    buildChartSeries,
    buildTableRows,
    buildReport,
    createTracker
  });
});
