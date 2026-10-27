const { spawn } = require("node:child_process");
const electron = require("electron");
const path = require("node:path");

const executable = process.platform === "win32"
  ? require("./dev-runtime").prepareDevRuntime(electron, path.join(__dirname, "..", "src", "logo-icon.ico"))
  : electron;

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(executable, [path.join(__dirname, "..")], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: false
});

child.on("error", (error) => {
  console.error("TaxCLI başlatılamadı:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
