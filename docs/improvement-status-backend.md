# Backend improvement status

Scope: all `src` TypeScript except `src/web/public`, database entities/migrations, server routes, commands/slash interactions, timers, provider integration, backend configuration, `package.json`/`package-lock.json`, Docker/config examples, and test files except the dashboard/desktop owners' new test files.

This file tracks implementation status against `docs/IMPROVEMENT_GUIDE.md`. API contracts promised to sibling owners are recorded here as they are agreed.

## API contracts agreed with sibling owners

Envelope for every JSON route (unchanged from current code): `{success: true, data: ...}` on success, `{success: false, error: string}` on failure. Unauthenticated API calls return `401` JSON instead of a redirect.

### Dashboard owner (docs/improvement-status-dashboard.md is theirs)

| Contract | Status |
| --- | --- |
| CSV preview `POST /api/tournaments/:id/{participants,schedules}/preview`, commit `mode:"all-or-nothing"\|"partial"` on existing import routes | Implemented. All-or-nothing returns 400 and the preview rows without saving. |
| Player search pagination `GET /api/players/search?page&limit&email&discordUsername&discordId&team&tournamentId&verified` → `data[], total, page, limit, pages, emailMasked` (limit clamped to 100) | Implemented. Emails are masked for every dashboard session until guide 21 roles exist. |
| Match selector `GET /api/tournaments/:id/matches`; 503 when provider unavailable; schedule saves validate match ownership | Implemented. Validation is skipped only when no Challengermode key is configured. |
| Sync freshness fields `lastSyncAttempt`, `lastSyncSuccess`, `syncSource` on tournament GET/list | Implemented. |
| Config view model `fields[{key,label,value,configured,secret,restart,description?}]`; unknown POST keys rejected; secrets never returned | Implemented. Legacy non-secret `configData` remains during transition. `GET /api/config` returns the same fields. |
| Overview `GET /api/system/overview` | Implemented. `unmatchedTeams` and `failedJobs` are currently `null` because team-readiness and durable jobs are not finished. |
| `GET /privacy` and `GET /support` render the dashboard-owned views | Implemented. |
| CSRF: `X-CSRF-Token`, meta name `csrf-token`, also available from `GET /api/csrf` | Implemented. |

### Desktop owner

| Contract | Status |
| --- | --- |
| `POST /login/desktop` (also `GET /login/desktop?token=&path=`) — one-time bootstrap token exchange via `MLBB_DESKTOP_BOOTSTRAP` env, `timingSafeEqual`, session regeneration, validated local redirect | Implemented. Loopback IP bypass removed. |
| `WEB_BIND` env: explicit IP, `0.0.0.0` for network, default `127.0.0.1` | Implemented. |
| Secret-free config.json: `src/config/index.ts` must not require `discord.token`/`challengermode.refreshKey`/`web.password` in the file when env provides them | Implemented. Existing values in the file still work. |
| `GET /api/system/readiness` | Implemented. It does not call Challengermode during the poll. |
| `POST /api/system/email/test {to}` | Implemented. Limited to one test per minute per process. |
| `POST /api/system/backup`, `GET /api/system/backups`, `POST /api/system/restore {id}` | Backup/list implemented for SQLite files. Live restore now returns 409: stop the application and restore offline. PostgreSQL requires its own backup tool. |

Env names for desktop to pass: `MLBB_DESKTOP_BOOTSTRAP`, `WEB_BIND`.

## Implementation checklist

### P0 — Release A (guides 1–8 backend portions)

- [x] **1 Identity matching** — verified Discord IDs return directly; name matches are suggestions; identity and role access are stored separately; organiser reassignment requires `override`.
- [x] **2 Email delivery truthfulness** — typed provider result, bounded timeout, separate delivery attempt count, configurable sender, and setup test endpoint.
- [x] **3 OTP lifecycle** — cryptographic codes, keyed digests, expiry, failed-attempt limit, resend cooldown, and conditional consumption.
- [x] **4 Per-tournament check-in rules** — open and closed tournaments are reported separately; closed records are not changed; tickets remain open after partial failure.
- [x] **5 Admin access** — desktop bootstrap exchange, generated session secret, regenerated login session, local redirect validation, login throttling, CSRF, JSON 401 responses, and explicit bind host. Persistent session storage is still in-memory and documented as a hosting limitation.
- [x] **6 Config protection** — editable-setting allowlist, secrets omitted from responses, atomic env replacement, and restart classification.
- [x] **7 Migrations and backups** — identity migration, production schema creation via a frozen baseline migration, atomic SQL.js replacement, in-process duplicate-open guard (not a cross-process lock), and tested SQLite backup/restore. A real PostgreSQL migration run is still outstanding.
- [x] **27 (part)** — `test/reliability.test.cjs` covers items 1–7. Full command-level Discord integration remains outstanding.

### P1 — Release B (guides 9–16, 19, 26, 28 backend portions)

- [x] **9 Setup wizard backend** — readiness and email-test endpoints are available. Desktop presentation remains with the desktop owner.
- [x] **10 Permission readiness check** — `GET /api/tournaments/:id/discord-readiness` inspects bot permissions, configured channels, and participant role identity/position. It resolves a stored role ID before its name.
- [x] **11 Tournament checklist** — tournament detail now includes `checklist.steps` and `nextAction`. The dashboard owner renders it.
- [ ] **12 Slash commands** — check-in/verify/status/next-match/help through shared services.
- [x] **13 CSV preview/commit** — preview, all-or-nothing mode, and participant correction CSV are implemented.
- [x] **14 Scheduling backend** — match selector and ownership validation are implemented. Conflict and past-time warnings are not implemented yet.
- [x] **15 Sync freshness** — attempt and success timestamps are persisted and returned. The 2099 unscheduled sentinel remains for compatibility.
- [ ] **16 Network recovery** — bounded retry/backoff, coalesced reads, last-known snapshot with staleness, manual retry.
- [x] **26 Service consolidation (partial)** — verification, import preview, and readiness logic now live in reusable services. Scheduling and sync entry points still contain route-specific behaviour.
- [ ] **28 Command metadata** — metadata for permission/scope/parameters/examples; backend for reference generation.

### P1 — Release C (guides 17–25, 27 backend portions)

- [ ] **17 Resumable match operations** — per-match stage records, operation IDs, reconciliation, durable job claims, versioned notification jobs.
- [x] **18 Event-day overview** — `GET /api/system/overview` is implemented. Team-readiness and failed-job counts remain unknown until those features exist.
- [x] **20 Player search** — bounded pagination, stable ordering, filters, indexes, and masked emails are implemented.
- [ ] **21 Individual accounts/scope** — only if multi-organiser hosting is in scope; otherwise single-owner mode retained.
- [ ] **22 Audit trail** — persistent actor/scope/action/outcome/summary records replacing placeholder activity.
- [ ] **23 Privacy/retention** — collection notice, retention run, deletion/export, redaction.
- [x] **24 Health/diagnostics (partial)** — `/api/health` remains liveness and `/api/system/readiness` checks local dependencies. A downloadable redacted support bundle is not implemented yet.
- [ ] **27 (rest)** — journey tests, PostgreSQL migration CI exercise.

### P2 — Release D (guides 29–33)

- [ ] **29 Participant "My tournament"** — scoped read service + Discord response.
- [ ] **30 Team readiness** — roster configuration and checks.
- [ ] **31 Reminders/calendar** — after durable jobs; configurable offsets, ICS export.
- [ ] **32 Dispute tracking** — referee cases, read-only provider stance preserved.
- [ ] **33 Presets/localisation** — non-secret presets, validation on apply.

## Constraints honoured

- Challengermode integration stays read-only (`supportsWrites = false` unchanged).
- No credentials read or exposed; no live accounts used for testing.
- Sibling ownership boundaries respected; cross-boundary changes coordinated in threads.
- Challengermode contract tests keep using mocked GraphQL; no external calls in tests.
