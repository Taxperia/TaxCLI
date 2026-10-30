function assertOpenCodeModelAvailable(model, models) {
  if (model && !models.some((entry) => (typeof entry === "string" ? entry : entry.id) === model)) {
    throw new Error(`'${model}' kurulu OpenCode kataloğunda bulunmuyor. Model menüsünü yenileyip mevcut bir model seçin.`);
  }
}

function createOpenCodeDiagnostics() {
  let stderrTail = "", lastError = "";
  return {
    appendStderr(text) { stderrTail = `${stderrTail}${text}`.slice(-8000); },
    observeLog(parsed) {
      if (parsed?.detail) lastError = parsed.detail;
    },
    observeEvent(data) {
      if (data?.type !== "error" && data?.type !== "session.error") return "";
      const error = data.error || data.properties?.error;
      const message = error?.data?.message || error?.message || data.message || (typeof error === "string" ? error : "");
      if (message) lastError = String(message);
      return message ? String(message) : "";
    },
    detail() {
      const plain = stderrTail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
      return String(lastError || plain).slice(-2000);
    }
  };
}

module.exports = { assertOpenCodeModelAvailable, createOpenCodeDiagnostics };
