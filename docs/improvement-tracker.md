# Improvement implementation tracker

[Back to main](../README.md)

Consolidated status for all 33 items of the [improvement guide](IMPROVEMENT_GUIDE.md). Owner
detail lives in each thread's status file; this page is the reconciled overview. Statuses:

- **Done (verified)** — implemented and verified by a check that exists in the repository.
- **Partial** — some of the item landed; the remainder is listed.
- **Waiting on owner/dependency** — work cannot complete until another item or owner delivers.
- **Blocked (real)** — cannot be done without credentials, platforms, or decisions outside this
  repository.
- **Not started** — authorised but not yet begun.

This page deliberately separates claims by owner. Verification evidence is cited per item.
Anything not marked **Done (verified)** must not be documented as shipped.

Legend: **B** = backend, **D** = dashboard, **K** = desktop, **W** = documentation.

## Release A — trustworthy verification and administration (items 1–8)

| # | Item | Owners | Status | Notes and evidence |
| --- | --- | --- | --- | --- |
| 1 | Stable-identifier identity verification | B | Partial (code landed) | `!check-in` verifies only returning Discord IDs; name matches are suggestions opening tickets. Reassignment requires `override` flag in `!verify-player`. Separate identity and access state. Evidence: `src/commands/check.ts`, `src/commands/verifyPlayer.ts`. |
| 2 | Truthful email delivery outcomes | B | Partial (code landed) | `sendOtpEmail` returns typed delivery outcomes (`accepted`, `reason`, `detail`). `!email` only confirms delivery when provider accepted; failures report rejection/timeout without marking sent. Evidence: `src/role/helper/email.ts`, `src/commands/email.ts`. |
| 3 | Complete OTP lifecycle | B | Partial (code landed) | Cryptographic 6-digit OTP, constant-time HMAC digest comparison, 10m expiry (`OTP_EXPIRY_MS`), 60s cooldown (`OTP_RESEND_COOLDOWN_MS`), max 3 sends (`OTP_MAX_SENDS`), 5 attempts max, atomic consumption. Evidence: `src/util/otp.ts`, `src/database/orm/VerificationChallenge.ts`, `src/commands/verify.ts`. |
| 4 | Per-tournament check-in rules | B | Partial (code landed) | Closed tournaments skipped individually; open tournaments proceed. Outcomes evaluated per enrolment. Ticket auto-closes only when all succeed. Role failure leaves identity verified with access pending. Evidence: `src/commands/check.ts`, `src/commands/verify.ts`. |
| 5 | Secure dashboard access | B, D, K | Partial (code landed) | Backend & Desktop: Loopback bypass removed outright; one-time desktop bootstrap token exchange (`MLBB_DESKTOP_BOOTSTRAP` via `POST /login/desktop`); login rate limiting (10 attempts / 5 min); CSRF protection (`X-CSRF-Token`, `/api/csrf`); unauthenticated `/api/*` returns 401 JSON; explicit `WEB_BIND` (`127.0.0.1` default, `0.0.0.0` when network access is enabled with password). Evidence: `src/web/server.ts`, `electron/main.ts`, `test/desktop-improvements.test.cjs`. Dashboard UI in progress. |
| 6 | Protect configuration and rendered messages | B, D, K | Partial (code landed) | Backend: config allowlist and atomic `.env` save. Desktop: OS safeStorage, mode-0600 fallback, log redaction. Dashboard: HTML escaping (`escapeHtml`), DOM-safe toast rendering, and secret masking in configuration view (`src/web/public/js/dot-helpers.js`, `src/web/views/config/index.ejs`). |
| 7 | Recoverable upgrades and backups | B, K, W | Partial (code landed) | Desktop: pre-upgrade automatic backup (`userData/backups/<timestamp>-vOLD-to-vNEW/`) and manual "Back up now" snapshot with manifest; verified by `test/desktop-improvements.test.cjs`. Backend: SQLite single-writer lock. Docs: full procedures in [OPERATIONS.md](OPERATIONS.md). |
| 8 | Correct participant quick-start immediately | W | **Done (verified)** | `usage-participant.md`, `usage-organiser.md`, `USER_FLOWS.md`, `FLOW_DIAGRAMS.md`, `README.md` rewritten against current code; broken `usage-cli.md` link removed; TO-role default discrepancy documented. `node docs/links.test.cjs` and `node docs/commands.test.cjs` pass; both run in CI (`docs` job of `Code checks`). |

## Release B — organiser self-service (items 9–16, 19, 26, 28)

| # | Item | Owners | Status | Notes and evidence |
| --- | --- | --- | --- | --- |
| 9 | Guided setup wizard | K, W | **Done (verified)** | 7-step setup wizard (Discord connection, Server selection, Challengermode access, Email setup, Storage, Dashboard access, Checklist). Secrets stored via OS safeStorage or mode-0600 file fallback. Independent integration checks. Non-sensitive config separated from secrets. Verified by `test/desktop-improvements.test.cjs` and documented in [DESKTOP_APP_SETUP.md](DESKTOP_APP_SETUP.md). |
| 10 | Discord permission readiness check | B | Partial (backend landed) | Backend: `GET /api/tournaments/:id/discord-readiness` checks bot permissions, configured channels, and participant role position. Desktop checklist currently reports "not checked" until live bot is online. |
| 11 | Tournament setup checklist | B, D | Partial (code landed) | Backend supplies `checklist.steps` and `nextAction`. Dashboard renders collapsible setup checklist card with progress badge (`0 / 5`), step status, and auto-computed completion via `DotHelpers.computeChecklist` (`src/web/views/tournaments/detail.ejs`). |
| 12 | Slash commands and participant buttons | B, D | Not started | Slash surface today: 11 commands, none for check-in/verify (documented in [commands.md](commands.md)). |
| 13 | Reviewable CSV import | B, D | Partial (code landed) | Backend: `POST /api/tournaments/:id/{participants,schedules}/preview` and commit `mode:"all-or-nothing"|"partial"`. Dashboard: client-side structural parsing, RFC4180 parsing, and server diff preview categorising added/changed/unchanged/rejected rows with validation reporting (`src/web/public/js/dot-helpers.js`, `src/web/views/tournaments/detail.ejs`). |
| 14 | Explicit, timezone-aware scheduling | B, D | Partial (code & docs landed) | Backend: match selector and ownership validation; UTC storage. Dashboard: dual timezone formatting (browser local + UTC via `DotHelpers.formatDualTimezone`) and ICS calendar generation (`generateIcs`). Docs updated in [usage-organiser.md](usage-organiser.md) and [USER_FLOWS.md](USER_FLOWS.md). |
| 15 | Sync freshness and ownership display | B, D | Partial (code landed) | Backend tracks `lastSyncAttempt` and `lastSyncSuccess`. Dashboard displays live sync badges (`Just now`, `X min ago`, `Stale`) on tournament detail (`detail.ejs`) and highlights failed syncs on `/system`. |
| 16 | Recoverable network failures | B | Not started | See [backend status](improvement-status-backend.md). |
| 19 | Mobile and keyboard accessibility | D | Partial (code landed) | Skip-to-main-content link, mobile hamburger drawer, accessible aria-labels, WCAG 2.1 AA focus rings, and responsive touch targets (`src/web/public/css/accessibility.css`, `src/web/views/layout.ejs`). |
| 26 | Consolidate business logic | B | Partial (backend landed) | Reusable services extracted for verification, import preview, and readiness. Scheduling and sync consolidation in progress. |
| 28 | Single command/troubleshooting reference | W | **Done (verified)** | [commands.md](commands.md) (27 prefix + 10 slash commands, permission levels, examples) validated against source by `docs/commands.test.cjs`; [TROUBLESHOOTING.md](TROUBLESHOOTING.md) keyed to actual bot messages; [QUICK_START.md](QUICK_START.md); link check `docs/links.test.cjs`; both in CI. Backend metadata export (optional stronger form) not requested/needed. |

## Release C — dependable event-day operation (items 17–25, 27)

| # | Item | Owners | Status | Notes and evidence |
| --- | --- | --- | --- | --- |
| 17 | Resumable match operations | B | Not started | See [backend status](improvement-status-backend.md). |
| 18 | Event-day overview | B, D | Partial (code landed) | Backend `GET /api/system/overview` implemented. Dashboard `src/web/views/system.ejs` renders "Needs attention" panel with live counters, upcoming matches, and stale data list. |
| 20 | Player search at scale | B, D | Partial (code landed) | Backend `GET /api/players/search` with bounded pagination and email masking. Dashboard `src/web/views/players/index.ejs` and `src/web/public/js/pages/players.js` implement search inputs, filters, URL query sync, and paginated results. |
| 21 | Individual accounts and server scope | B | Not started | Dashboard remains single shared password — documented as a limitation in [OPERATIONS.md](OPERATIONS.md). |
| 22 | Real audit trail | B | Not started | `/api/system/activity` is still derived placeholder data; docs do not claim otherwise. |
| 23 | Privacy and retention controls | B, D | Partial (code & docs landed) | The dashboard `/privacy` view documents data collection. Automated retention, privacy export, and audited deletion endpoints are not implemented. Storage limits documented in [OPERATIONS.md](OPERATIONS.md). |
| 24 | Health checks and support diagnostics | B, D, K | Partial (code landed) | Backend: `/api/health` (liveness), `/api/system/readiness` (dependency readiness), `GET /support`. Desktop: redacted local support bundle. Dashboard `src/web/views/support.ejs` provides readiness checks, live email test, and support bundle download. |
| 25 | Desktop installation and upgrades | K, W | Partial (code landed, signing blocked) | Desktop: pre-upgrade backups (`userData/backups`), manual backup with manifest, single-instance lock, graceful SIGTERM shutdown (5s before SIGKILL). Code verified by `test/desktop-improvements.test.cjs`. Installer signing/notarisation and auto-update blocked on external credentials (truthfully documented in [DESKTOP_APP_SETUP.md](DESKTOP_APP_SETUP.md)). |
| 27 | Tests around user journeys | B, K, W | Partial (code landed) | Targeted reliability tests (`test/reliability.test.cjs`), desktop improvement tests (`test/desktop-improvements.test.cjs`), and docs CI validators (`docs/links.test.cjs`, `docs/commands.test.cjs`) verified. Full journey tests and PostgreSQL migration CI pending. |

## Release D — product extensions (items 29–33)

| # | Item | Owners | Status | Notes and evidence |
| --- | --- | --- | --- | --- |
| 29 | Participant "My tournament" view | B, D | Not started | Authorised for minimal implementation; see backend/dashboard status. |
| 30 | Team readiness and roster checks | B, D | Partial (dashboard landed) | Dashboard `DotHelpers.checkTeamReadiness` implements roster completeness checks against minimum player thresholds (`src/web/public/js/dot-helpers.js`). Backend service pending. |
| 31 | Configurable reminders and calendar export | B, D | Partial (dashboard landed) | Dashboard `DotHelpers.generateIcs` generates RFC 5545 iCalendar data for match schedules (`src/web/public/js/dot-helpers.js`). Server reminder jobs depend on durable job infrastructure (item 17). |
| 32 | Dispute and support tracking | B, D | Not started | See backend/dashboard status. |
| 33 | Presets and localisation | B, K, W | Partial (docs) | Australian English documented as the project language (README, TESTING); no preset/localisation framework exists and none is claimed. Code: backend/desktop owners. |

## Real external blockers (cross-cutting)

- **Installer signing/notarisation** (25): requires Apple Developer and Windows code-signing
  credentials. Until then, docs state installers are unsigned.
- **Live Challengermode validation** (1, 15, 16): needs a real application refresh key and a
  tournament; the integration stays read-only.
- **Live Discord behaviour** (1, 5, 10, 17, 19): real guild role hierarchy, mobile clients, and
  restart recovery cannot be exercised without a live bot and server.
- **Gmail delivery** (2, 3): end-to-end email needs OAuth credentials; no account is exercised
  during development or CI.
- **Multi-organiser hosting** (21): product decision (hosted vs single-owner desktop) still open.

## How this tracker is maintained

Each owner updates their own status file; the documentation owner reconciles this page against
those files and the repository state. A row may only move to **Done (verified)** with a named,
repeatable check in the repository (test, script, or documented procedure with evidence).
