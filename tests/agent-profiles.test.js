const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPrompt, normalizeAgentId, resolveAgent } = require("../src/agent-profiles");

test("otomatik yönlendirici kod görevlerini Kodlayıcıya gönderir", () => {
  assert.equal(classifyPrompt("Bu projedeki hatayı düzelt ve testleri çalıştır"), "coder");
  assert.equal(classifyPrompt("React component için API entegrasyonu yaz"), "coder");
  assert.equal(classifyPrompt("Benim için bir web sitesi yap"), "coder");
});

test("plan isteği ve plan bağlamı Planlayıcıyı seçer", () => {
  assert.equal(classifyPrompt("Yalnızca uygulama planı çıkar, kod yazma"), "planner");
  assert.equal(classifyPrompt("Bunu uygula", { plan: true }), "planner");
  assert.equal(resolveAgent("planner", "Uygulamayı geliştir").profile.forceReadOnly, true);
});

test("gündelik ve analitik sorular ayrılır", () => {
  assert.equal(classifyPrompt("Kuantum dolaşıklık nedir?"), "everyday");
  assert.equal(classifyPrompt("Bu iki yaklaşımın risklerini, artılarını ve eksilerini karşılaştır"), "analyst");
});

test("elle seçilen profil otomatik sınıflandırmayı geçersiz kılar", () => {
  const resolved = resolveAgent("analyst", "Bu kodu düzelt");
  assert.equal(resolved.resolvedId, "analyst");
  assert.equal(resolved.automatic, false);
  assert.equal(normalizeAgentId("bilinmeyen"), "auto");
});
