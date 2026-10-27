function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function normalizeWindow(window = null) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = clampPercent(window.usedPercent);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowDurationMins: Number.isFinite(Number(window.windowDurationMins))
      ? Number(window.windowDurationMins)
      : null,
    resetsAt: Number.isFinite(Number(window.resetsAt)) ? Number(window.resetsAt) : null
  };
}

function rateLimitBuckets(rateLimitResponse = {}) {
  const root = rateLimitResponse;
  const byId = root?.rateLimitsByLimitId;
  if (byId && typeof byId === "object") {
    return Object.entries(byId).map(([limitId, bucket]) => ({ limitId, ...(bucket || {}) }));
  }
  if (Array.isArray(root?.rateLimits)) return root.rateLimits;
  if (root?.rateLimits?.primary || root?.rateLimits?.secondary) return [root.rateLimits];
  if (root?.primary || root?.secondary) return [root];
  return [];
}

function normalizeCodexUsage({ account = null, rateLimits = null, usage = null } = {}) {
  const accountInfo = account?.account || account || {};
  const buckets = rateLimitBuckets(rateLimits || {}).map((bucket, index) => ({
    id: String(bucket.limitId || `limit-${index + 1}`),
    name: String(bucket.limitName || bucket.limitId || `Limit ${index + 1}`),
    planType: bucket.planType || accountInfo.planType || null,
    primary: normalizeWindow(bucket.primary),
    secondary: normalizeWindow(bucket.secondary),
    credits: bucket.credits && typeof bucket.credits === "object"
      ? {
          hasCredits: Boolean(bucket.credits.hasCredits),
          unlimited: Boolean(bucket.credits.unlimited),
          balance: Number.isFinite(Number(bucket.credits.balance)) ? Number(bucket.credits.balance) : null
        }
      : null
  })).filter((bucket) => bucket.primary || bucket.secondary || bucket.credits);

  const summary = usage?.summary || usage?.usage?.summary || null;
  return {
    available: buckets.length > 0,
    authenticated: Boolean(accountInfo?.email || accountInfo?.type || buckets.length),
    email: accountInfo?.email || null,
    planType: accountInfo?.planType || buckets.find((bucket) => bucket.planType)?.planType || null,
    buckets,
    summary: summary && typeof summary === "object" ? {
      lifetimeTokens: Number.isFinite(Number(summary.lifetimeTokens)) ? Number(summary.lifetimeTokens) : null,
      currentStreakDays: Number.isFinite(Number(summary.currentStreakDays)) ? Number(summary.currentStreakDays) : null,
      longestRunningTurnSec: Number.isFinite(Number(summary.longestRunningTurnSec)) ? Number(summary.longestRunningTurnSec) : null
    } : null
  };
}

function parseJsonOutput(output) {
  const value = String(output || "").trim();
  if (!value) return null;
  try { return JSON.parse(value); } catch { /* continue */ }
  for (const line of value.split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* continue */ }
  }
  return null;
}

function normalizeCursorUsage({ installed = false, statusOutput = "", aboutOutput = "" } = {}) {
  const status = parseJsonOutput(statusOutput) || {};
  const about = parseJsonOutput(aboutOutput) || {};
  return {
    available: false,
    installed: Boolean(installed),
    authenticated: Boolean(status.isAuthenticated || status.status === "authenticated"),
    cliVersion: about.cliVersion || null,
    model: about.model || null,
    subscriptionTier: about.subscriptionTier || null,
    email: about.userEmail || null,
    dashboardUrl: "https://cursor.com/dashboard/spending",
    message: installed
      ? "Cursor kişisel kullanım havuzunu Agent CLI üzerinden yayınlamıyor. Kalan limit Spending panelinde görülebilir."
      : "Cursor Agent CLI bulunamadı. Limitler Cursor panelinden görüntülenebilir."
  };
}

module.exports = {
  clampPercent,
  normalizeCodexUsage,
  normalizeCursorUsage,
  normalizeWindow,
  parseJsonOutput,
  rateLimitBuckets
};
