# Project improvement guide

> **Status: proposal history, not a changelog.** This document is the prioritised backlog
> reviewed against the working tree on 28 October 2026. Nothing in it was implemented at the time
> it was written. For what has actually landed since, and what remains, see the
> [implementation tracker](improvement-tracker.md) and each owner's status file
> ([backend](improvement-status-backend.md), [dashboard](improvement-status-dashboard.md),
> [desktop](improvement-status-desktop.md), [documentation](improvement-status-documentation.md)).
> Any guide item still marked unimplemented there must not be described as shipped in user-facing
> documentation.

Reviewed against the working tree on 28 October 2026. This is a proposed backlog, not a record of implemented changes. Findings come from source and documentation inspection; no live Discord, Gmail, or Challengermode account was exercised. Existing uncommitted work was included in the review.

The goal is for an organiser to set up a tournament without developer assistance, for participants to join without exposing personal information, and for staff to recover from failures during an event.

## How to use this guide

Start with items 1–8, which address correctness, access, and data protection. Then deliver the setup and tournament workflow improvements. Treat the later product features as candidates to validate with organisers before building them.

Each item explains the current evidence or proposed opportunity, implementation steps, relevant files, and an acceptance check. Priorities mean:

- **P0:** resolve before relying on the affected flow for a live event or exposing the dashboard to a network.
- **P1:** improve the core organiser and participant experience next.
- **P2:** extend the product once the core workflows are dependable.

This is a broad project backlog, not a claim that every possible defect has been identified.

## Correctness and trust

### 1. Verify identity using stable identifiers — P0

**Evidence:** `check.ts` matches imported Discord names against usernames, global names, and server display names, then automatically verifies the first match. Display names are not suitable proof of ownership. The same path saves `verified` before role assignment and can claim the role was granted after assignment fails.

**Implementation:**

1. Use a previously verified Discord user ID for returning participants. Treat name matches only as suggestions.
2. Require email verification or an explicit, audited organiser action to create a new identity link.
3. Represent identity verification and Discord access provisioning separately, so a role failure can be retried without repeating identity verification.
4. Refuse to replace an existing verified account link silently; provide an organiser recovery flow.

**Files:** [check-in command](../src/commands/check.ts), [verification](../src/commands/verify.ts), [player entity](../src/database/orm/EnrolledPlayer.ts).

**Acceptance:** Two users with the same display name cannot claim the same enrolment. A failed role assignment reports “Identity verified; access pending” and offers a safe retry.

### 2. Make email delivery outcomes truthful — P0

**Evidence:** `sendEmail()` logs and returns on missing credentials, HTTP failures, and network errors. Its caller can therefore announce that an OTP was sent when delivery was not accepted. The caller also consumes a send attempt before sending.

**Implementation:**

1. Return a typed delivery result or throw a controlled error for failed token refresh and failed submission.
2. Add bounded request timeouts and distinguish provider acceptance from actual inbox delivery.
3. Track delivery attempts separately from successful submissions; apply abuse throttling even when the provider fails, without permanently exhausting a participant's allowance.
4. Make the sender configurable and add a setup-time test email with a clear result.

**Files:** [email helper](../src/role/helper/email.ts), [email command](../src/commands/email.ts), desktop configuration.

**Acceptance:** Missing credentials, expired authorisation, provider rejection, and timeout never produce “OTP sent”. Staff see a useful recovery action without credentials appearing in errors.

### 3. Introduce a complete OTP lifecycle — P0

**Evidence:** OTPs use `Math.random()`, are stored as integers, and have no expiry or failed-verification counter in `EnrolledPlayer`. Verification uses `parseInt`, which accepts a numeric prefix followed by text. The three-send limit does not implement a timed resend policy.

**Implementation:**

1. Generate codes with a cryptographic random generator and accept exactly the intended number of digits.
2. Store a keyed digest, expiry, failed-attempt count, resend eligibility time, and consumed state in a verification challenge record.
3. Bind challenges to the Discord account, guild, and selected enrolment; invalidate previous challenges on resend.
4. Set configurable expiry and throttling policies; explain expiry and cooldown in participant messages.
5. Consume a challenge atomically so concurrent submissions cannot reuse it. Keep raw codes out of logs.

**Files:** [email command](../src/commands/email.ts), [verify command](../src/commands/verify.ts), database entities and migrations.

**Acceptance:** Expired, replayed, malformed, and repeatedly guessed codes fail; a valid code works once; resend invalidates its predecessor.

### 4. Enforce check-in rules per tournament — P0

**Evidence:** Email and verification commands reject the operation only when all matching tournaments have check-in disabled, then process records across those tournaments. A mix of open and closed tournaments needs individual filtering.

**Implementation:**

1. Ask the participant to select a tournament when more than one enrolment is relevant.
2. Evaluate enrolment, tournament status, and check-in window for each record at the point of mutation.
3. Keep closed tournaments unchanged even if another tournament is open.
4. Show individual outcomes and retain the support ticket when any requested operation needs staff attention; current verification closes it after any success.

**Files:** [check-in](../src/commands/check.ts), [email](../src/commands/email.ts), [verify](../src/commands/verify.ts).

**Acceptance:** A participant enrolled in one open and one closed tournament gains access only to the eligible tournament. Partial failure remains visible and recoverable.

### 5. Secure dashboard access explicitly — P0

**Evidence:** The web server bypasses authentication based on loopback IP, listens without an explicit host, uses the web password or a fixed fallback as the session secret, and has no configured persistent session store. Login redirects accept a supplied redirect string. There is no visible CSRF or login throttling middleware in the server setup.

**Implementation:**

1. Default desktop operation to a loopback listener. Make network access an explicit deployment setting requiring authentication.
2. Replace the blanket loopback bypass with an authenticated desktop session or short-lived bootstrap exchange. Account for reverse proxies whose upstream connection is local.
3. Use an independent generated session secret, regenerate sessions after login, validate redirects against local destinations, and rate-limit login attempts.
4. Add CSRF protection to state-changing routes and origin validation for local administration.
5. Use a production session store for hosted operation; explicitly configure cookie expiry, SameSite, and HTTPS-only cookies for HTTPS deployments. Return JSON 401 responses for unauthenticated API calls.

**Files:** [web server](../src/web/server.ts), [desktop main](../electron/main.ts), [desktop settings](../ui/index.html).

**Acceptance:** An unauthenticated browser cannot read or mutate admin data through either the direct listener or the supported proxy configuration. Desktop launch still opens an authenticated dashboard.

Implementation reference: [Express security guidance](https://expressjs.com/advanced/best-practice-security/) and [session middleware documentation](https://expressjs.com/en/resources/middleware/session/) describe secure deployment and session-store considerations.

### 6. Protect configuration and rendered messages — P0

**Evidence:** The configuration page excludes only `DISCORD_TOKEN` when reading environment values and accepts arbitrary submitted keys except that token. Desktop configuration is written as JSON. Toast messages are interpolated directly into `innerHTML`.

**Implementation:**

1. Define an allowlist and runtime schema for editable settings; reject unknown keys and invalid types.
2. Render secret fields as “Configured” with a replace action. Do not return current secret values to the browser.
3. Store desktop secrets through an OS-backed mechanism compatible with the pinned Electron version; document behaviour when secure storage is unavailable.
4. Write configuration atomically and report exactly which changes require restart.
5. Build toast message nodes with `textContent`; audit other HTML insertion points and add an appropriate Content Security Policy.

**Files:** [configuration routes](../src/web/routes/config.ts), [desktop configuration](../electron/config.ts), [dashboard helpers](../src/web/public/js/app.js).

**Acceptance:** Submitted markup is displayed as text. Unknown configuration keys are rejected. Saving unrelated settings preserves secrets without exposing them in HTML or API responses.

Use the [Electron security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md) as a review checklist; verify API compatibility against this project's Electron version before implementation.

### 7. Make database upgrades and backups recoverable — P0

**Evidence:** SQLite startup uses `synchronize: true` and writes the SQL.js database directly to its target file. PostgreSQL disables synchronisation in production, making complete migration coverage particularly important.

**Implementation:**

1. Provide tested migrations for fresh installations and every supported upgrade path on both database engines.
2. Disable automatic schema synchronisation in production SQLite after migration coverage exists.
3. For SQL.js, use an atomic replacement strategy and prevent concurrent processes from writing the same database file.
4. Create consistent backups before upgrades and offer backup/restore actions with database-version metadata. Use an engine-appropriate backup method for PostgreSQL.
5. Test restoration before showing an upgrade as recoverable; document how configuration and secrets are restored separately.

**Files:** [database initialisation](../src/database/orm/index.ts), [migrations](../src/database/migrations), desktop lifecycle.

**Acceptance:** A fresh production database starts successfully. A populated previous-version database upgrades without losing verification or schedules. A restored backup is usable.

[TypeORM's migration guidance](https://typeorm.io/docs/migrations/why/) advises against production schema synchronisation once the database contains data.

### 8. Correct the participant quick-start immediately — P0

**Evidence:** The participant guide says `!email` can run in server channels or DMs, while the implementation requires a ticket channel. The README also links to `docs/usage-cli.md`, which is absent from the reviewed file list.

**Implementation:**

1. Document the actual sequence: organiser imports enrolment, participant runs `!check-in`, participant follows the private ticket flow when required, then receives tournament access.
2. Explain that local verification does not register a team or submit results on Challengermode.
3. Include recovery steps for missing enrolment, missing email, expired code once implemented, closed check-in, and missing participant role.
4. Repair missing links and reconcile organiser role defaults across setup screens, examples, and documentation.

**Files:** [participant guide](usage-participant.md), [organiser guide](usage-organiser.md), [README](../README.md), [user flows](USER_FLOWS.md).

**Acceptance:** A new participant follows only the guide and completes the supported flow without posting an email in a public channel.

## Setup and everyday usability

### 9. Add a guided setup wizard — P1

**Opportunity:** The desktop UI collects credentials and exposes logs, but a successful launch should demonstrate that the tournament workflow is usable.

**Implementation:** Guide organisers through Discord connection, server selection, Challengermode access, email setup, storage, and dashboard access. Validate each step independently. Preserve progress and display a final checklist with actionable failures. Reuse the existing configuration validator rather than creating separate validation rules.

**Files:** [desktop UI](../ui/index.html), [renderer](../ui/renderer.ts), [validator](../electron/config-validator.ts), [desktop setup guide](DESKTOP_APP_SETUP.md).

**Acceptance:** An organiser can identify and fix an invalid integration without reading raw logs; restarting the wizard retains completed settings without exposing secrets.

### 10. Check Discord permissions before an event — P1

**Opportunity:** Tickets, roles, and private match threads require more than a connected bot.

**Implementation:** Add a server readiness action that checks the actual configured channels, effective permissions, bot role position, participant roles, ticket category, and announcement destination. Resolve configured roles by stored IDs, not only names. Offer a preview of any repair action and recheck after changes.

**Files:** [role utilities](../src/util/roles.ts), [match threads](../src/util/matchThreads.ts), [check-in](../src/commands/check.ts), [system routes](../src/web/routes/system.ts).

**Acceptance:** Missing channel access or an unassignable role is detected before check-in opens. Renaming a configured role does not break authorisation or assignment.

### 11. Provide a tournament setup checklist — P1

**Opportunity:** Users currently navigate multiple commands and dashboard operations to prepare an event.

**Implementation:** Present the sequence “Connect tournament → Review teams → Import enrolments → Resolve unmatched teams → Configure check-in → Set channels and times → Run readiness check”. Persist progress and link each incomplete step to its action. Require explicit selection when a server contains multiple tournaments.

**Files:** [tournament views](../src/web/views/tournaments), [tournament routes](../src/web/routes/tournaments.ts), [team matching](../src/util/teams.ts).

**Acceptance:** A first-time organiser knows the next required action at every step and sees unresolved enrolments before opening check-in.

### 12. Add slash commands and participant buttons for common actions — P1

**Opportunity:** Prefix commands remain central while the slash command set covers only part of the workflow.

**Implementation:** Prioritise check-in, verification, status, next match, and help. Use tournament selectors and private input where appropriate. Keep prefix compatibility and route both entry points through shared business logic. Include “Open match thread”, “View bracket”, and “Get help” actions in successful responses.

**Files:** [prefix commands](../src/commands), [slash commands](../src/slash), [interaction handler](../src/events/interaction.ts).

**Acceptance:** A mobile participant can complete the main journey without memorising command syntax; equivalent prefix and slash requests enforce identical permissions.

### 13. Make CSV import reviewable before saving — P1

**Evidence:** Schedule imports process rows immediately, allow partial success, and return only the first ten error descriptions.

**Implementation:** Add a validation preview with added, changed, unchanged, and rejected rows. Detect duplicates and ambiguous team identities. Offer an explicit all-or-nothing mode or clearly labelled partial import. Return all rejected rows as a downloadable correction file. Preserve established verification and manual scheduling rules when applying changes.

**Files:** [schedule routes](../src/web/routes/schedules.ts), [participant routes](../src/web/routes/participants.ts), [enrol command](../src/commands/enroll.ts), [CSV helpers](../src/util/csv.ts).

**Acceptance:** Uploading a mixed-validity file makes no changes until confirmation. Reimporting the corrected file does not duplicate enrolments or overwrite protected fields unexpectedly.

### 14. Make scheduling explicit and timezone-aware — P1

**Evidence:** The parser and tests already address UTC round trips and ambiguous local times. Dashboard formatting uses the browser's locale without displaying an explicit timezone. Schedule creation checks UUID syntax but can save a UUID that was not found among the tournament's matches.

**Implementation:** Add a match selector populated with teams and rounds; validate match ownership on save. Store UTC and display both the configured event timezone and the viewer's timezone. Preview bulk time shifts and flag team conflicts or past times. When provider access fails, distinguish an unvalidated draft from a confirmed schedule. Prefer named timezones or explicit offsets in templates.

**Files:** [schedule routes](../src/web/routes/schedules.ts), [date parsing](../src/util/parseDateTime.ts), [dashboard formatting](../src/web/public/js/app.js).

**Acceptance:** Organisers in different timezones see the same instant correctly labelled. A valid UUID belonging to another tournament cannot become a confirmed match schedule.

### 15. Show synchronisation freshness and ownership — P1

**Evidence:** The integration is intentionally read-only. Sync already uses transaction and concurrency protections and preserves manual schedules. These behaviours should be visible to organisers.

**Implementation:** Show last attempt, last successful sync, source, and stale-data state. Label remote-controlled fields versus local settings. Preview changes where practical and explain unmatched teams. Add direct Challengermode links for score and registration work. Replace the internal 2099 “unscheduled” sentinel with an explicit nullable time or scheduling state through a migration.

**Files:** [sync utility](../src/util/tournament.ts), [provider client](../src/website/challengermode.ts), [schedule entity](../src/database/orm/MatchSchedule.ts), tournament views.

**Acceptance:** Users can distinguish a genuinely undecided fixture from failed data retrieval. A sync preserves intended local overrides and explains what it changed.

### 16. Make network failures recoverable — P1

**Evidence:** The Challengermode client already has request timeouts and a token-refresh retry; rate-limit responses currently instruct users to try again later. Schedule reads can fall back to “TBD” after provider failure.

**Implementation:** Extend reads with bounded retry/backoff for retryable failures, respecting provider retry hints where available. Coalesce identical reads and retain the last successful snapshot with its timestamp. Do not retry permanent validation failures indefinitely. Expose retry progress and a manual retry action; never label stale data as fresh.

**Files:** [provider client](../src/website/challengermode.ts), [schedule routes](../src/web/routes/schedules.ts), [sync utility](../src/util/tournament.ts).

**Acceptance:** A temporary rate limit does not require repeated user clicks. Invalid credentials produce a setup action, while a temporary outage displays the last known data with a stale warning.

### 17. Make match operations resumable — P1

**Opportunity:** Timers are already persisted, but each multi-step Discord operation needs a recoverable outcome across restarts and partial failures.

**Implementation:** Record per-match stages such as thread created, players added, announcement sent, and completed. Assign a stable operation ID and persist Discord message/thread IDs. Reconcile existing resources before retrying. Use durable job claims if multiple processes can run. Version notification jobs when schedules change so old reminders are cancelled intentionally.

**Files:** [round command](../src/commands/round.ts), [round routes](../src/web/routes/rounds.ts), [match threads](../src/util/matchThreads.ts), [persistent timer](../src/timer/PersistentTimer.ts).

**Acceptance:** Restarting after thread creation resumes the remaining work without creating a duplicate thread. Rescheduling cannot send an obsolete reminder, and failed recipients can be retried independently.

### 18. Build a useful event-day overview — P1

**Opportunity:** The system page exposes technical statistics, while organisers need to know what requires action now.

**Implementation:** Add upcoming matches, unresolved verification, missing roles, unmatched teams, unscheduled matches, failed jobs, and stale syncs. Link each item to its correction screen. Keep technical diagnostics available separately. Provide empty, loading, stale, and error states with a clear next action.

**Files:** [system routes](../src/web/routes/system.ts), [system view](../src/web/views/system.ejs), tournament detail view.

**Acceptance:** An organiser can find the next match and every blocking readiness issue from one screen without searching logs.

### 19. Improve mobile and keyboard accessibility — P1

**Evidence:** The shared modal helper creates overlays but does not visibly implement focus trapping, focus restoration, dialog semantics, or Escape handling. Toasts disappear after five seconds by default.

**Implementation:** Add labelled dialogs, keyboard focus management, accessible status announcements, persistent actionable errors, and labelled icon buttons. Test table overflow, touch controls, readable contrast, and zoom. Retain failed form input and place validation beside the affected field.

**Files:** [dashboard helpers](../src/web/public/js/app.js), [views](../src/web/views), [styles](../src/web/public/css), [desktop UI](../ui/index.html).

**Acceptance:** Keyboard-only users can open, operate, and close a dialog with focus restored. An organiser can import and edit a schedule on a narrow screen without losing inputs.

### 20. Make player search useful at event scale — P1

**Evidence:** The search route returns all matching players and sorts them in application memory. It includes email and identity fields in its response.

**Implementation:** Add bounded pagination and stable database sorting; filter by tournament, team, verification state, and Discord ID. Add indexes based on measured queries. Mask emails for roles that do not need them. Keep filters in the URL and show result counts and clear no-results guidance.

**Files:** [player routes](../src/web/routes/players.ts), [player page script](../src/web/public/js/pages/players.js), player entity and migrations.

**Acceptance:** Search remains bounded for a large test roster; navigating pages does not skip or duplicate records, and unauthorised roles never receive full email values.

## Collaboration, operations, and maintainability

### 21. Add individual organiser accounts and server scope — P1 for shared hosting

**Evidence:** Dashboard authentication records a shared authenticated boolean; it does not model individual staff or per-guild access. This differs from server-scoped Discord commands.

**Implementation:** For multi-organiser hosting, introduce individual authentication and server membership checks. Define owner, organiser, referee, and viewer capabilities. Enforce guild and tournament scope in the service/query layer for reads, exports, and mutations. Keep a simpler authenticated local-owner mode for a single desktop installation.

**Files:** [web server](../src/web/server.ts), [web routes](../src/web/routes), [host authorisation](../src/database/postgres.ts).

**Acceptance:** Staff assigned to one server cannot access another server's records by changing a URL or API parameter. Viewers cannot mutate data.

### 22. Replace placeholder activity with an audit trail — P1

**Evidence:** `/api/system/activity` derives entries from tournaments and assigns the current timestamp as a placeholder, rather than recording actual actions.

**Implementation:** Persist actor, scope, action, timestamp, outcome, and a safe change summary for imports, verification overrides, schedule changes, syncs, and access changes. Use operation IDs to connect related events. Redact credentials and minimise personal information. Show real activity with filters and an authorised export.

**Files:** [system routes](../src/web/routes/system.ts), database entities, shared service operations.

**Acceptance:** A schedule edit shows who changed it and its actual time. Viewing the activity page does not make old events appear new.

### 23. Add privacy and retention controls — P1

**Opportunity:** The project holds participant emails, Discord identities, verification data, and private tickets.

**Implementation:** Explain what is collected during check-in. Limit staff visibility by role and redact logs. Define retention per data category, clear expired challenges, and offer authorised participant deletion/export and tournament archival. Explain how backup retention affects deletion. Record deletions without retaining the deleted personal content in audit events.

**Files:** [player entity](../src/database/orm/EnrolledPlayer.ts), [email helper](../src/role/helper/email.ts), [logger](../src/util/logger.ts), player and tournament routes.

**Acceptance:** A retention run removes eligible private data while preserving required non-personal tournament summaries. Exports and deletion actions enforce the same access rules as the dashboard.

### 24. Improve health checks and support diagnostics — P1

**Evidence:** `/api/health` reports `ok` and a timestamp without checking dependencies. A process can be alive while the bot is unusable.

**Implementation:** Separate basic liveness from authenticated readiness diagnostics. Include Discord readiness, database access, last integration success, email configuration, job backlog, and build version. Provide a redacted downloadable support bundle and human-readable recovery instructions. Avoid making every health poll call external providers.

**Files:** [web server](../src/web/server.ts), [system routes](../src/web/routes/system.ts), [logger](../src/util/logger.ts), [desktop main](../electron/main.ts).

**Acceptance:** A disconnected bot is reported as not ready even though its process is alive. A support bundle contains enough context to diagnose failure without tokens, OTPs, or raw participant emails.

### 25. Strengthen desktop installation and upgrades — P1

**Opportunity:** Build workflows and installer commands exist. Release readiness also needs validation of the installed product and its data lifecycle.

**Implementation:** Test clean installs and upgrades on supported operating systems, including paths containing spaces. Verify signing/notarisation configuration and packaged resources. Show version and release notes; back up data before schema upgrades. Prevent duplicate bot processes and distinguish window close, minimise, and shutdown. Make update failure leave the previous working installation and data recoverable.

**Files:** [desktop main](../electron/main.ts), [builder configuration](../electron-builder.yml), [package scripts](../package.json), [build workflows](../.github/workflows).

**Acceptance:** A packaged application starts on a clean machine, retains settings across upgrade, shuts down gracefully, and does not start a second bot against the same local database.

### 26. Consolidate business logic across interfaces — P1, incremental

**Opportunity:** Prefix commands, slash commands, and web routes are separate entry points for overlapping operations. Divergent validation and failure handling are difficult to maintain.

**Implementation:** Extract focused services for verification, enrolment, scheduling, tournament sync, and access checks as those areas are changed. Have entry points translate transport input into validated requests and render typed results. Preserve current tested sync behaviour. Rename legacy Challonge terminology at boundaries first; migrate stored column names only with an explicit compatibility plan.

**Files:** [commands](../src/commands), [slash commands](../src/slash), [web routes](../src/web/routes), [tournament utility](../src/util/tournament.ts), [database interface](../src/database/interface.ts).

**Acceptance:** The same invalid request is rejected consistently through Discord and HTTP. Extracting a service does not alter existing supported behaviour.

### 27. Extend tests around complete user journeys — P1

**Evidence:** The project already has substantial tests and cross-platform CI. Its testing guide explicitly distinguishes isolated coverage from real browser, PostgreSQL migration, and authenticated integration coverage.

**Implementation:** Add focused tests for items 1–7, then end-to-end journeys for setup, import preview, verification recovery, schedule changes, restart recovery, and access isolation. Exercise real PostgreSQL migrations in an isolated CI database. Add browser keyboard/mobile checks and packaged-app smoke tests. Keep external integration tests optional and credential-isolated.

**Files:** [testing guide](TESTING.md), [tests](../test), [checks workflow](../.github/workflows/checks.yml).

**Acceptance:** Regressions in the participant journey or an upgrade are detected before release. Existing tests remain useful; coverage percentages are not treated as proof that a live event works.

### 28. Maintain a single command and troubleshooting reference — P1

**Opportunity:** Commands, slash commands, guides, examples, and UI messages can drift independently.

**Implementation:** Define command metadata for permission, scope, parameters, examples, and available interfaces. Generate or validate reference documentation from it. Add short organiser and participant quick-starts plus task-specific troubleshooting. Check local links in CI and use fictional example data with explicit timezone labels.

**Files:** [command definitions](../src/Command.ts), [help command](../src/commands/help.ts), [documentation](.), [README](../README.md).

**Acceptance:** Every documented command exists, examples match supported syntax, links resolve, and users can find a recovery step from an error message.

## Product extensions to validate with users

### 29. Participant “My tournament” view — P2

**Proposal:** Provide a private view of enrolment status, team, next match, local start time, match thread, bracket, and help.

**Implementation:** Start with a Discord response backed by the same scoped read service as the dashboard. Show explicit states for awaiting verification, awaiting schedule, ready, and completed. Add an authenticated web view only if organisers and participants need it.

**Acceptance:** A participant finds their next action without seeing other participants' private information or asking an organiser.

### 30. Team readiness and roster checks — P2

**Proposal:** Help organisers identify incomplete teams before matches begin.

**Implementation:** Configure expected roster size, substitutes, and captain designation per tournament. Show missing verification, duplicate account links, and unresolved team mappings. Use provider UUIDs as identity and team names as display labels. Preview and audit any organiser override.

**Files:** [team utilities](../src/util/teams.ts), player entities, tournament detail view.

**Acceptance:** Staff can identify why a team is not ready, and a renamed team does not lose its linked players.

### 31. Configurable reminders and calendar export — P2

**Proposal:** Reduce missed matches while avoiding repetitive pings.

**Implementation:** After durable jobs are available, add configurable reminder offsets, recipient preferences, delivery status, and a fallback when DMs fail. Export calendar events with stable identifiers and revision handling. Ensure changed times replace pending reminders and cancelled matches suppress them.

**Acceptance:** A schedule change results in reminders for the new time only. Calendar updates refer to the same event rather than creating duplicates.

### 32. Dispute and support tracking — P2

**Proposal:** Give referees a structured way to resolve match problems.

**Implementation:** Add “Request referee” to match threads, creating a case linked to the tournament and match. Track assigned staff, status, messages/evidence references, and resolution. Restrict access and apply retention. Link users to Challengermode for official score changes; keep the current integration read-only.

**Acceptance:** Participants can request help and see acknowledgement; staff can find unresolved cases and record a resolution without claiming to submit a remote score.

### 33. Reusable tournament presets and localisation — P2

**Proposal:** Reduce repetitive setup for recurring events and improve clarity for the intended audience.

**Implementation:** Save non-secret presets for channels, timezone, check-in rules, roster requirements, reminders, and message templates. Validate referenced Discord resources when applying a preset. Centralise user-facing text and preserve Australian English as the default; prioritise additional languages based on actual participant demand.

**Acceptance:** A recurring tournament can reuse settings without copying participant data or credentials. Missing channels are flagged, and translated messages retain working commands and links.

## Suggested delivery sequence

### Release A: trustworthy verification and administration

Complete items 1–8. Start with identity verification and truthful email results, then secure admin access and configuration, then prove backup/migration recovery. Include regression tests with each fix rather than deferring them to a later release.

Release gate: a participant cannot claim another person's enrolment; delivery failures are clear; closed tournaments stay closed; unauthorised dashboard requests fail; data restoration is demonstrated.

### Release B: an organiser can prepare an event independently

Complete items 9–16 and the relevant portions of 19, 26, and 28. Deliver one continuous path from setup to a validated schedule. Introduce the shared service boundaries only where needed for these features.

Release gate: an organiser unfamiliar with the code can connect a tournament, resolve import problems, verify a test participant, and schedule a real fixture using the interface and guide.

### Release C: dependable event-day operation

Complete items 17–25 and 27, with item 21 required before hosting multiple independent organisers. Prove restart recovery, data isolation, actionable diagnostics, and installation upgrades.

Release gate: a simulated provider outage, Discord permission failure, and process restart each have a tested recovery path without duplicate match resources or silent data loss.

### Release D: expand based on observed needs

Validate items 29–33 with organisers and participants. Start with the feature that removes the most frequent support request. Keep remote tournament writes outside this roadmap unless separately scoped and verified against provider capabilities.

## How to measure whether users benefit

Record a baseline before changing a flow, then compare the same journey after release. Suggested measures are setup completion, time to first ready tournament, verification completion and failure reasons, import correction effort, missed or duplicate notifications, and support requests per event. Track aggregate outcomes without storing OTPs or unnecessary personal information.

Use a small rehearsal tournament with an organiser, a referee, a participant with working email, and a participant who encounters a failure. Run through setup, import, verification, scheduling, a permission failure, restart, and recovery. Ask each person what they believe happened and what they would do next; unclear answers identify the next usability improvement.

## Review limitations

This guide is based on repository inspection and selected official implementation references. It does not claim a complete security audit, live API validation, dependency vulnerability scan, installer certification, or a passing test run. Recommendations marked as proposals need product validation. No application behaviour was changed as part of writing this guide.
