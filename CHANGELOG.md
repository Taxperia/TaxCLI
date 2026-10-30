# Changelog

All notable changes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/) after the public release process is established.

## [Unreleased]

### Changed

- Mark AI Office, Development Center, subagent teams and Multi-AI comparison as Beta in their navigation entries

### Fixed

- Windows packages use the standard V8 startup snapshot and retain the file protocol support required to load the application interface
- Codex discovery prefers the standalone npm CLI over Store desktop and editor launchers; login terminals start in the user's home directory
- Arena judge reports preserve every candidate within the context budget, retain valid JSON and identify any completed solutions missing scores
- Multi-AI comparisons show queued, running, approval, testing and failed models immediately, with live output access and a separate judge status
- Each comparison keeps all model outputs and its judge in one conversation, with a single sidebar entry and preserved model labels in history
- Comparison copies stay under the selected project's `.taxcli/comparisons` directory; review shows the original destination before applying a solution
- Locked candidate files no longer block subsequent models; cleanup is retryable and idempotent, provider errors remain visible, and all-failed comparisons skip judging
- Theme-aware operation approval dialogs and permission menus, with keyboard navigation and viewport-constrained positioning
- Approval dialogs show the requesting run's actual permission mode and explain when a newer menu selection applies only to future runs
- Codex auto-edit routes eligible extra-access requests through Auto-review while preserving the workspace sandbox; ask and plan modes retain their existing policies

## [0.1.1] - 2026-10-28

### Interface and Windows packaging

- Theme-aware confirmation dialogs and project context menus across dark, brand, midnight and light themes
- Compact folder and conversation rows with hover actions, persistent pinning, reversible archiving and access to archived conversations
- Searchable composer add menu aligned above the full message input, with existing attachment, workflow, plugin and tool actions and keyboard navigation
- Borderless profile/type/effort control and responsive composer footer
- Multi-resolution Windows icons, explicit taskbar identity and a branded development executable while preserving the original Electron runtime
- Release notes comparing v0.1.0 and v0.1.1, a manual Windows installer, source code, dependency inventory and checksums
- Security updates for Electron and vulnerable build-tool dependencies; the complete dependency audit reports no known vulnerabilities

### Added

- Automatic GitHub update checks and background downloads, verified complete release publishing, and a user-controlled restart with active-task protection
- One searchable provider-grouped model dropdown for comparisons, with provider icons and removable selections
- Per-phone project, provider/model and approval-mode selection, separate mobile conversations, and session-scoped operation approvals synchronized with the desktop
- Mobile chat layout with a black background, project pill, rounded composer, compact model/approval controls, accessible settings sheet and response copying
- Separate mobile project, provider/model and permission panels, plus task shortcuts that preserve the existing draft
- Project context menus anchored to the clicked project and constrained to the window, with keyboard navigation
- Development Center with exact file/hunk reviews, conflict-safe partial apply/reject, per-run undo and pre-change safety snapshots
- Model Arena with an immutable encrypted baseline, sequential disposable candidates, automatic tests, anonymous independent judging and transparent multi-metric scores
- Encrypted run artifacts, provider tool/command/approval timelines, export and replay
- Built-in/custom task recipes, project health checks, isolated conversation branches with comparison and merge, local text/PDF knowledge, session import and provider diagnostics

- Selectable expert agent profiles for planning, everyday questions, coding, and deep analysis
- Automatic prompt routing with a live specialist preview in the composer
- Shared, tested agent-profile registry used by both the renderer and Electron main process
- Provider-local and cross-provider Global Auto model routing
- Economy, Balanced, and Quality policies with automatic reasoning-effort selection
- Configurable Global Auto provider allowlist and default routing scope
- Public project documentation and community health files
- GitHub issue and pull request templates
- Windows CI syntax check
- Dependabot configuration
- CLI, packaging, and security hardening roadmaps
- Third-party license notices
- Windows NSIS installer packaging
- GitHub Releases publishing workflow
- Automatic update checks, downloads, and restart-to-install flow
- QR-paired local mobile access with revocable sessions and live prompt responses
- Configurable AI Office teams with named/avatar employees, manager task delegation, isolated parallel work, and final synthesis
- Multiple encrypted ChatGPT account profiles with per-Codex-employee assignment, OAuth refresh, and sign-out revocation
- Project snapshots with automatic pre-run capture, safe restore, retention, and sensitive-file exclusions
- Durable task queue with pause, retry, restart recovery, and sequential execution
- Git Center for repository status, staging, unstaging, initialization, log inspection, and commits
- Curated MCP marketplace with pinned packages and permission/risk review
- Security Center with workspace trust, encrypted secret vault, redacted hash-chained audit log, and export
- Webview permission/download blocking, plugin domain transitions, dangerous-command blocking, and agent output/time/concurrency limits
- Automated dependency auditing, CycloneDX SBOM artifacts, and weekly dependency updates
- Claude Code engine support with official WinGet installation, Anthropic login status, model selection, and streamed runs
- Multi-AI selection of multiple Codex, Claude Code, Copilot, or other provider models in isolated disposable workspaces

### Fixed

- Fixed mobile QR pairing returning "Geçersiz kaynak" in Chromium: same-origin form submissions now retain their Origin without allowing cross-origin referrers or relaxing source checks

- Recheck file contents after safety snapshots and before atomic file replacement so editor changes are not overwritten during apply/undo
- Preserve isolated run replay in a validated disposable workspace reconstructed from the recorded starting files
- Allow AI Office planning to start with the user's shell setting while retaining read-only provider permissions
- Synchronize retest results with Arena scores and invalidate stale winners and judge ratings
- Keep normal agent runs working beyond the review capture budget, with explicit metadata-only recording instead of blocking or misleading file diffs

### Removed

- Unimplemented `engines:install` renderer bridge

### Changed

- Replaced composer settings cards with a cascading Profile / Type / Effort menu, including hover and keyboard navigation
- Wrapped provider chips without a horizontal scrollbar
- Unified the dark workspace with the neutral settings palette and preserved the previous dark home appearance as the Gece theme

- Replaced the MIT license with the Taxperia Non-Commercial Attribution License
- Added visible Taxperia creator attribution to the application sidebar
- Renamed the public product from AgentHub Desktop to TaxCLI
- Replaced generic engine glyphs with recognizable provider brand logos

## [0.1.0] - 2026-08-09

Initial alpha of the Windows-first desktop workspace.
