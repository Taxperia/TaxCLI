(function exposeModelRouter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root) root.TaxCliModelRouter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createModelRouter() {
  "use strict";

  const policies = Object.freeze([
    { id: "economy", name: "Tasarruf", shortName: "Tasarruf", icon: "fa-solid fa-leaf", description: "Düşük efor, kısa bağlam ve ekonomik modeller." },
    { id: "balanced", name: "Dengeli", shortName: "Dengeli", icon: "fa-solid fa-scale-balanced", description: "Maliyet, hız ve kalite arasında denge." },
    { id: "quality", name: "Kalite", shortName: "Kalite", icon: "fa-solid fa-gem", description: "Daha güçlü modeller ve yüksek düşünme eforu." }
  ]);
  const policyIds = Object.freeze(policies.map((policy) => policy.id));
  const byId = Object.freeze(Object.fromEntries(policies.map((policy) => [policy.id, policy])));

  function normalizePolicy(value) {
    const id = String(value || "").trim().toLowerCase();
    return policyIds.includes(id) ? id : "balanced";
  }

  function normalizeScope(value) {
    return value === "all" ? "all" : "engine";
  }

  function modelText(model) {
    return `${model?.id || ""} ${model?.label || ""}`.toLowerCase();
  }

  function speedScore(text) {
    if (/flash-lite|flash.?mini|nano|mini|haiku|lite|free|mimo|luna/.test(text)) return 55;
    if (/flash|small|fast|turbo/.test(text)) return 35;
    if (/auto/.test(text)) return 22;
    return 0;
  }

  function powerScore(text) {
    if (/astra|opus|max|ultra|gpt-6|gpt-5\.6|sonnet.?4\.6|gemini.?3\.1.?pro/.test(text)) return 55;
    if (/pro|sonnet|gpt-5\.4|gpt-5\.5|codex/.test(text)) return 35;
    return 0;
  }

  function scoreCandidate(candidate, { policy, agentId, hasImages }) {
    const text = modelText(candidate.model);
    let score = 10;
    const fast = speedScore(text);
    const powerful = powerScore(text);

    if (policy === "economy") {
      score += fast - powerful * 0.45;
      if (candidate.engineId === "nvidia") score += 18;
      if (candidate.engineId === "gemini") score += 14;
      if (candidate.engineId === "opencode" && /free/.test(text)) score += 20;
    } else if (policy === "quality") {
      score += powerful - fast * 0.25;
      if (candidate.engineId === "codex") score += 12;
    } else {
      score += Math.max(fast * 0.45, powerful * 0.55);
    }

    if (agentId === "coder") {
      if (/codex|code|sonnet|gpt-5|gpt-6|astra/.test(text)) score += 30;
      if (candidate.engineId === "codex") score += 14;
    } else if (agentId === "everyday") {
      score += fast * 0.5;
    } else if (agentId === "planner" || agentId === "analyst") {
      score += powerful * 0.55;
    }

    if (hasImages) {
      if (candidate.engineId === "gemini") score += 38;
      if (/vision|gemini|gpt-4o|gpt-5|gpt-6|claude|sonnet/.test(text)) score += 20;
      if (/codex-mini|code-only/.test(text)) score -= 45;
    }

    // A provider default remains a valid fallback, but known models are easier to optimize.
    if (!candidate.model?.id) score -= 8;
    return score;
  }

  function effortFor(policyValue, agentId, supported = ["low", "medium", "high", "max"]) {
    const policy = normalizePolicy(policyValue);
    let desired = "medium";
    if (policy === "economy") desired = "low";
    else if (policy === "quality") desired = agentId === "analyst" ? "max" : "high";
    else if (agentId === "everyday") desired = "low";
    else if (["planner", "coder"].includes(agentId)) desired = "high";
    else if (agentId === "analyst") desired = "max";

    if (supported.includes(desired)) return desired;
    const fallbackOrder = desired === "max" ? ["ultra", "xhigh", "high", "medium", "low"] : ["high", "medium", "low"];
    return fallbackOrder.find((level) => supported.includes(level)) || supported[0] || "medium";
  }

  function selectRunTarget(options = {}) {
    const scope = normalizeScope(options.scope);
    const policy = normalizePolicy(options.policy);
    const activeEngine = String(options.activeEngine || "codex");
    const agentId = String(options.agentId || "everyday");
    const hasAllowlist = Array.isArray(options.allowedEngineIds);
    const allowed = new Set((options.allowedEngineIds || []).map(String));
    const allCandidates = Array.isArray(options.candidates) ? options.candidates : [];
    const eligible = allCandidates.filter((candidate) => {
      if (!candidate?.engineId) return false;
      if (scope === "engine") return candidate.engineId === activeEngine;
      return !hasAllowlist || allowed.has(candidate.engineId);
    });

    if (!eligible.length) throw new Error(scope === "all" ? "Global Auto için bağlı ve izinli bir AI motoru bulunamadı." : "Seçili AI motoru kullanılamıyor.");

    if (scope === "engine" && options.selectedModel !== "__auto__") {
      const engineCandidate = eligible.find((candidate) => candidate.engineId === activeEngine);
      return {
        engineId: activeEngine,
        model: String(options.selectedModel || ""),
        policy,
        automatic: false,
        reason: "Kullanıcının sabitlediği motor ve model kullanılıyor."
      };
    }

    const scored = eligible.map((candidate, index) => ({
      ...candidate,
      score: scoreCandidate(candidate, { policy, agentId, hasImages: Boolean(options.hasImages) }),
      index
    })).sort((a, b) => b.score - a.score || a.index - b.index);
    const winner = scored[0];
    return {
      engineId: winner.engineId,
      model: String(winner.model?.id || ""),
      modelLabel: String(winner.model?.label || winner.model?.id || "Sağlayıcı varsayılanı"),
      policy,
      automatic: true,
      score: winner.score,
      reason: scope === "all"
        ? `${byId[policy].name} politikası bağlı motorlar arasından seçti.`
        : `${byId[policy].name} politikası ${winner.engineId} modelleri arasından seçti.`
    };
  }

  return Object.freeze({ policies, policyIds, byId, normalizePolicy, normalizeScope, effortFor, selectRunTarget });
});
