(function initMcpMarketplace(globalObject) {
  const catalog = Object.freeze([
    Object.freeze({
      id: "memory",
      name: "MCP Memory",
      publisher: "Model Context Protocol",
      version: "2026.8.31",
      verified: true,
      description: "Projeler arasında yapılandırılmış bilgi grafiği hafızası.",
      risk: "low",
      permissions: ["Yerel MCP verisi"],
      server: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory@2026.8.31"] }
    }),
    Object.freeze({
      id: "sequential-thinking",
      name: "Sequential Thinking",
      publisher: "Model Context Protocol",
      version: "2026.8.31",
      verified: true,
      description: "Karmaşık görevlerde kontrollü, aşamalı problem çözme.",
      risk: "low",
      permissions: ["Model bağlamı"],
      server: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking@2026.8.31"] }
    }),
    Object.freeze({
      id: "filesystem",
      name: "Filesystem",
      publisher: "Model Context Protocol",
      version: "2026.8.31",
      verified: true,
      description: "Yalnızca seçili proje klasöründe dosya okuma ve yazma.",
      risk: "medium",
      permissions: ["Proje dosyalarını okuma", "Proje dosyalarını yazma"],
      server: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "${workspace}"] }
    }),
    Object.freeze({
      id: "playwright",
      name: "Playwright MCP",
      publisher: "Microsoft",
      version: "0.0.83",
      verified: true,
      description: "İzole tarayıcı otomasyonu ve erişilebilirlik ağacı araçları.",
      risk: "high",
      permissions: ["Ağ erişimi", "Tarayıcı kontrolü"],
      server: { command: "npx", args: ["-y", "@playwright/mcp@0.0.83", "--isolated", "--sandbox", "--block-service-workers"] }
    })
  ]);

  function parseConfig(value) {
    if (!String(value || "").trim()) return { mcpServers: {} };
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP yapılandırması bir JSON nesnesi olmalıdır.");
    const source = parsed.mcpServers || parsed.servers || {};
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("MCP sunucuları geçersiz.");
    return { ...parsed, mcpServers: { ...source } };
  }

  function installedIds(value) {
    try { return Object.keys(parseConfig(value).mcpServers); } catch { return []; }
  }

  function addServer(value, serverId) {
    const item = catalog.find((entry) => entry.id === serverId);
    if (!item) throw new Error("MCP kataloğu öğesi bulunamadı.");
    const config = parseConfig(value);
    config.mcpServers[item.id] = JSON.parse(JSON.stringify(item.server));
    delete config.servers;
    return JSON.stringify(config, null, 2);
  }

  function removeServer(value, serverId) {
    const config = parseConfig(value);
    delete config.mcpServers[String(serverId || "")];
    delete config.servers;
    return JSON.stringify(config, null, 2);
  }

  const api = { catalog, parseConfig, installedIds, addServer, removeServer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalObject.TaxCliMcpMarketplace = api;
})(typeof window !== "undefined" ? window : globalThis);
