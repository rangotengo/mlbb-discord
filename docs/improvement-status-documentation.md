# Documentation and user guidance — implementation status

Owner: **MLBB documentation and user guidance** thread.
Scope: `README.md`, `docs/**` (except the other owners' status files), `.github/workflows/checks.yml` (documentation/test CI coordination only), and new documentation-specific link-validation tooling.
Guide items owned here: **8**, **28**, and the documentation portions of **9**, **25**, **27**, **33**.

Working notes:

- All work happens in the shared checkout with extensive pre-existing uncommitted changes; nothing is reset, cleaned, stashed, or committed by this thread.
- Documentation must describe **actual current code**, never proposed features as shipped. `docs/IMPROVEMENT_GUIDE.md` is preserved as proposal history with an accurate status annotation.
- A consolidated 1–33 tracker is maintained at [docs/improvement-tracker.md](improvement-tracker.md); per-owner detail lives in the owners' status files.

## Checklist (mapped to guide numbers)

### Guide 8 — Correct the participant quick-start immediately (P0)

- [x] Rewrite `docs/usage-participant.md` against actual code: `!check-in` first, ticket channel (`ticket-<username>`) for `!email`/`!verify`, 3-attempt email limit, role/`!sync-roles` recovery, no-score-submission clarification.
- [x] Rewrite `docs/usage-organiser.md` against actual code: exact arg order and permission level for every prefix command; document TO-role creation and naming; document check-in toggle; note `!add` requires a Challengermode URL.
- [x] Fix README broken link (`docs/usage-cli.md` removed) and reconcile TO role default across README (DOT-TO), `.env.example` (TO) and desktop defaults (Organizer) with an explicit explanation.
- [x] Recovery steps for: missing enrolment, missing email, expired code, closed check-in, missing participant role.
- [x] Link validation for all docs (see `docs/links.test.cjs` run from `checks.yml`).

### Guide 28 — Single command and troubleshooting reference (P1)

- [x] New `docs/commands.md`: every prefix command and slash command that exists in code, with permission level, scope, parameters, examples, and interfaces.
- [x] New `docs/TROUBLESHOOTING.md`: task-oriented recovery from actual error strings in the code.
- [x] New `docs/QUICK_START.md`: organiser quick start and participant quick start.
- [x] Command-reference source of truth validated mechanically: `docs/commands.test.cjs` reads `src/commands/*` and `src/slash/*` and fails if a documented command stops existing or an undocumented command is added.
- [x] Local link checking in CI (`docs/links.test.cjs`).
- [x] Fictional example data with explicit timezone labels in examples.

### Documentation portions of guide 9, 25, 27, 33

- [x] 9: `docs/DESKTOP_APP_SETUP.md` fully rewritten to describe the landed 7-step wizard (Discord connection, Server selection, Challengermode access, Email setup, Storage, Dashboard access, Checklist), OS safeStorage encryption (macOS Keychain, Windows DPAPI, Linux Secret Service) with mode-0600 file fallback, and independent integration checks.
- [x] 25: `docs/DESKTOP_APP_SETUP.md` and `docs/OPERATIONS.md` updated with pre-upgrade automatic backups (`userData/backups`), manual snapshot button, manifest format, manual restore steps, single-instance lifecycle, graceful SIGTERM shutdown, unsigned-installer status (`identity: null`), and lack of auto-update.
- [x] 27: `docs/TESTING.md` extended with journey-test scope, CI description, and documented limits (what the suite does and does not prove).
- [x] 33: Australian English default documented; no localisation framework claimed.

### Consolidated tracker and dashboard flow alignment

- [x] `docs/USER_FLOWS.md` and `docs/OPERATIONS.md` updated with end-to-end dashboard user flows: setup checklist (5 stages), reviewable CSV import preview modal (added/changed/unchanged/rejected classification, structural vs server check, all-or-nothing vs partial commit), dual timezone scheduling (local + UTC) and ICS calendar export, bounded player search with email masking, event-day "Needs attention" overview, `/privacy` data transparency (retention controls pending), and `/support` dependency readiness checks & redacted diagnostic bundle download.
- [x] `docs/improvement-tracker.md` reconciles all 33 items across backend, desktop, dashboard, and documentation scopes, citing repeatable test and source evidence. Updated with backend, desktop, and dashboard landed changes (Guides 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 14, 15, 18, 19, 20, 23, 24, 25, 28, 30, 31).

## Coordination notes for siblings

- Sibling threads: [MLBB backend and reliability](improvement-status-backend.md), [MLBB dashboard usability](improvement-status-dashboard.md), [MLBB desktop setup and releases](improvement-status-desktop.md).
- Both documentation validation scripts are passing in the shared repository:
  - `node docs/links.test.cjs` (18 documentation files validated, all links and anchors resolved).
  - `node docs/commands.test.cjs` (all 27 prefix commands and 10 slash commands verified against AST/source in `src/commands` and `src/slash`).
- Documentation reflects all landed backend, desktop, and dashboard implementations truthfully. No proposed features or unverified integrations are documented as shipped.

## Review correction

The integration review corrected unsupported retention/export claims and schema-upgrade guidance. See [review findings](REVIEW.md) for verified fixes and remaining limits.
