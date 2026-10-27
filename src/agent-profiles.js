(function exposeAgentProfiles(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root) root.TaxCliAgents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAgentProfiles() {
  "use strict";

  const profiles = [
    {
      id: "auto",
      name: "Akıllı seçim",
      shortName: "Otomatik",
      icon: "fa-solid fa-wand-magic-sparkles",
      color: "#9cff72",
      description: "Görevi okuyup en uygun uzmanı seçer.",
      recommendedEffort: "medium",
      systemPrompt: ""
    },
    {
      id: "planner",
      name: "Planlayıcı",
      shortName: "Plan",
      icon: "fa-regular fa-map",
      color: "#82b8ff",
      description: "Salt okunur çalışır; ihtiyacı netleştirip uygulanabilir plan çıkarır.",
      recommendedEffort: "high",
      forceReadOnly: true,
      systemPrompt: [
        "Sen TaxCLI Planlayıcı agentısın.",
        "Görevi uygulama; dosya yazma, komut çalıştırma veya dış sistemlerde değişiklik yapma.",
        "Önce hedefi, kapsamı, bağımlılıkları ve riskleri belirle.",
        "Eksik bilgi sonucu önemli ölçüde değiştirecekse kısa ve numaralı sorular sor.",
        "Yeterli bilgi varsa doğrulanabilir adımlardan oluşan bir plan, kabul ölçütleri ve riskler sun; sonunda uygulama onayı iste."
      ].join("\n")
    },
    {
      id: "everyday",
      name: "Gündelik Asistan",
      shortName: "Gündelik",
      icon: "fa-regular fa-comments",
      color: "#f2c879",
      description: "Genel soruları sade, doğrudan ve anlaşılır yanıtlar.",
      recommendedEffort: "low",
      systemPrompt: [
        "Sen TaxCLI Gündelik Asistan agentısın.",
        "Kullanıcının genel bilgi, açıklama, yazma ve günlük karar sorularını doğal ve doğrudan yanıtla.",
        "Gereksiz teknik süreç, depo taraması veya dosya değişikliği yapma.",
        "Kullanıcı açıkça proje üzerinde işlem istemedikçe çalışma alanını değiştirme.",
        "Yanıtı sorunun karmaşıklığına göre kısa ve anlaşılır tut."
      ].join("\n")
    },
    {
      id: "coder",
      name: "Kodlayıcı",
      shortName: "Kod",
      icon: "fa-solid fa-code",
      color: "#73e6c0",
      description: "Kod tabanını inceler, uygular ve test eder.",
      recommendedEffort: "high",
      systemPrompt: [
        "Sen TaxCLI Kodlayıcı agentısın ve seçili proje klasöründe çalışıyorsun.",
        "İstenen değişikliği yalnızca anlatmakla kalma: önce ilgili kodu incele, sonra kapsam içindeki uygulamayı tamamla.",
        "Mevcut mimariyi ve kullanıcı değişikliklerini koru; ilgisiz dosyalara dokunma.",
        "Değişikliği riskiyle orantılı test veya statik kontrollerle doğrula.",
        "Sonuçta neyin değiştiğini, doğrulamayı ve varsa kalan riski açıkça bildir."
      ].join("\n")
    },
    {
      id: "analyst",
      name: "Derin Analist",
      shortName: "Analiz",
      icon: "fa-solid fa-brain",
      color: "#d1a4ff",
      description: "Karmaşık problemleri, seçenekleri ve riskleri derinlemesine değerlendirir.",
      recommendedEffort: "max",
      systemPrompt: [
        "Sen TaxCLI Derin Analist agentısın.",
        "Problemi varsayımlar, kanıtlar, kısıtlar, alternatifler ve karşı örnekler üzerinden çözümle.",
        "Belirsizliği saklama; kesin bilgiyle çıkarımı ayır ve en güçlü karşı görüşü değerlendir.",
        "Kullanıcı açıkça uygulama istemedikçe dosya değiştirme.",
        "Sonunda net bir sonuç veya öneri ver; düşünce sürecini ham biçimde dökmeden gerekçeyi özetle."
      ].join("\n")
    }
  ];

  const byId = Object.freeze(Object.fromEntries(profiles.map((profile) => [profile.id, Object.freeze(profile)])));
  const profileIds = Object.freeze(profiles.map((profile) => profile.id));

  function normalizeAgentId(value) {
    const id = String(value || "").trim().toLowerCase();
    return profileIds.includes(id) ? id : "auto";
  }

  function countMatches(text, expressions) {
    return expressions.reduce((score, expression) => score + (expression.test(text) ? 1 : 0), 0);
  }

  function classifyPrompt(prompt, context = {}) {
    if (context.plan) return "planner";
    const text = String(prompt || "").toLocaleLowerCase("tr-TR");
    if (!text.trim()) return context.hasImages ? "analyst" : "everyday";

    const scores = {
      planner: countMatches(text, [
        /\b(plan|planla|planlama|yol haritası|roadmap|mimari tasarla|strateji|adım adım plan)\b/u,
        /\b(uygulama|kod yazma|değişiklik yapma)\b.{0,20}\b(sadece|yalnızca)?\s*(plan|öner)/u,
        /\b(requirements?|gereksinim|kapsam|milestone)\b/u
      ]) * 3,
      coder: countMatches(text, [
        /(kod|code|bug|hata|düzelt|refactor|test|api|endpoint|veritaban|database|component|fonksiyon|class|repo|proje|uygula|implement|build|derle|deploy)/u,
        /\b(js|ts|tsx|jsx|css|html|python|java|rust|golang|sql|node|react|electron)(?:\b|\.)/u,
        /(web sitesi|web site|web app|uygulama geliştir|program yaz|cli aracı|software)/u,
        /(?:^|\s)(?:src\/|src\\|\.\w{1,8}\b|npm |pnpm |git )/u
      ]) * 2,
      analyst: countMatches(text, [
        /\b(analiz|karşılaştır|kıyasla|değerlendir|neden|kök neden|trade.?off|risk|mantık|çıkarım|senaryo|olasılık|kanıt)\b/u,
        /\b(derin düşün|etraflıca|artıları|eksileri|avantaj|dezavantaj)\b/u
      ]) * 2,
      everyday: countMatches(text, [
        /\b(nedir|kimdir|ne demek|nasıl|özetle|açıkla|çevir|yaz|mail|mesaj|fikir|öneri|günlük|sohbet)\b/u,
        /\b(what|who|when|where|explain|summarize|translate)\b/u
      ])
    };

    if (context.browser) scores.analyst += 1;
    if (context.hasImages) scores.analyst += 1;

    const priority = ["planner", "coder", "analyst", "everyday"];
    let winner = "everyday";
    let best = 0;
    for (const id of priority) {
      if (scores[id] > best) {
        winner = id;
        best = scores[id];
      }
    }
    return winner;
  }

  function resolveAgent(requestedId, prompt, context = {}) {
    const requested = normalizeAgentId(requestedId);
    const resolvedId = requested === "auto" ? classifyPrompt(prompt, context) : requested;
    return {
      requestedId: requested,
      resolvedId,
      profile: byId[resolvedId],
      automatic: requested === "auto"
    };
  }

  return Object.freeze({ profiles: Object.freeze(profiles), byId, profileIds, normalizeAgentId, classifyPrompt, resolveAgent });
});
