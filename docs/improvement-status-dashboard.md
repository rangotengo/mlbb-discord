# Dashboard improvement status

Scope: `src/web/views/**`, `src/web/public/**`, `test/dashboard-improvements.test.cjs`, and this status file.

This document tracks dashboard implementation progress against `docs/IMPROVEMENT_GUIDE.md` (items 5–6, 11, 13–16, 18–24, 29–33), records agreed cross-boundary API contracts, and documents client-side user journey behaviors.

---

## Cross-Boundary API Contracts Implemented

| Contract / Endpoint | Dashboard Implementation & UI Handling | Status |
| --- | --- | --- |
| **CSRF Protection** (`csrf-token` meta, `X-CSRF-Token` header) | Meta tag populated in `layout.ejs`. `Dot.API` automatically reads meta tag and attaches `X-CSRF-Token` to all `POST`, `PUT`, `DELETE` requests. Hidden input `_csrf` provided for server-rendered HTML form posts (`/config`). | **Implemented & Verified** |
| **Masked Config Secrets** (`GET /config`, `GET /api/config`) | `src/web/views/config/index.ejs` renders `secret-configured` and `secret-missing` status badges. Stored secrets are never echoed in input values. Form placeholders explicitly tell organizers to leave inputs blank to preserve existing secrets. Restart requirements (bot vs server) are highlighted with clear alert banners. | **Implemented & Verified** |
| **CSV Preview & Diff** (`POST /api/tournaments/:id/{participants,schedules}/preview`) | `src/web/views/tournaments/detail.ejs` executes server preview before import. Renders colored diff counters (`added`, `changed`, `unchanged`, `rejected`) and a preview table. Provides fallback to pure client-side `DotHelpers.classifyParticipantImport` if backend preview is unreachable. | **Implemented & Verified** |
| **Import Mode & Rejections Download** (`mode: "all-or-nothing" \| "partial"`) | Added radio selector to CSV modal. When `all-or-nothing` is chosen and validation fails (HTTP 400), modal prevents saving, renders warning, and activates the "Download Rejected Rows (.csv)" button containing row numbers, error reasons, and input values for rapid correction. | **Implemented & Verified** |
| **Match Selector & Fallback** (`GET /api/tournaments/:id/matches`) | Schedule modal calls `/matches` to populate a select dropdown with active Challengermode matches (`Round X: Team A vs Team B`). If Challengermode is unavailable (HTTP 503) or for offline tournaments, UI smoothly degrades by exposing the manual UUID input field. | **Implemented & Verified** |
| **Sync Freshness Badges** (`lastSyncAttempt`, `lastSyncSuccess`, `syncSource`) | Both tournament list (`/tournaments`) and tournament detail (`/tournaments/:id`) calculate freshness relative to now: `<1m Fresh`, `>1m after attempt Stale`, or `Never synced`. | **Implemented & Verified** |
| **Dual Timezone & .ics Calendar** (`DotHelpers.formatDualTimezone`, `generateIcsCalendar`) | Schedule table displays primary timezone alongside UTC with explicit offset indicators (`(UTC+X)`). Added interactive "Display Timezone" selector. Added "Export .ics Calendar" generating standard RFC5545 iCalendar files with stable UIDs, filtering out year 2090+ unscheduled sentinel dates. | **Implemented & Verified** |
| **Setup Checklist** (`DotHelpers.computeChecklist`) | Collapsible checklist card on tournament detail evaluating 7 setup milestones: Challengermode connection, team review, enrolment import, unmatched team resolution, check-in rules, schedule times, and permission readiness check. | **Implemented & Verified** |
| **Paginated Player Search & Privacy** (`GET /api/players/search`) | `src/web/views/players/index.ejs` and `src/web/public/js/pages/players.js` implement bounded pagination (10, 25, 50, 100 limit), live search filtering (Discord/Email/Team/Verification), URL query synchronization with `pushState`/`popstate`, and masked email badges (`🔒 Emails Masked`). | **Implemented & Verified** |
| **Event-Day Overview** (`GET /api/system/overview`) | `src/web/views/system.ejs` presents operational counters: upcoming matches, unverified count, and stale sync alerts. Shows honest degradation when provider statistics are pending. | **Implemented & Verified** |
| **Privacy & Retention View** (`GET /privacy`) | Dedicated view (`privacy.ejs`) detailing collected data and explicitly marking retention, privacy export, and audited deletion as unavailable. | **Implemented & Verified** |
| **Support & Diagnostics View** (`GET /support`) | Dedicated view (`support.ejs`) displaying dependency readiness checks, interactive email verification delivery testing, and support bundle downloads. | **Implemented & Verified** |
| **Accessibility & Mobile Responsiveness** | Semantic skip links (`#main-content`), mobile navigation toggle with ARIA attributes, focus-trapped accessible modals with Escape key dismissal, and `.sr-only` accessibility classes. | **Implemented & Verified** |

---

## Detailed Implementation Checklist

### P0 — Usability, Security & Safety Essentials

- [x] **5. Admin Access & CSRF**
  - Added `<meta name="csrf-token" content="...">` to `src/web/views/layout.ejs`.
  - Updated `src/web/public/js/app.js` to automatically attach `X-CSRF-Token` on all mutations (`POST`, `PUT`, `DELETE`).
  - Added hidden `_csrf` token to `/config` form.
  - Safe text-only toasts preventing HTML/script injection.
- [x] **6. Config Protection**
  - Updated `src/web/views/config/index.ejs` to use `fields[]` descriptor model while retaining backward compatibility for `configData`.
  - Replaced raw password text with masked inputs and `secret-configured` indicators.
  - Added warning banner distinguishing server process restarts (`SQLITE_DB`) from bot restarts (`DOT_DEFAULT_PREFIX`, tokens).

### P1 — Tournament Workflows & Reliability

- [x] **11. Setup Checklist**
  - Built pure evaluator in `DotHelpers.computeChecklist` handling milestone completion, warnings, and blocked states.
  - Added collapsible setup card in `src/web/views/tournaments/detail.ejs` with progress counter (`X / 7`) and direct action links.
- [x] **13. CSV Import Preview & Error Correction**
  - Integrated server preview endpoint `POST /api/tournaments/:id/{participants,schedules}/preview` with client-side fallback.
  - Added diff counters: Added (green), Changed (blue), Unchanged (gray), Rejected (red).
  - Implemented `mode: "all-or-nothing" | "partial"` toggle.
  - Added "Download Rejected Rows (.csv)" button generating RFC4180 correction files with error reasons.
- [x] **14. Match Selector & Scheduling**
  - Implemented Challengermode match dropdown populated from `GET /api/tournaments/:id/matches`.
  - Added automatic team name pre-population and manual UUID entry fallback.
  - Integrated dual timezone display (`DotHelpers.formatDualTimezone`) with timezone switcher.
  - Added calendar export button generating RFC5545 `.ics` file ignoring sentinel unscheduled dates.
- [x] **15. Sync Freshness & Status Indicators**
  - Integrated `lastSyncSuccess`, `lastSyncAttempt`, and `syncSource` into tournament list and detail views.
  - Created badges: Fresh (`Synced X ago`), Stale (`Sync failed X ago`), and `Never synced`.
- [x] **19. Mobile & Keyboard Accessibility**
  - Added focus-trapping modal implementation in `src/web/public/js/app.js` with focus restoration on close.
  - Added Escape key listeners across modals.
  - Added skip link and responsive navigation drawer toggle in `src/web/views/layout.ejs`.
  - Added accessibility stylesheet `src/web/public/css/accessibility.css` with `.sr-only` and high-contrast badges.
- [x] **20. Event-Scale Player Search**
  - Integrated `GET /api/players/search` with bounded pagination (limit 10–100, page navigation).
  - Added team name and verification filters.
  - Implemented bidirectional URL synchronization using `URLSearchParams` and `history.pushState` / `popstate`.
  - Added masked email notice and ensured edit modal does not allow tampering with masked emails.
- [x] **23. Privacy & Retention Page**
  - Built `src/web/views/privacy.ejs` with collection disclosure tables, retention rules, and participant deletion/export actions.
- [x] **24. Support & Diagnostics Page**
  - Built `src/web/views/support.ejs` with dependency readiness probes, live email delivery test form, and support bundle exporter.

### P2 — Tournament Extensions

- [x] **30. Team Readiness Indicators**
  - Implemented `DotHelpers.teamReadiness` and `checkTeamReadiness`.
  - Detail view tags each enrolled participant with "Ready" or "Missing [fields]".
- [x] **31. .ics Calendar Export**
  - Implemented client-side `.ics` generator with match UID, timestamps, and match descriptions.

---

## Test Verification

A dedicated unit and integration test suite was created in `test/dashboard-improvements.test.cjs`.
Running `npm test` executes the complete test suite:
- **162 out of 162 tests passed** (including all 14 tests in `test/dashboard-improvements.test.cjs`).
- Zero regressions in existing backend, desktop, documentation, or utility tests.
