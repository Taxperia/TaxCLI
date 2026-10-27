const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeCodexUsage, normalizeCursorUsage } = require("../electron/provider-usage");

test("normalizes Codex rate-limit windows and remaining percentages", () => {
  const result = normalizeCodexUsage({
    account: { account: { email: "dev@example.com", planType: "plus" } },
    rateLimits: {
      rateLimitsByLimitId: {
        codex: {
          limitName: "Codex",
          primary: { usedPercent: 27.5, windowDurationMins: 300, resetsAt: 1700000000 },
          secondary: { usedPercent: 105, windowDurationMins: 10080, resetsAt: 1700600000 }
        },
        codex_other: {
          limitName: "Other models",
          primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1700000100 }
        }
      }
    },
    usage: { summary: { lifetimeTokens: 123456 } }
  });
  assert.equal(result.available, true);
  assert.equal(result.email, "dev@example.com");
  assert.equal(result.buckets[0].primary.remainingPercent, 72.5);
  assert.equal(result.buckets[0].secondary.usedPercent, 100);
  assert.equal(result.buckets[0].secondary.remainingPercent, 0);
  assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets[1].name, "Other models");
  assert.equal(result.summary.lifetimeTokens, 123456);
});

test("normalizes Cursor CLI identity without inventing a personal usage limit", () => {
  const result = normalizeCursorUsage({
    installed: true,
    statusOutput: JSON.stringify({ status: "authenticated", isAuthenticated: true }),
    aboutOutput: JSON.stringify({ cliVersion: "2026.09.26", subscriptionTier: "pro" })
  });
  assert.equal(result.available, false);
  assert.equal(result.authenticated, true);
  assert.equal(result.subscriptionTier, "pro");
  assert.match(result.message, /Spending/);
});

test("Codex usage meter visualizes remaining quota and warns as it runs low", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  const renderer = appSource.slice(appSource.indexOf("function renderCodexUsageCard"), appSource.indexOf("function renderCursorUsageCard"));

  assert.match(renderer, /value="\$\{remainingPercent\}"/);
  assert.doesNotMatch(renderer, /value="[^\n]*window\.usedPercent/);
  assert.match(renderer, /provider-meter \$\{level\}/);
  assert.match(styles, /\.provider-meter\.warning::\-webkit-progress-value/);
  assert.match(styles, /\.provider-meter\.critical::\-webkit-progress-value/);
});
