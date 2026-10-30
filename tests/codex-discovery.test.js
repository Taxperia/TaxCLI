const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const source = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8");
const store = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1023.6123.0_x64__2p2nqsd0c76g0\\app\\Codex.exe";
const npm = "C:\\Users\\test\\AppData\\Roaming\\npm";
const cliScript = path.win32.join(npm, "node_modules/@openai/codex/bin/codex.js");

function resolver(paths, files = [], extraDirs = []) {
  const present = new Set(files);
  const context = vm.createContext({
    process: { platform: "win32", env: { ComSpec: "cmd.exe" } }, path: path.win32,
    enrichedEnv: () => ({}), extraBinDirs: () => extraDirs,
    resolveNodeBinary: async () => ({ command: "C:\\Node\\node.exe", prefix: [] }),
    fs: { access: async (file) => { if (!present.has(file)) throw Error("ENOENT"); } },
    spawn: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough();
      queueMicrotask(() => { child.stdout.write(paths.join("\r\n")); child.emit("close", paths.length ? 0 : 1); });
      return child;
    }
  });
  vm.runInContext(source.slice(source.indexOf("function resolveCommand("), source.indexOf("function resolveNodeBinary(")), context);
  return context.resolveCommand;
}

test("Codex chooses the standalone npm CLI when Store and editor launchers are also discovered", async () => {
  const resolve = resolver([store, path.win32.join(npm, "codex.cmd"), "C:\\VSCode\\codex.exe"], [cliScript]);
  const invocation = await resolve("codex");
  assert.equal(invocation.command, "C:\\Node\\node.exe");
  assert.equal(invocation.prefix[0], cliScript);
  assert.equal(invocation.kind, "node-script");
});

test("a Store desktop launcher alone does not count as an installed CLI", async () => {
  assert.equal(await resolver([store])("codex"), null);
});

test("Store launcher discovery still searches known npm installation folders", async () => {
  const resolve = resolver([store], [path.win32.join(npm, "codex.cmd"), cliScript], [npm]);
  assert.equal((await resolve("codex")).prefix[0], cliScript);
});

test("a standalone Codex executable remains supported", async () => {
  assert.equal((await resolver(["C:\\Tools\\codex.exe"])("codex")).command, "C:\\Tools\\codex.exe");
});

test("other providers retain their executable preference", async () => {
  assert.equal((await resolver(["C:\\Tools\\claude.cmd", "C:\\Tools\\claude.exe"])("claude")).command, "C:\\Tools\\claude.exe");
});

test("login terminals start in the user's folder instead of inheriting the Store app directory", () => {
  let launch;
  const context = vm.createContext({
    process: { platform: "win32" }, os: { homedir: () => "C:\\Users\\test" },
    spawn: (...args) => { launch = args; return { unref() {} }; }
  });
  vm.runInContext(source.slice(source.indexOf("function launchInteractiveTerminal("), source.indexOf("const ENGINE_INSTALL_DOCS")), context);
  context.launchInteractiveTerminal({ command: "C:\\Node\\node.exe", prefix: [cliScript] }, ["login"]);
  assert.equal(launch[2].cwd, "C:\\Users\\test");
  assert.ok(launch[1].at(-1).includes(cliScript));
  assert.ok(launch[1].at(-1).endsWith("'login'"));
});
