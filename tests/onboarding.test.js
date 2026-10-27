const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");

test("first-launch wizard covers engines, project, security and completion", () => {
  for (const id of ["onboardingModal", "onboardingSteps", "onboardingContent", "onboardingBack", "onboardingNext"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /taxcli:onboarding-version/);
  assert.match(app, /Promise\.all\(\[loadProjects\(\), detectEngines\(true\)\]\)/);
  assert.match(app, /maybeStartOnboarding\(\)/);
  assert.match(app, /onboardingChooseProject/);
  assert.match(app, /onboardingAutoSnapshot/);
  assert.match(app, /onboardingApproval/);
  assert.match(app, /data-wizard-approval/);
  assert.doesNotMatch(app, /<select[^>]+id="onboardingApproval"/);
  assert.match(app, /onboardingMcp/);
});

test("onboarding uses theme-aware controls with visible checked state", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(css, /\.s-switch:checked\s*\{[^}]*var\(--s-accent,var\(--accent\)\)/s);
  assert.match(css, /#onboardingNext\s*\{[^}]*grid-column:3/s);
  assert.match(css, /\.wizard-choice button\.selected/);
});

test("onboarding cannot be dismissed accidentally from its backdrop", () => {
  assert.match(app, /\["actionApprovalModal", "onboardingModal"\]\.includes\(backdrop\.id\)/);
});
