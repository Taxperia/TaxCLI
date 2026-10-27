const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");

async function verifyUpdateArtifacts(directory, version) {
  const manifest = yaml.load(await fs.readFile(path.join(directory, "latest.yml"), "utf8"));
  if (manifest?.version !== version) throw new Error("latest.yml version does not match package.json");
  const filename = `TaxCLI-Setup-${version}.exe`;
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1 || manifest.files[0].url !== filename || manifest.path !== filename) {
    throw new Error("Update manifest must reference the exact Windows installer");
  }
  const bytes = await fs.readFile(path.join(directory, filename));
  const digest = crypto.createHash("sha512").update(bytes).digest("base64");
  if (!bytes.length || manifest.sha512 !== digest || manifest.files[0].sha512 !== digest || manifest.files[0].size !== bytes.length) {
    throw new Error("Update manifest checksum or size does not match the installer");
  }
  if (!(await fs.stat(path.join(directory, `${filename}.blockmap`))).size) throw new Error("Installer blockmap is empty");
  return { version, filename, size: bytes.length };
}

if (require.main === module) {
  const version = require("../package.json").version;
  verifyUpdateArtifacts(path.resolve(__dirname, "../release"), version)
    .then((result) => console.log(`Verified ${result.filename} and latest.yml (${result.size} bytes)`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifyUpdateArtifacts };
