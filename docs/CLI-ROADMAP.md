# CLI and Distribution Roadmap

TaxCLI currently wraps several existing AI coding CLIs in an Electron interface. Windows installer and GitHub Releases packaging are configured, but signing and clean-machine validation are still required. This document describes how to turn the desktop MVP into a reliable Windows application and a real `taxcli` command.

## Product goal

One engine-neutral command should let users inspect, launch, and manage supported coding agents without learning every provider's invocation syntax:

```powershell
taxcli doctor
taxcli engines list
taxcli run "add tests for the parser" --engine codex --approval ask
taxcli history list
taxcli desktop
```

The CLI and Electron app should call the same core library. The desktop process must not remain the only place where engine definitions, validation, state, and process management live.

## Recommended architecture

Split the current main-process logic into testable modules:

```text
src/
  core/
    engines/          provider adapters
    runner/           spawn, events, cancellation, timeout
    policy/           approvals and command/file boundaries
    projects/         trusted project registry
    history/          versioned history storage
    credentials/      Windows Credential Manager adapter
    config/           schema, defaults, migration
  cli/
    index.js          command entry point
  desktop/
    ipc.js            thin, validated Electron bridge
electron/
  main.js             window lifecycle only
```

Each engine adapter should expose the same contract: `detect`, `version`, `authStatus`, `login`, `listModels`, `buildRun`, `parseEvent`, and `stop`.

Use a schema validator for configuration and IPC payloads. Keep rendering, provider adaptation, and process execution separate.

## Proposed commands

### Essential

- `taxcli --version` — print the app and adapter versions
- `taxcli doctor` — verify Node, Git, provider binaries, authentication, writable data directories, and platform support
- `taxcli engines list` — show detected engines and login state
- `taxcli engines login <name>` — start the official provider login flow
- `taxcli models <engine>` — list models reported by an engine
- `taxcli run [prompt]` — run in the current directory, with prompt input also accepted from stdin
- `taxcli stop <run-id>` — stop a detached or background run
- `taxcli config get|set|path` — inspect and update validated configuration
- `taxcli desktop [path]` — open the desktop app for a project

### Later

- `taxcli sessions list|show|resume|delete`
- `taxcli memory init|sync|check`
- `taxcli worktree create|list|remove`
- `taxcli mcp list|add|remove|doctor`
- `taxcli update check|install`
- `taxcli completions powershell|bash|zsh`

## CLI behavior requirements

- Default the project to the current working directory.
- Accept prompts as arguments, stdin, or a file, but never combine them ambiguously.
- Return stable exit codes: success, invalid input, missing engine, authentication failure, rejected approval, interrupted run, and provider failure.
- Send human-readable progress to stderr and final output to stdout.
- Support `--json` and newline-delimited event output for scripts.
- Honor `NO_COLOR`, non-interactive terminals, `Ctrl+C`, and process termination.
- Never print credentials or complete inherited environments.
- Offer `--dry-run` to show the exact executable, sanitized arguments, working directory, model, and policy without launching.
- Version the event schema so integrations do not depend on provider-specific output.

## Packaging plan

### Desktop releases

1. Add `electron-builder` or Electron Forge.
2. Build a Windows installer and portable artifact.
3. Set a stable application ID, publisher, icon set, file locations, and uninstall behavior.
4. Sign executables with an Authenticode certificate.
5. Generate checksums and a software bill of materials.
6. Publish artifacts through GitHub Releases using a protected GitHub Actions environment.
7. Add signed automatic updates only after release signing and rollback are reliable.

### CLI distribution

Start with an npm package containing a small `bin` entry:

```json
{
  "bin": {
    "taxcli": "./src/cli/index.js"
  }
}
```

Keep `"private": true` until the package name, executable name, ownership, release process, and security review are finalized. Alternatives include shipping the CLI inside the signed desktop installer or compiling it into a standalone executable.

## Testing needed before a public release

- Unit tests for argument construction, event parsing, path boundaries, migrations, and redaction
- Contract fixtures for every supported provider and supported version range
- Integration tests using fake executables rather than live accounts
- Electron IPC tests for invalid renderer payloads
- Start, stop, timeout, and child-process cleanup tests
- Installer tests on clean Windows 10 and Windows 11 virtual machines
- Upgrade and uninstall tests that verify user data and credentials are handled intentionally
- Accessibility and keyboard-navigation checks

## Suggested milestones

### 0.2 — Honest alpha

- Packageable Windows build
- `doctor` command
- Versioned engine adapter contract
- Credential vault migration
- Browser disabled by default
- Basic CI and smoke tests

### 0.3 — Scriptable CLI

- `run`, `engines`, `models`, and `config`
- JSON event mode and documented exit codes
- Ctrl+C and orphan-process handling
- Shell completions

### 0.4 — Safe workflows

- Trusted project model
- Policy and approval engine
- Audit log with redaction
- Worktree isolation
- Diff preview before applying agent changes

### 1.0 — Stable release

- Signed installer and updates
- Defined provider compatibility policy
- Security review and threat model
- Reproducible release process, checksums, and SBOM
- Migration and rollback guarantees
- End-user documentation and troubleshooting guide

## Success criteria

The project is ready to call itself a real CLI when a clean Windows machine can install it, run `taxcli doctor`, execute a task from any repository, stream machine-readable output, stop safely, return a documented exit code, and uninstall without leaving unmanaged processes or secrets.
