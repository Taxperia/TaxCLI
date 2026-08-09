# Security Policy

TaxCLI launches third-party AI coding CLIs with access to user-selected projects. A vulnerability may therefore expose source code, credentials, local files, or command execution. Please report security issues privately and responsibly.

## Supported versions

The project is currently in alpha. Security fixes are applied only to the latest version on the default branch until the first stable release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

1. Open the repository's **Security** tab.
2. Select **Advisories** and then **Report a vulnerability**.
3. Include affected versions, impact, reproduction steps, and a minimal proof of concept when safe.
4. Remove API keys, tokens, personal paths, and private source code from screenshots and logs.

If private vulnerability reporting is not enabled yet, contact the repository owner through the private contact method listed on their GitHub profile and ask for a secure reporting channel.

You should receive an acknowledgement within 7 days. We aim to confirm severity and next steps within 14 days, but this is a volunteer project and timelines may vary.

## Disclosure

Please allow a reasonable remediation window before public disclosure. After a fix is available, maintainers may publish a GitHub Security Advisory with credit to the reporter unless anonymity is requested.

## Current security limitations

The following alpha limitations are already known:

- Provider API keys are stored in plaintext JSON under Electron's user-data directory and may also be synchronized to a provider's own credential file.
- The experimental embedded browser uses Electron's `<webview>` and page-script execution. It must not be treated as a strong security sandbox.
- Selected agent CLIs and the integrated PowerShell terminal can read, write, and execute within the user's operating-system permissions.
- There is not yet a complete audit log, command policy engine, signed update channel, or reproducible release pipeline.

These known limitations do not need duplicate reports unless you can demonstrate an additional impact or bypass. The planned mitigations are tracked in [docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md).

## Scope examples

Useful reports include:

- Renderer-to-main-process privilege escalation
- IPC validation bypasses that allow arbitrary file access or process execution
- Navigation or protocol-handler abuse leading to code execution
- Credential leakage through logs, UI, environment variables, or child processes
- Path traversal outside the explicitly selected project
- Malicious project content bypassing an approval or trust boundary
- Update, installer, or release artifact tampering

Reports about upstream provider services or CLIs should normally be sent to the relevant vendor unless TaxCLI introduces or amplifies the vulnerability.
