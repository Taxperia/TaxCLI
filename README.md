<div align="center">
  <h1>TaxCLI</h1>
  <p><strong>One local workspace for the AI coding CLIs you already use.</strong></p>
  <p>Run Codex, OpenCode, Cursor Agent, GitHub Copilot, Gemini CLI, and NVIDIA-backed models from a focused Windows desktop interface.</p>

  <p>
    <img alt="Status: Alpha" src="https://img.shields.io/badge/status-alpha-f59e0b">
    <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078D4">
    <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F">
    <img alt="License: Non-commercial" src="https://img.shields.io/badge/license-non--commercial-f59e0b">
  </p>
</div>

> [!WARNING]
> This project is an early alpha and can start local processes with access to your selected project. Use test repositories, review agent permissions, and read the [security notes](SECURITY.md) before using real credentials.

## Why TaxCLI?

AI coding agents are powerful, but each ships with a different command, login flow, model list, output format, and project memory convention. TaxCLI keeps the official CLIs as the execution layer while providing one local interface for projects, prompts, model selection, streaming output, history, and agent instructions.

It is local-first: agent processes run on your computer and use the accounts or API keys configured for their own CLIs. TaxCLI is not an AI model and does not proxy prompts through a TaxCLI server.

## What works today

- Detect installed Codex, OpenCode, Cursor Agent, GitHub Copilot, and Gemini CLIs
- Launch official login flows and inspect available authentication state
- Run supported agents inside a selected project and stop active processes
- Stream structured Codex and OpenCode events into a desktop conversation
- Select models per engine, including models discovered from OpenCode
- Keep project-scoped conversation history on the local machine
- Generate shared project memory plus `AGENTS.md`, `GEMINI.md`, Cursor rules, and Copilot instructions
- Open an integrated PowerShell session for the selected project
- Attach local images to supported agent runs
- Use an experimental embedded browser and plugin surface

Some adapters and UI surfaces remain experimental. See the [roadmap](docs/CLI-ROADMAP.md) for the distinction between the current desktop MVP and the planned command-line product.

## Requirements

- Windows 10 or later
- Node.js 22.12 or later
- At least one supported AI coding CLI installed and authenticated

Agent subscriptions, usage fees, and API keys are managed by their respective providers. This project is not affiliated with OpenAI, Google, GitHub, Microsoft, Anysphere, NVIDIA, or the OpenCode maintainers.

## Run from source

```powershell
# Clone or download this repository, then open it:
cd path\to\TaxCLI
npm ci
npm start
```

Check JavaScript syntax without starting Electron:

```powershell
npm run check
```

## Download and updates

Windows installers are published on [GitHub Releases](https://github.com/Taxperia/TaxCLI/releases). Packaged builds check GitHub for updates shortly after startup and every four hours. New versions download automatically; TaxCLI asks before restarting to install them. You can also check manually from **Settings → General → Updates**.

The alpha installer is not yet code-signed and may trigger a Windows SmartScreen warning. Verify that downloads come from the official Taxperia repository and compare release checksums when available.

## Supported engines

- **Codex:** local detection, authentication status, model handling, and structured run streaming
- **OpenCode:** local detection, authentication, model discovery, and structured run streaming
- **Cursor Agent:** local detection, login, and runtime adapter; output compatibility can vary by CLI version
- **GitHub Copilot:** local detection, GitHub authentication, model discovery, and runtime adapter
- **Gemini CLI:** local detection, API-key or local authentication, model selection, and runtime adapter
- **NVIDIA models:** API-key configuration through the OpenCode execution path

Provider CLIs evolve independently. Please include the provider CLI version when reporting adapter bugs.

## Project memory

The memory generator creates `.aihub/` as a shared source of project context and adds provider-specific instruction files only when they do not already exist. Generated files should still be reviewed before committing them.

## Security and privacy

- TaxCLI can execute commands and modify files through installed agent CLIs.
- Provider keys are currently stored as local JSON and are **not yet protected by the Windows credential vault**.
- The embedded browser is experimental and should not be used for sensitive accounts.
- Conversation history and project paths are stored locally.

The prioritized hardening plan is in [Security Hardening](docs/SECURITY-HARDENING.md). Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Documentation

- [CLI and distribution roadmap](docs/CLI-ROADMAP.md)
- [Security hardening ideas](docs/SECURITY-HARDENING.md)
- [GitHub launch, naming, description, and topics](docs/GITHUB-LAUNCH.md)
- [Changelog](CHANGELOG.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Contributing

Issues and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and avoid posting secrets or security vulnerabilities in public issues.

## License

Copyright © 2026 [Taxperia](https://github.com/Taxperia).

The source is available under the [Taxperia Non-Commercial Attribution License](LICENSE). Non-commercial use and modification are permitted with visible attribution. Commercial use requires a separate written license from Taxperia. This is a source-available license and is not an OSI-approved open-source license.

Bundled dependencies and assets retain their own licenses; see [Third-Party Notices](THIRD_PARTY_NOTICES.md).
