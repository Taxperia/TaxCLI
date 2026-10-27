const required = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
const missing = required.filter((name) => !String(process.env[name] || "").trim());

if (missing.length) {
  console.error(`İmzalı sürüm oluşturulamadı. Eksik değişkenler: ${missing.join(", ")}`);
  console.error("Sertifika bilgileri olmadan yayımlanabilir Windows paketi üretmek güvenlik nedeniyle engellendi.");
  process.exit(1);
}
