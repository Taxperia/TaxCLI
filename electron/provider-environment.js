function withProviderEnv(baseEnv, keys = {}, { model = "", engineId = "" } = {}, sourceEnv = process.env) {
  const env = { ...baseEnv };
  const wantsNvidia = engineId === "nvidia" || String(model).startsWith("nvidia/");
  if (wantsNvidia && keys.nvidia) env.NVIDIA_API_KEY = keys.nvidia;

  if (engineId === "gemini") {
    if (keys.gemini) {
      env.GEMINI_API_KEY = keys.gemini;
      env.GOOGLE_API_KEY = keys.gemini;
      env.GOOGLE_GENAI_API_KEY = keys.gemini;
    }
    env.CI = env.CI || "1";
    env.TERM = env.TERM || "dumb";
    env.NO_COLOR = "1";
    env.FORCE_COLOR = "0";
    env.GIT_TERMINAL_PROMPT = "0";
    env.GH_PROMPT_DISABLED = "1";
    env.GEMINI_CLI_TRUST_WORKSPACE = "true";
  }

  if (engineId === "copilot") {
    const copilotToken = sourceEnv.GITHUB_COPILOT_TOKEN || sourceEnv.GH_TOKEN || sourceEnv.GITHUB_TOKEN;
    if (copilotToken) env.GH_TOKEN = copilotToken;
  }
  return env;
}

module.exports = { withProviderEnv };
