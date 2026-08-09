# Security Hardening Plan

This is a prioritized engineering backlog, not a claim that the current alpha is hardened. TaxCLI sits at a sensitive boundary: untrusted project content and web content can influence AI agents that inherit the user's filesystem and process permissions.

## P0 — Before distributing binaries

### Move secrets out of JSON files

Provider keys are currently written to `provider-keys.json` and, for NVIDIA/OpenCode, to OpenCode's authentication file. Store TaxCLI-owned secrets with Windows Credential Manager or Electron `safeStorage`. Restrict file permissions for unavoidable provider files, migrate existing values once, and delete the plaintext copy only after successful migration.

The renderer should receive only `configured: true` plus a minimal masked hint, never the secret itself. Redact secrets from errors, child-process output, diagnostics, history, and crash reports.

### Disable or isolate the embedded browser

The current `<webview>` surface can load arbitrary HTTP/HTTPS pages and execute JavaScript inside them. Calling it “sandboxed” overstates the protection. Disable it by default until there is a threat model.

If retained:

- Remove `allowpopups`.
- Permit only `https:` navigation, with an explicit exception for controlled local development.
- Validate `will-attach-webview`, strip preload scripts, and force secure web preferences.
- Block permissions by default: camera, microphone, geolocation, notifications, MIDI, Bluetooth, serial, USB, clipboard, and screen capture.
- Restrict downloads and new windows.
- Keep browser sessions separate from application/provider authentication.
- Never pass page text directly into an auto-approved agent action.
- Treat page content as prompt-injection-controlled input.

For automation, prefer a separate browser process or a constrained Playwright worker with a disposable profile, domain allowlist, download quarantine, and no access to provider secrets.

### Validate every IPC request

The preload bridge exposes project paths, terminal input, history writes, process starts, provider configuration, image imports, and external URLs. Add strict schemas and enforce them in the main process.

- Confirm the sender belongs to the trusted application window.
- Bind project operations to a registered project ID instead of accepting arbitrary absolute paths.
- Canonicalize paths with `realpath`, handle junctions/symlinks, and verify containment.
- Limit prompt, terminal input, history, image, and event sizes.
- Allowlist engine IDs, model formats, URL schemes, and provider IDs.
- Return stable error codes without sensitive path or environment details.

### Establish a trusted-project boundary

Adding a folder should not automatically authorize all actions. Show the canonical path, Git remote, and requested capabilities. Store trust per project and require confirmation when the path or repository identity changes.

Default to read-only or ask mode for a new project. Make full-auto behavior explicit, temporary, and visually persistent.

### Add a real approval and policy layer

UI labels alone are not a security boundary. Normalize agent tool events and evaluate them before execution where provider protocols permit.

At minimum classify:

- File reads outside the project
- File writes and deletes
- Shell commands
- Network access
- Package installation
- Git push, release, and destructive Git operations
- Credential/configuration access
- Process launching and persistence

Show the exact command, canonical paths, environment-variable names, and diff summary. Never offer a global “approve everything forever” shortcut.

## P1 — Before a public beta

### Harden Electron

Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Add:

- A restrictive Content Security Policy without `unsafe-eval`
- Navigation blocking for the application window
- Permission request and permission check handlers that deny by default
- Strict external URL handling with normalized `https:` URLs
- No remote module, exposed `ipcRenderer`, or generic invoke channel
- Fuses that disable `RunAsNode`, embedded ASAR integrity bypasses, and unnecessary Node options in packaged builds

Review all HTML generation paths for cross-site scripting. Project names, model labels, CLI output, Markdown, filenames, and browser content are untrusted even when they originate locally.

### Reduce child-process risk

Continue using executable-plus-argument arrays with `shell: false` whenever possible. Replace PowerShell command strings used for login launchers with safer argument construction.

- Resolve executables from trusted locations and display the resolved path.
- Detect executable replacement after trust is granted.
- Inherit only required environment variables.
- Cap stdout/stderr and event-buffer sizes.
- Kill complete process trees on stop, timeout, app exit, and crash recovery.
- Do not log full command environments.
- Require confirmation before launching executables found inside the selected repository.

### Protect local data

- Define retention for conversations, prompts, imported images, run events, and temporary files.
- Delete temporary attachments after the run and on startup cleanup.
- Use atomic writes and restrictive permissions.
- Encrypt sensitive history or clearly document that it is plaintext.
- Add “export my data” and “delete all local data” actions with previews.
- Avoid placing secrets in `localStorage`.

### Treat AI output and project instructions as hostile

Repository files, generated instructions, MCP tool descriptions, terminal output, and websites can contain prompt injection.

- Keep system policy outside project-writable files.
- Clearly label trusted user instructions versus untrusted retrieved content.
- Require approval for high-risk actions regardless of model claims.
- Add output redaction and secret-pattern detection.
- Warn on instructions asking to disable protections, upload repositories, or reveal credentials.
- Do not let browser content silently change approval mode or tool access.

### Secure updates and releases

- Protect release workflows with least-privilege GitHub permissions.
- Pin GitHub Actions by commit SHA.
- Sign Windows artifacts and updates.
- Publish SHA-256 checksums, provenance, and an SBOM.
- Verify update signatures before installation.
- Support rollback and staged rollout.
- Never execute unsigned downloaded scripts as an updater.

## P2 — Defense in depth

- Run agents in disposable Git worktrees.
- Offer Windows Sandbox, containers, or a low-privilege worker account for risky runs.
- Add network egress controls by domain and provider.
- Add append-only, redacted audit events with export.
- Detect likely secrets before a command, diff, prompt, or attachment leaves the machine.
- Add rate and cost limits per engine and project.
- Add signed plugin manifests, capability declarations, and revocation.
- Separate browser, terminal, provider, and filesystem capabilities into distinct grants.
- Add crash recovery that marks incomplete actions and never silently resumes writes.

## Security features that could differentiate the project

- **Permission receipts:** a readable record of what the agent requested, what the user approved, and what changed.
- **Safe-run mode:** automatic temporary worktree, network off by default, read-only credentials, and mandatory diff review.
- **Secret shield:** scan prompts, diffs, terminal output, and attachments before sending them to a provider.
- **Executable trust:** show binary publisher, hash, version, and resolved path before first use.
- **Provider policy profiles:** consistent `ask`, `edit`, and `plan` semantics mapped honestly to each provider.
- **Project risk score:** warn about unsigned scripts, suspicious instruction files, credential files, and unusual hooks before starting.
- **One-click containment:** stop all child processes, disable network-capable plugins, and preserve a redacted incident bundle.

## Verification

Security work should include automated tests for:

- Path traversal, junctions, symlinks, UNC paths, and device paths
- Malformed and oversized IPC payloads
- XSS through project names, Markdown, CLI events, filenames, and model metadata
- Shell metacharacters and hostile executable paths
- Secret redaction across logs and errors
- Webview navigation, permissions, popups, and downloads
- Process-tree cleanup
- Update signature failures and rollback

Before 1.0, create a threat model, commission an independent Electron/security review, and publish the remaining known limitations.
