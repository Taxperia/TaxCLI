const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { NtExecutable, NtExecutableResource, Data, Resource } = require("resedit");

function prepareDevRuntime(electronPath, iconPath) {
  // Keep Electron's DLLs and resources alongside the branded development EXE.
  // The original electron.exe remains untouched.
  const target = path.join(path.dirname(electronPath), "TaxCLI.exe");
  const stampPath = `${target}.branding.json`;
  const sourceStat = fs.statSync(electronPath);
  const icon = fs.readFileSync(iconPath);
  const fingerprint = crypto.createHash("sha256")
    .update(JSON.stringify([1, sourceStat.size, sourceStat.mtimeMs]))
    .update(icon).digest("hex");
  try {
    if (JSON.parse(fs.readFileSync(stampPath, "utf8")).fingerprint === fingerprint && fs.existsSync(target)) return target;
  } catch { /* Generate the development runtime on first launch or after an update. */ }

  const executable = NtExecutable.from(fs.readFileSync(electronPath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const icons = Data.IconFile.from(icon).icons.map((item) => item.data);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  for (const version of versions.length ? versions : [Resource.VersionInfo.createEmpty()]) {
    const languages = version.getAllLanguagesForStringValues();
    for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }]) {
      version.setStringValues(language, {
        ProductName: "TaxCLI", FileDescription: "TaxCLI",
        InternalName: "TaxCLI", OriginalFilename: "TaxCLI.exe"
      });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, Buffer.from(executable.generate()));
    fs.renameSync(temporary, target);
    fs.writeFileSync(stampPath, JSON.stringify({ fingerprint }));
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return target;
}

module.exports = { prepareDevRuntime };
