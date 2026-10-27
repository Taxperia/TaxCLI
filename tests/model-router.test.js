const test = require("node:test");
const assert = require("node:assert/strict");
const { effortFor, selectRunTarget } = require("../src/model-router");

const candidates = [
  { engineId: "codex", model: { id: "gpt-6-astra", label: "GPT-6 Astra" } },
  { engineId: "codex", model: { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" } },
  { engineId: "gemini", model: { id: "flash-lite", label: "Gemini Flash Lite" } },
  { engineId: "gemini", model: { id: "pro", label: "Gemini Pro" } }
];

test("sabit model otomatik yönlendirme tarafından değiştirilmez", () => {
  const result = selectRunTarget({ scope: "engine", activeEngine: "codex", selectedModel: "gpt-6-astra", candidates });
  assert.equal(result.engineId, "codex");
  assert.equal(result.model, "gpt-6-astra");
  assert.equal(result.automatic, false);
});

test("motor içi Auto tasarruf modelini seçer", () => {
  const result = selectRunTarget({ scope: "engine", activeEngine: "codex", selectedModel: "__auto__", policy: "economy", agentId: "everyday", candidates });
  assert.equal(result.engineId, "codex");
  assert.equal(result.model, "gpt-5.4-mini");
});

test("Global Auto yalnızca izin verilen bağlı motorlardan seçim yapar", () => {
  const result = selectRunTarget({ scope: "all", activeEngine: "codex", policy: "economy", agentId: "everyday", allowedEngineIds: ["gemini"], candidates });
  assert.equal(result.engineId, "gemini");
  assert.equal(result.model, "flash-lite");
  assert.throws(() => selectRunTarget({ scope: "all", allowedEngineIds: [], candidates }), /bulunamadı/);
});

test("politika ve agent uygun reasoning eforu üretir", () => {
  assert.equal(effortFor("economy", "analyst", ["low", "medium", "high", "max"]), "low");
  assert.equal(effortFor("balanced", "coder", ["low", "medium", "high"]), "high");
  assert.equal(effortFor("quality", "analyst", ["low", "medium", "high", "max"]), "max");
});
