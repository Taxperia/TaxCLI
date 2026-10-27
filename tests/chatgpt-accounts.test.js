const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ChatGptAccountStore, codexChatGptPlanArgs } = require("../electron/chatgpt-accounts");

async function temporaryStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taxcli-chatgpt-test-"));
  const store = new ChatGptAccountStore({
    filePath: path.join(root, "accounts.json"),
    protect: async (value) => Buffer.from(value, "utf8").toString("base64"),
    unprotect: async (value) => Buffer.from(value, "base64").toString("utf8")
  });
  return { root, store };
}

test("ChatGPT account store separates public metadata from encrypted credentials", async (t) => {
  const { root, store } = await temporaryStore();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const accountId = crypto.randomUUID();
  await store.saveAccount({
    accountId,
    clientId: "oaiapp_test",
    identity: { iss: "https://auth.openai.com", sub: "subject-1", email: "one@example.com", name: "Birinci Hesap" },
    tokens: { access_token: "secret-access", refresh_token: "secret-refresh", id_token: "secret-id", expires_in: 3600 },
    scopes: ["chatgpt.tokens.use.direct"],
    label: "Kişisel"
  });
  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, accountId);
  assert.equal(listed[0].label, "Kişisel");
  assert.equal("access_token" in listed[0], false);
  assert.equal((await store.getCredentials(accountId)).access_token, "secret-access");

  const disk = await fs.readFile(path.join(root, "accounts.json"), "utf8");
  assert.doesNotMatch(disk, /secret-access|secret-refresh/);
});

test("ChatGPT account store keeps registrations independent", async (t) => {
  const { root, store } = await temporaryStore();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  for (const [id, email, token] of [[first, "same@example.com", "token-one"], [second, "same@example.com", "token-two"]]) {
    await store.saveAccount({
      accountId: id,
      clientId: `oaiapp_${id}`,
      identity: { iss: "https://auth.openai.com", sub: `subject-${id}`, email },
      tokens: { access_token: token, refresh_token: `refresh-${id}`, id_token: `id-${id}`, expires_in: 3600 },
      scopes: ["chatgpt.tokens.use.direct"]
    });
  }
  assert.equal((await store.list()).length, 2);
  assert.equal((await store.getCredentials(first)).access_token, "token-one");
  assert.equal((await store.getCredentials(second)).access_token, "token-two");
  await store.remove(first);
  assert.deepEqual((await store.list()).map((item) => item.id), [second]);
});

test("Codex ChatGPT plan provider reads only the process access-token variable", () => {
  const args = codexChatGptPlanArgs();
  assert.ok(args.includes('model_provider="openai_chatgpt_plan"'));
  assert.ok(args.includes('model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"'));
  assert.equal(args.some((value) => /secret|token-one/.test(value)), false);
});
