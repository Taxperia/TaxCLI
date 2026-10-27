const test = require("node:test");
const assert = require("node:assert/strict");
const { withProviderEnv } = require("../electron/provider-environment");

const keys = { gemini: "gemini-secret", nvidia: "nvidia-secret" };
const source = {
  GITHUB_COPILOT_TOKEN: "copilot-secret",
  UNRELATED_SECRET: "must-not-leak"
};

test("provider credentials are exposed only to their selected engine", () => {
  const codex = withProviderEnv({ PATH: "safe" }, keys, { engineId: "codex" }, source);
  assert.deepEqual(codex, { PATH: "safe" });

  const gemini = withProviderEnv({ PATH: "safe" }, keys, { engineId: "gemini" }, source);
  assert.equal(gemini.GEMINI_API_KEY, "gemini-secret");
  assert.equal(gemini.NVIDIA_API_KEY, undefined);
  assert.equal(gemini.GH_TOKEN, undefined);

  const nvidia = withProviderEnv({ PATH: "safe" }, keys, { engineId: "nvidia" }, source);
  assert.equal(nvidia.NVIDIA_API_KEY, "nvidia-secret");
  assert.equal(nvidia.GEMINI_API_KEY, undefined);

  const copilot = withProviderEnv({ PATH: "safe" }, keys, { engineId: "copilot" }, source);
  assert.equal(copilot.GH_TOKEN, "copilot-secret");
  assert.equal(copilot.GEMINI_API_KEY, undefined);
  assert.equal(copilot.UNRELATED_SECRET, undefined);
});
