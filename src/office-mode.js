(function exposeOfficeMode(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root) root.TaxCliOffice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOfficeMode() {
  "use strict";

  const ROLE_DEFINITIONS = Object.freeze({
    manager: {
      label: "Ofis yöneticisi",
      icon: "fa-solid fa-user-tie",
      color: "#9cff72",
      defaultInstructions: "İşi uzmanlara böl, bağımlılıkları yönet, çıktıları eleştir ve en iyi sonucu ana projede birleştir."
    },
    developer: {
      label: "Yazılım geliştirici",
      icon: "fa-solid fa-code",
      color: "#73e6c0",
      defaultInstructions: "Kod tabanını incele, görevini uygula, test et ve değişiklikleri açıkça raporla."
    },
    frontend: {
      label: "Frontend geliştirici",
      icon: "fa-solid fa-display",
      color: "#72d9ff",
      defaultInstructions: "Arayüzü, istemci tarafı davranışlarını, erişilebilirliği ve responsive görünümü uygula; bileşen sınırlarını ve doğrulamayı açıkça raporla."
    },
    backend: {
      label: "Backend geliştirici",
      icon: "fa-solid fa-server",
      color: "#7ee6a8",
      defaultInstructions: "API, veri modeli, iş kuralları, kimlik doğrulama ve sunucu tarafı testlerini uygula; frontend için entegrasyon sözleşmesini açıkça belirt."
    },
    designer: {
      label: "Görsel tasarımcı",
      icon: "fa-solid fa-palette",
      color: "#f49ad2",
      defaultInstructions: "Arayüz, görsel dil ve kullanıcı deneyimini tasarla; mümkünse proje içinde kullanılabilir SVG/CSS/görsel varlık üret."
    },
    researcher: {
      label: "Fikir ve araştırma",
      icon: "fa-solid fa-lightbulb",
      color: "#f2c879",
      defaultInstructions: "Alternatif fikirler, kullanıcı ihtiyaçları, ürün fırsatları ve uygulanabilir öneriler üret."
    },
    security: {
      label: "Güvenlik denetçisi",
      icon: "fa-solid fa-shield-halved",
      color: "#82b8ff",
      defaultInstructions: "Tehdit modeli çıkar, güvenlik ve gizlilik açıklarını denetle, doğrulanabilir düzeltmeler öner."
    },
    reviewer: {
      label: "Kalite denetçisi",
      icon: "fa-solid fa-magnifying-glass-check",
      color: "#d1a4ff",
      defaultInstructions: "Gereksinimler, kod kalitesi, testler, erişilebilirlik ve kenar durumları açısından bağımsız inceleme yap."
    }
  });

  const DEFAULT_TEAM = Object.freeze([
    { id: "manager", name: "Ada", role: "manager", engineId: "codex", accountId: "", model: "", enabled: true, avatar: "", instructions: "" },
    { id: "frontend", name: "Mert", role: "frontend", engineId: "codex", accountId: "", model: "", enabled: true, avatar: "", instructions: "" },
    { id: "backend", name: "Deniz", role: "backend", engineId: "opencode", accountId: "", model: "", enabled: true, avatar: "", instructions: "" },
    { id: "designer", name: "Lina", role: "designer", engineId: "gemini", model: "", enabled: true, avatar: "", instructions: "" },
    { id: "researcher", name: "Ece", role: "researcher", engineId: "opencode", model: "", enabled: true, avatar: "", instructions: "" },
    { id: "security", name: "Atlas", role: "security", engineId: "copilot", model: "", enabled: true, avatar: "", instructions: "" }
  ]);

  const ROLE_ALIASES = Object.freeze({
    lead: "manager",
    boss: "manager",
    owner: "manager",
    "team-lead": "manager",
    yonetici: "manager",
    "ofis-yoneticisi": "manager",
    coder: "developer",
    engineer: "developer",
    "software-developer": "developer",
    "software-engineer": "developer",
    kodlayici: "developer",
    "yazilim-gelistirici": "developer",
    ui: "frontend",
    "ui-developer": "frontend",
    "front-end": "frontend",
    "frontend-developer": "frontend",
    arayuz: "frontend",
    api: "backend",
    server: "backend",
    "back-end": "backend",
    "backend-developer": "backend",
    tasarimci: "designer",
    "gorsel-tasarimci": "designer",
    research: "researcher",
    planner: "researcher",
    arastirmaci: "researcher",
    security_auditor: "security",
    "security-auditor": "security",
    "guvenlik-denetcisi": "security",
    quality: "reviewer",
    qa: "reviewer",
    tester: "reviewer",
    analyst: "reviewer",
    "quality-reviewer": "reviewer",
    "kalite-denetcisi": "reviewer"
  });

  function foldRoleText(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[ıİ]/g, "i")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ç/g, "c")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function roleFromValue(value) {
    const token = foldRoleText(value);
    if (ROLE_DEFINITIONS[token]) return token;
    return ROLE_ALIASES[token] || "";
  }

  function inferRoleFromMember(member, { includeRole = true } = {}) {
    const directFields = [
      ...(includeRole ? [member?.role] : []),
      member?.specialty,
      member?.type,
      member?.agentRole,
      member?.profile,
      member?.profileId
    ];
    for (const value of directFields) {
      const role = roleFromValue(value);
      if (role) return role;
    }

    const evidence = foldRoleText([
      member?.id,
      member?.name,
      member?.title,
      member?.specialty,
      member?.instructions
    ].filter(Boolean).join(" "));
    const patterns = [
      ["manager", /(^|-)(manager|yonetici|team-lead|lead|boss|owner)(-|$)/],
      ["security", /(^|-)(security|guvenlik)(-|$)/],
      ["frontend", /(^|-)(frontend|front-end|ui|arayuz|react)(-|$)/],
      ["backend", /(^|-)(backend|back-end|api|server|sunucu|veri)(-|$)/],
      ["designer", /(^|-)(designer|design|tasarimci|tasarim|gorsel|ux)(-|$)/],
      ["researcher", /(^|-)(researcher|research|arastirmaci|arastirma|fikir|planner)(-|$)/],
      ["developer", /(^|-)(developer|coder|engineer|kodlayici|kod|yazilim)(-|$)/],
      ["reviewer", /(^|-)(reviewer|quality|kalite|qa|tester|analyst|denetci)(-|$)/]
    ];
    return patterns.find(([, pattern]) => pattern.test(evidence))?.[0] || "";
  }

  function slug(value, fallback = "agent") {
    const clean = String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    return clean || fallback;
  }

  function normalizeMember(member, index = 0, { repairCollapsedRole = false } = {}) {
    const declaredRole = roleFromValue(member?.role);
    const recoveredRole = inferRoleFromMember(member);
    let role = declaredRole || recoveredRole || DEFAULT_TEAM[index]?.role || "reviewer";
    if (repairCollapsedRole && role === "reviewer") {
      const evidenceRole = inferRoleFromMember(member, { includeRole: false });
      if (evidenceRole && evidenceRole !== "reviewer") role = evidenceRole;
    }
    return {
      id: slug(member?.id || `${role}-${index + 1}`),
      name: String(member?.name || ROLE_DEFINITIONS[role].label).trim().slice(0, 40) || ROLE_DEFINITIONS[role].label,
      role,
      engineId: String(member?.engineId || "codex").trim().toLowerCase(),
      accountId: /^[a-f0-9-]{20,64}$/i.test(String(member?.accountId || "")) ? String(member.accountId) : "",
      model: String(member?.model || "").trim().slice(0, 160),
      enabled: member?.enabled !== false,
      avatar: /^data:image\/(png|jpe?g|webp);base64,/i.test(String(member?.avatar || "")) ? String(member.avatar).slice(0, 350000) : "",
      avatarPreset: /^[a-z0-9-]{1,24}$/i.test(String(member?.avatarPreset || "")) ? String(member.avatarPreset) : "",
      instructions: String(member?.instructions || "").trim().slice(0, 4000)
    };
  }

  function normalizeTeam(value, { repairCollapsedRoles = false } = {}) {
    const source = Array.isArray(value) && value.length ? value : DEFAULT_TEAM;
    const used = new Set();
    const team = source.slice(0, 8).map((member, index) => normalizeMember(member, index, { repairCollapsedRole: repairCollapsedRoles })).map((member, index) => {
      let id = member.id;
      while (used.has(id)) id = `${member.id}-${index + 1}`;
      used.add(id);
      return { ...member, id };
    });
    const managers = team.filter((member) => member.role === "manager");
    if (!managers.length && team.length) team[0].role = "manager";
    let foundManager = false;
    for (const member of team) {
      if (member.role !== "manager") continue;
      if (!foundManager) foundManager = true;
      else member.role = "reviewer";
    }
    return team;
  }

  function roleDefinition(role) {
    return ROLE_DEFINITIONS[role] || ROLE_DEFINITIONS.reviewer;
  }

  function managerOf(team) {
    return normalizeTeam(team).find((member) => member.role === "manager" && member.enabled)
      || normalizeTeam(team).find((member) => member.enabled)
      || null;
  }

  function workersOf(team) {
    const normalized = normalizeTeam(team);
    const manager = managerOf(normalized);
    return normalized.filter((member) => member.enabled && member.id !== manager?.id);
  }

  function buildPlanningPrompt(task, team) {
    const manager = managerOf(team);
    const workers = workersOf(team);
    const roster = workers.map((worker) => {
      const role = roleDefinition(worker.role);
      return `- ${worker.id}: ${worker.name} — ${role.label} — ${worker.engineId}${worker.model ? `/${worker.model}` : ""}\n  Yetki: ${worker.instructions || role.defaultInstructions}`;
    }).join("\n");
    return `[TaxCLI AI OFİSİ — YÖNETİCİ PLANLAMA]
Sen ${manager?.name || "ofis yöneticisi"} adlı yönetici ajansın. Kullanıcının hedefini uzman çalışanlara paylaştır.
Bu aşamada dosya değiştirme veya komut çalıştırma. Çalışanların aynı anda ve izole proje kopyalarında çalışacağını varsay.

Dağıtım ilkeleri:
- Görevi meslek adına göre değil, birbirinden bağımsız teslimat ve dosya/modül sınırlarına göre böl.
- Bir web ürünü hem arayüz hem sunucu işi gerektiriyorsa frontend/UI ile backend/API-veri-auth işlerini farklı uygun çalışanlara ver.
- Frontend ve backend arasında endpoint, veri şekli, hata biçimi ve sahip olunan dosyaları kabul ölçütlerinde sözleşme olarak yaz.
- Aynı dosyayı iki çalışana değiştirtme. Araştırma, güvenlik ve kalite çalışanlarını kod yazanların işini tekrar etmeyecek bağımsız doğrulama görevlerine ata.

KULLANICI HEDEFİ:
${String(task || "").trim()}

OFİS KADROSU:
${roster || "Etkin çalışan yok."}

Yalnızca aşağıdaki JSON biçiminde yanıt ver:
{
  "summary": "kısa yönetim yaklaşımı",
  "assignments": [
    {"workerId":"çalışan id", "task":"net teslimat", "acceptance":"kabul ölçütleri", "dependencies":[]}
  ],
  "integrationCriteria": ["sonuçları seçme ve birleştirme ölçütü"]
}
Her etkin çalışana tam bir görev ver. Görevler çakışmasın, birbirini tamamlasın ve dependencies alanında ihtiyaç duyulan çalışan kimliklerini belirt.`;
  }

  function extractJson(text) {
    const raw = String(text || "").trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
  }

  function fallbackPlan(task, team) {
    const workers = workersOf(team);
    return {
      summary: "Görev uzmanlık alanlarına göre paralel olarak bölündü.",
      assignments: workers.map((worker) => ({
        workerId: worker.id,
        task: `${roleDefinition(worker.role).label} sorumluluğunda, yalnızca kendi modül sınırında şu hedefi gerçekleştir: ${String(task || "").trim()}`,
        acceptance: worker.role === "frontend"
          ? "Çalışan arayüz, responsive ve erişilebilir durumlar, backend entegrasyon noktaları ve doğrulama sun."
          : worker.role === "backend"
            ? "Çalışan API/veri katmanı, doğrulama ve hata sözleşmesi ile test sonucu sun."
            : "Somut bulgular, uygulanabilir çıktı ve doğrulama sun.",
        dependencies: []
      })),
      integrationCriteria: ["Kullanıcı hedefini karşılama", "Teknik doğruluk", "Güvenlik", "Test edilebilirlik", "Tutarlı kullanıcı deneyimi"]
    };
  }

  function parsePlan(text, task, team) {
    const fallback = fallbackPlan(task, team);
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.assignments)) return fallback;
    const workerIds = new Set(workersOf(team).map((worker) => worker.id));
    const byId = new Map();
    for (const item of parsed.assignments) {
      const workerId = String(item?.workerId || "");
      if (!workerIds.has(workerId) || byId.has(workerId)) continue;
      byId.set(workerId, {
        workerId,
        task: String(item?.task || "").trim().slice(0, 6000),
        acceptance: String(item?.acceptance || "").trim().slice(0, 3000),
        dependencies: Array.isArray(item?.dependencies) ? item.dependencies.map(String).slice(0, 8) : []
      });
    }
    for (const item of fallback.assignments) if (!byId.has(item.workerId)) byId.set(item.workerId, item);
    return {
      summary: String(parsed.summary || fallback.summary).trim().slice(0, 2000),
      assignments: [...byId.values()],
      integrationCriteria: Array.isArray(parsed.integrationCriteria)
        ? parsed.integrationCriteria.map(String).filter(Boolean).slice(0, 12)
        : fallback.integrationCriteria
    };
  }

  function buildWorkerPrompt({ task, worker, assignment, managerName, workspacePath }) {
    const role = roleDefinition(worker.role);
    const readOnly = ["security", "researcher", "reviewer"].includes(worker.role);
    return `[TaxCLI AI OFİSİ — PARALEL ÇALIŞAN]
Sen ${worker.name} adlı ${role.label} çalışanısın. Yönetici: ${managerName || "Ofis yöneticisi"}.
${worker.instructions || role.defaultInstructions}

ANA HEDEF:
${String(task || "").trim()}

SANA VERİLEN İŞ:
${assignment?.task || role.defaultInstructions}

KABUL ÖLÇÜTLERİ:
${assignment?.acceptance || "Somut, doğrulanmış ve uygulanabilir bir çıktı üret."}

BAĞIMLILIKLAR / ENTEGRASYON:
${assignment?.dependencies?.length ? assignment.dependencies.join(", ") : "Bağımsız çalış; dış sözleşmeleri raporunda açıkça belirt."}

ÇALIŞMA ALANI:
${workspacePath || "İzole proje kopyası"}

Kurallar:
- Diğer çalışanlar aynı anda ayrı kopyalarda çalışıyor; onların dosyalarına güvenme.
- ${readOnly ? "Projeyi değiştirme; inceleme, bulgu ve öneri üret." : "Kapsamındaki değişiklikleri bu izole kopyada uygula ve doğrula."}
- Sonunda yaptıklarını, doğrulamayı, riskleri ve yöneticinin ana projeye taşıması gerekenleri açıkça yaz.
- Görsel üretim aracı yoksa bunu saklama; uygulanabilir görsel brief, SVG/CSS veya asset spesifikasyonu üret.`;
  }

  function buildSynthesisPrompt({ task, manager, plan, results }) {
    const resultText = results.map((result, index) => `## ${index + 1}. ${result.worker.name} — ${roleDefinition(result.worker.role).label}
Motor: ${result.worker.engineId}${result.worker.model ? ` / ${result.worker.model}` : ""}
İzole çalışma alanı: ${result.workspacePath || "—"}
Durum: ${result.error ? `Hata: ${result.error}` : "Tamamlandı"}
Rapor:
${String(result.answer || "Yanıt yok").slice(0, 18000)}`).join("\n\n");
    return `[TaxCLI AI OFİSİ — YÖNETİCİ ENTEGRASYONU]
Sen ${manager?.name || "ofis yöneticisi"} adlı yönetici ajansın. Çalışanlar görevlerini paralel ve izole kopyalarda tamamladı.

KULLANICI HEDEFİ:
${String(task || "").trim()}

YÖNETİM PLANI:
${String(plan?.summary || "").slice(0, 3000)}

ENTEGRASYON ÖLÇÜTLERİ:
${(plan?.integrationCriteria || []).map((item) => `- ${item}`).join("\n")}

ÇALIŞAN ÇIKTILARI:
${resultText}

Görevin:
1. Çıktıları eleştir, çelişkileri ve tekrarları ayıkla.
2. İzole çalışma alanlarındaki dosyaları gerektiğinde incele.
3. Kullanıcının istediği uygulama işi varsa en iyi değişiklikleri ANA PROJEYE uygula; körlemesine klasör kopyalama yapma.
4. Ana projede testleri/denetimleri çalıştır.
5. Son yanıtta birleşik sonucu, hangi çalışanlardan ne kullandığını, doğrulamayı ve kalan riskleri açıkla.

${manager?.instructions || roleDefinition("manager").defaultInstructions}`;
  }

  return Object.freeze({
    roles: ROLE_DEFINITIONS,
    defaultTeam: DEFAULT_TEAM,
    roleFromValue,
    inferRoleFromMember,
    normalizeMember,
    normalizeTeam,
    roleDefinition,
    managerOf,
    workersOf,
    buildPlanningPrompt,
    parsePlan,
    fallbackPlan,
    buildWorkerPrompt,
    buildSynthesisPrompt
  });
});
