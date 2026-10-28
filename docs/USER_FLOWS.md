# User flows

[Back to main](../README.md) · [Command reference](commands.md) · [Flow diagrams](FLOW_DIAGRAMS.md)

The end-to-end journeys the bot supports today, described against the current implementation.
Challermode/Challonge-era score-submission and team-registration flows have been removed: the
integration is read-only (see [Challengermode setup](CHALLENGERMODE_SETUP.md)).

## Roles

| Role | Granted by | Can |
| --- | --- | --- |
| Tournament Organiser (TO) | Discord role (default `DOT-TO`), created by the bot on join | Add tournaments, list tournaments, manage enrolled players |
| Tournament host | `!addhost` or by creating the tournament | Everything for that tournament: sync, enrol, schedule, rounds, hosts |
| Participant | The tournament's participant role, granted on verification | Play, be pinged in match threads |

Being a TO does not make you a host of a tournament someone else created, and vice versa.

## Organiser flow: from zero to a running event

1. **Connect the tournament.** `!add <url> <name>` (TO role) creates the local record, adds you as
   host, and auto-syncs. The dashboard's *Add Tournament* does the same with a full URL.
2. **Enrol players.** Prepare a CSV (`name`, `email`, `team`, optional `discord`) and attach it to
   `!enroll [id]`. Existing emails are updated, not duplicated. Team names must match the
   Challengermode line-up names. Register the teams themselves on Challengermode.
3. **Set the schedule.** `!matches [id] download` exports the match series UUIDs; fill in
   `scheduled_time` and `timezone` and attach the CSV to `!schedule [id]` (tournament must be in
   progress), or edit times in the dashboard. Times are stored in UTC.
4. **Open check-in.** It is open by default; the dashboard tournament page toggles it per
   tournament. Announce the [participant quick start](QUICK_START.md#participant-quick-start-paste-this-into-your-tournament-channel).
5. **Watch verification.** `!status [id]` shows a per-team verified/total summary; the dashboard
   players page shows the detail. Recover individuals with `!verify-player` when email fails.
6. **Run the round.** `!round [id] <#channel> <n>` previews the fixtures, requires every fixture to
   have a time, then (after confirmation) creates a private thread per fixture mentioning the
   verified players of both teams.
7. **Results and progress.** Scores are reported on Challengermode. Afterwards `!sync [id]`
   refreshes standings, fixtures, and status locally. Repeat per round.
8. **Close out.** Mark the tournament complete on Challengermode and sync; disable check-in on the
   dashboard so stale records cannot be mutated.

## Participant verification flow

Two paths, both starting from `!check-in` in a server channel (never a DM):

1. **Returning verified user** — if your Discord user ID was previously verified (or manually linked
   by a TO), `!check-in` confirms open tournament status, restores the participant role if missing,
   adds you to match threads, and reports per-tournament outcomes.
2. **First-time / new verification** — matching usernames or server display names are suggestions
   only and do not grant automatic access. The bot creates `ticket-<your username>`, a private channel
   for you and staff:
   1. `!email <enrolled address>` inside the ticket (10-minute expiry, 60s cooldown, max 3 requests).
      Closed tournaments are skipped; delivery must be acknowledged by the email provider.
   2. A 6-digit cryptographic OTP is sent to your inbox.
   3. `!verify <6-digit code>` inside the ticket.
   4. Identity is recorded first; participant roles and match threads are granted. If role assignment
      fails (e.g. role hierarchy permissions), identity remains verified and access is marked pending;
      a TO fixes the role and you run `!check-in` again without needing another code.
   5. The ticket channel auto-closes only when every requested tournament enrolment succeeded.

Recovery paths at every step are in [Troubleshooting](TROUBLESHOOTING.md): wrong email, exhausted
attempts, expired/invalid code, closed check-in, and missing role are all recoverable by the
participant or an organiser.

## Match-day flow

1. Organiser runs `!round [id] <#channel> <round>`; the bot refuses if any fixture lacks a time.
2. Each fixture gets a private thread `Team One vs Team Two` with the scheduled time (Discord
   timestamp, each member sees their own timezone) and mentions of verified players.
3. Late verifiers are repaired by `!check-in` (player) or `!sync-roles` (everyone).
4. Results are entered on Challengermode; `!sync [id]` brings them back; the next round repeats.
5. `!pingteam [id] <team> <message>` reaches a team's verified players without team roles.

## Dashboard flows

The web administration interface provides a graphical interface for tournament setup, participant management, scheduling, monitoring, and diagnostics. See [Deployment and operations](OPERATIONS.md) for access control and [Desktop app setup](DESKTOP_APP_SETUP.md) for local desktop access.

### 1. Tournament setup and readiness checklist

- Open `/tournaments` to view all managed tournaments, their format, capacity, and sync status.
- On the tournament detail page (`/tournaments/:id`), an automated **Setup Checklist** tracks progress towards event readiness:
  1. Tournament registration and capacity configured.
  2. Participants enrolled (teams meet minimum roster).
  3. Match schedules assigned with valid times.
  4. Check-in enabled for participant verification.
  5. Challengermode synchronization status fresh.
- **Sync freshness**: Displays live indicators (`Just now`, `X minutes ago`, or `Stale`) based on `lastSyncAttempt` and `lastSyncSuccess`. If Challengermode synchronization encounters an error, a warning badge alerts organisers that local fixture data may be out of date.

### 2. Reviewable CSV import (participants and schedules)

- **Participant import**:
  - Open **Import CSV** on the Participants tab.
  - Paste or upload CSV text (`name`, `email`, `team`, optional `discord`).
  - The modal provides an immediate structural check and requests a diff preview from the server (`POST /api/tournaments/:id/participants/preview`).
  - Displays categorised summary statistics before applying changes:
    - **Added**: new players to be created.
    - **Changed**: existing records with updated emails or Discord IDs.
    - **Unchanged**: identical records requiring no modification.
    - **Rejected**: rows with validation errors (missing required fields, duplicate emails within the file, invalid format).
  - Organisers can choose an **All-or-nothing** commit (aborts import if any row is invalid) or **Partial** import (commits valid rows and reports rejected rows).
- **Schedule import**:
  - Open **Import CSV** on the Schedules tab.
  - Validates match series UUIDs against Challengermode tournament fixtures, parses ISO-8601 timestamps, and presents a diff preview before updating database records.

### 3. Schedule management and calendar export

- **Dual timezone display**: Match schedules display both the user's local browser time and UTC.
- **Calendar export**: Organisers can export tournament match schedules as an `.ics` iCalendar file for calendar integration or download as a CSV file.

### 4. Player search and privacy controls

- Located at `/players`.
- **Search and filters**: Filter players by search query (matching email or Discord ID), team name, and verification status (`Verified only` / `Unverified only`).
- **Bounded pagination**: Supports page sizes of 10, 25, 50, and 100 players per page, keeping URL query parameters synchronized for easy bookmarking and sharing.
- **Privacy protections**: Participant email addresses are masked by default (`j***e@domain.com`) in the UI and read-only searches to protect player privacy.
- **Export**: Export filtered player rosters to CSV.

### 5. Event-day system overview

- Located at `/system`.
- **Needs attention panel**: Live operational counters showing:
  - Total tournaments in progress.
  - Total unverified participants requiring assistance.
  - Upcoming matches scheduled in the next 2 hours.
- **Stale data alerts**: Highlights tournaments where the latest Challengermode sync failed.

### 6. Support, diagnostics, and privacy transparency

- **Privacy & Retention (`/privacy`)**:
  - Documents exact participant fields collected (email, captain name, team, Discord ID, verification state) and purpose of processing.
  - Explains that automated retention, privacy export, and audited deletion are not yet available; contact the organiser for data requests.
- **Support & Diagnostics (`/support`)**:
  - **Dependency readiness checks**: Reports Discord connection state, a database read query, the last recorded Challengermode sync, and whether email credentials are configured. It does not prove live delivery or provider availability.
  - **Email delivery test**: Form to send a live test email through configured Google OAuth credentials to verify mail delivery without creating participant challenges.
  - **Diagnostic support bundle**: Generates and downloads a redacted JSON bundle containing system architecture, Node.js version, and aggregate record counts for support requests. Non-sensitive only; tokens and participant emails are stripped.

## State model

Tournaments are `preparing`, `in progress`, or `complete` (synced from Challengermode; `!status`
can set it locally). Enrolled players progress unverified → verified, with an email-send counter
and an optional pending code. A tournament's check-in can additionally be disabled, which freezes
its verification commands while other tournaments stay open.

---

[Back to main](../README.md)
