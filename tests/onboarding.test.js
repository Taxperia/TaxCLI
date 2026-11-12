const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

test("onboarding assigns approval values through the DOM and falls back for injected markup", () => {
  const start = app.indexOf("function onboardingReadyEngines(");
  const end = app.indexOf("async function saveOnboardingSecurityStep(", start);
  assert.ok(start >= 0 && end > start);
  const elements = new Map();
  const context = vm.createContext({
    $: (selector) => {
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    },
    $$: () => [],
    onboardingStep: 3, projects: [], selectedProjectId: null,
    detected: [], userSettings: {}, approvalMode: "ask"
  });
  vm.runInContext(app.slice(start, end), context);
  for (const mode of ["ask", "auto_edit", "plan", '\"><img src=x onerror="alert(1)">']) {
    context.approvalMode = mode;
    context.renderOnboarding();
    const expected = ["ask", "auto_edit", "plan"].includes(mode) ? mode : "ask";
    assert.equal(elements.get("#onboardingApproval").value, expected);
    const markup = elements.get("#onboardingContent").innerHTML;
    assert.doesNotMatch(markup, /<input id="onboardingApproval"[^>]*\bvalue=/);
    assert.ok(markup.includes(`data-wizard-approval="${expected}"`));
    assert.doesNotMatch(markup, /<img|onerror=/);
  }
});
