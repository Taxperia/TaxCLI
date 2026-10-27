const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { NtExecutable, NtExecutableResource, Data, Resource } = require("resedit");
const { prepareDevRuntime } = require("../scripts/dev-runtime");

test("development EXE embeds the application icon without changing Electron and refreshes when the icon changes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "taxcli-dev-runtime-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "electron.exe");
  const iconPath = path.join(directory, "logo.ico");
  const original = Buffer.from(NtExecutable.createEmpty(false, false).generate());
  fs.writeFileSync(source, original);
  const icon = Data.IconFile.from(fs.readFileSync(path.join(__dirname, "../src/logo-icon.ico")));
  fs.writeFileSync(iconPath, Buffer.from(icon.generate()));

  const target = prepareDevRuntime(source, iconPath);
  assert.equal(path.basename(target), "TaxCLI.exe");
  assert.deepEqual(fs.readFileSync(source), original);
  const resources = () => NtExecutableResource.from(NtExecutable.from(fs.readFileSync(target)));
  const initial = resources();
  const icons = Resource.IconGroupEntry.fromEntries(initial.entries)[0].getIconItemsFromEntries(initial.entries);
  assert.equal(icons.length, icon.icons.length);
  icons.forEach((item, index) => assert.deepEqual(Buffer.from(item.bin), Buffer.from(icon.icons[index].data.bin)));
  const version = Resource.VersionInfo.fromEntries(initial.entries)[0];
  assert.equal(version.getStringValues(version.getAllLanguagesForStringValues()[0]).ProductName, "TaxCLI");

  const modifiedAt = fs.statSync(target).mtimeMs;
  assert.equal(prepareDevRuntime(source, iconPath), target);
  assert.equal(fs.statSync(target).mtimeMs, modifiedAt);
  icon.icons.pop();
  fs.writeFileSync(iconPath, Buffer.from(icon.generate()));
  prepareDevRuntime(source, iconPath);
  assert.equal(Resource.IconGroupEntry.fromEntries(resources().entries)[0].icons.length, icon.icons.length);
  assert.deepEqual(fs.readFileSync(source), original);
});

test("a branded source launch keeps development icon paths and installed releases keep their packaged identity", () => {
  const mainDirectory = path.resolve(__dirname, "../electron");
  const source = fs.readFileSync(path.join(mainDirectory, "main.js"), "utf8");
  const configuration = source.slice(source.indexOf("const IS_PACKAGED ="), source.indexOf("\nfunction showMainWindow"));
  const resourcesPath = path.resolve("fixture-resources");
  const read = (defaultApp) => vm.runInNewContext(`${configuration}\n({ packaged: IS_PACKAGED, id: APP_ID, icon: APP_ICON })`, {
    app: { isPackaged: true }, process: { platform: "win32", resourcesPath, defaultApp }, path, __dirname: mainDirectory
  });
  const development = read(true);
  assert.equal(development.packaged, false);
  assert.equal(development.icon, path.resolve(mainDirectory, "../src/logo-icon.ico"));
  assert.equal(development.id, "com.taxperia.taxcli.dev");
  const installed = read(undefined);
  assert.equal(installed.packaged, true);
  assert.equal(installed.icon, path.join(resourcesPath, "logo-icon.ico"));
  assert.equal(installed.id, require("../package.json").build.appId);
});
