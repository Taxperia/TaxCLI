# Contributing

Thanks for helping improve TaxCLI. The project is in alpha, so small, focused changes with clear testing notes are the easiest to review.

## Before opening an issue

- Search existing issues first.
- Confirm the bug still occurs on the latest default branch.
- For provider-specific problems, include the provider CLI name and version.
- Remove tokens, API keys, personal paths, private prompts, and proprietary source code from logs.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Windows 10 or later
- Node.js 22.12 or later
- npm
- One supported provider CLI when testing an adapter

```powershell
# Fork and clone the repository, then open it:
cd path\to\TaxCLI
npm ci
npm run check
npm start
```

## Pull requests

1. Create a branch from the latest default branch.
2. Keep the change scoped to one problem.
3. Preserve Electron's `contextIsolation`, disabled `nodeIntegration`, and sandbox settings.
4. Validate all renderer-to-main IPC inputs at the main-process boundary.
5. Do not add telemetry, remote services, or new credential storage without explicit documentation and maintainer agreement.
6. Run `npm run check`.
7. Explain what changed, why, how it was tested, and any security impact.

UI changes should include a screenshot or short recording. Adapter changes should include sanitized sample output or a reproducible test command.

## Code style

- Follow the existing JavaScript style and keep functions focused.
- Use `spawn` with argument arrays and `shell: false` for non-interactive commands.
- Treat project files, CLI output, browser content, and IPC payloads as untrusted input.
- Escape untrusted values before inserting HTML.
- Avoid unrelated formatting or refactoring in feature and bug-fix pull requests.

## Adding an engine

Document:

- Installation and official documentation URL
- Executable names and supported platforms
- Authentication and logout behavior
- Version detection
- Model discovery
- Non-interactive invocation arguments
- Streaming output schema
- Approval and sandbox semantics
- Environment variables and credential handling
- Stop, timeout, and failure behavior

An engine must not silently weaken the user's provider-side approval or sandbox settings.

## Contribution licensing

The project uses a non-commercial public license and may offer separate commercial licenses. By intentionally submitting a contribution, you represent that you have the right to submit it and grant Taxperia a perpetual, worldwide, irrevocable, non-exclusive, royalty-free license to use, reproduce, modify, distribute, sublicense, and relicense that contribution, including under commercial terms.

Your contribution remains available to the public as part of this project under the [Taxperia Non-Commercial Attribution License](LICENSE). Do not submit employer-owned or third-party code unless you have documented permission.

## Commit messages

Use short, imperative messages that explain the intent, for example:

```text
fix: reject non-project history paths
docs: explain provider credential storage
feat: add version diagnostics command
```

By contributing, you accept the contribution licensing terms above and agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
