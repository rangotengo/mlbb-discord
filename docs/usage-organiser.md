# Commands for tournament hosts

[Back to main](../README.md) · [Full command reference](commands.md) · [Troubleshooting](TROUBLESHOOTING.md)

Commands are prefixed (default `!`). Parameters are separated by spaces; replace anything shown as
`<like this>` with your value. Parameters in square brackets `[like this]` are optional.

**Tournament IDs.** The `id` parameter is optional when the server has exactly one tournament. With
several tournaments you must give the ID. Host commands are scoped to the current server and never
work in direct messages; a tournament can only be managed from the server it was created in.

**Two kinds of authority.** The **TO role** (default `DOT-TO`, configurable) marks tournament
organisers and gates `!add`, `!list` and `!enroll`. Being a **host** of a specific tournament is
granted with `!addhost` and gates the per-tournament commands. Some player-management commands
accept the TO role *or* server Administrator.

## Index

1. [Add a tournament](#add-a-tournament)
1. [List ongoing tournaments](#list-ongoing-tournaments) — `!list`
1. [Add host](#add-host) / [Remove host](#remove-host) — `!addhost`, `!removehost`
1. [Enroll players via CSV](#enroll-players-via-csv) — `!enroll`
1. [Update tournament information](#update-tournament-information) — `!update`
1. [Show tournament details](#show-tournament-details) — `!info`
1. [View or change tournament status](#view-or-change-tournament-status) — `!status`
1. [Check-in summary and control](#check-in-summary-and-control) — `!status`, dashboard toggle
1. [Import or export match schedules](#import-or-export-match-schedules) — `!schedule`, `!matches`
1. [Proceed to the next round](#proceed-to-the-next-round) — `!round`
1. [Message a team](#message-a-team) — `!pingteam`
1. [Synchronise tournament info](#synchronise-tournament-info) — `!sync`
1. [Repair participant roles](#repair-participant-roles) — `!sync-roles`
1. [Manage enrolled players](#manage-enrolled-players) — `!update-player`, `!drop-player`, `!verify-player`, `!set-participant-role`
1. [Override score](#override-score)
1. [Close a ticket](#close-a-ticket) — `!close`
1. [Utility](#utility) — `!help`, `!coin`, `!toss`

## Reference

### Add a tournament

First [configure Challengermode access](CHALLENGERMODE_SETUP.md), then add the tournament URL and
sync it:

```text
!add https://www.challengermode.com/s/your-space/tournaments/<uuid> mlbb-cup
!sync mlbb-cup
```

**Caller permission level**: TO role.

The URL may be a full tournament URL, a URL under a Space, or a raw tournament UUID. The name
becomes the tournament ID used by every other command. The bot creates the tournament, adds you as
its host, and syncs it immediately. Register teams and set tournament settings on Challengermode;
the bot only reads them.

### List ongoing tournaments

```
!list
```

**Caller permission level**: TO role.

Lists all preparing and in-progress tournaments in the server with ID, name, status, and player count.

### Add host

```
!addhost [id] @discordtag
```

**Caller permission level**: host for the tournament (identified by _id_ if multiple tournaments exist).

`@discordtag` must be a valid Discord mention that pings the user. They gain the same tournament
permissions you have.

### Remove host

```
!removehost [id] @discordtag
```

**Caller permission level**: host for the tournament.

`@discordtag` may be a mention (it does not have to ping) or the user ID. You cannot remove
yourself if you are the only host. A host who leaves the server keeps host status and regains it if
they return.

### Enroll players via CSV

```
!enroll [id] <CSV attachment>
```

**Caller permission level**: host for the tournament.

Attach a CSV with `name`, `email`, and `team` columns; `discord` (Discord username) is optional.
Team names must match the Challengermode line-up names so match threads can find players.

```csv
name,email,team,discord
Player One,player1@example.com,Team Alpha,playerone
Player Two,player2@example.com,Team Alpha,playertwo
```

Rows whose email already exists are updated rather than duplicated. This enrols players **locally**
for verification and ping purposes; it does not register anyone on Challengermode. A ready-made
template is [examples/enroll-example.csv](examples/enroll-example.csv), and the dashboard offers a
template download on the tournament page.

### Update tournament information

```
!update [id] <name> <description>
```

**Caller permission level**: host for the tournament.

Only while the tournament is preparing and not started. Changes the **local** name and description;
the next sync replaces them with the Challengermode values. Remote settings are changed on
Challengermode itself.

### Show tournament details

```
!info [id]
```

**Caller permission level**: everybody.

Shows an embed with the tournament name, description, Challengermode link, capacity, CSV-enrolled
count, format, status, round 1 byes, and hosts.

### View or change tournament status

```
!status [id] [new_status]
```

**Caller permission level**: host for the tournament.

With no status argument, shows the current status plus a per-team check-in summary (verified count
out of total). With a status — `preparing`, `in progress` (or `ipr`), `complete` — it changes the
local status. Sync overwrites the status from Challengermode.

### Check-in summary and control

`!status [id]` shows the check-in summary. Whether check-in is open is controlled per tournament
from the dashboard's tournament page (**Enable/Disable Check-in**, or toggle-all on the list page).
When check-in is disabled, `!check-in`, `!email`, and `!verify` refuse to process that tournament's
records.

### Import or export match schedules

```
!schedule [id] <CSV attachment>
!matches [id] download
```

**Caller permission level**: host for the tournament; the tournament must be in progress.

`!schedule` imports `match_id`, `scheduled_time`, `timezone` rows. Match IDs are Challengermode
**match series UUIDs** — get them with `!matches [id] download`, which exports every fixture with its
UUID and current time. Times are stored in UTC; ambiguous or nonexistent local times during a DST
transition are rejected unless the CSV gives an explicit UTC offset.

```csv
match_id,scheduled_time,timezone
00000000-0000-0000-0000-000000000001,2026-03-13 18:00:00,+05:30
00000000-0000-0000-0000-000000000002,2026-03-13 19:00:00,+05:30
```

Without `download`, `!matches [id]` lists every fixture grouped by round with its state and thread
link. The dashboard's schedule page can also import, edit, and export schedules.

### Proceed to the next round

```
!round [id] <#channel> <roundNumber>
!round <#channel> <roundNumber>
```

**Caller permission level**: host for the tournament; the tournament must be in progress.

The channel must be a text channel the bot can access. The bot:

1. fetches the round's open matches from Challengermode,
2. checks that every fixture has a scheduled time (it refuses to start otherwise),
3. shows a confirmation prompt with all fixtures, and after **Confirm & Start**
4. creates a private thread per fixture, mentions the verified players of both teams, and records
   the thread against the schedule.

Thread names are `Team One vs Team Two`. Players who verify later are added to existing threads by
`!check-in`.

### Message a team

```
!pingteam [id] <teamName> <message>
```

**Caller permission level**: tournament organiser/host.

Pings every verified, Discord-linked player enrolled under `teamName`. Useful because teams do not
have Discord roles; match threads ping individual players directly.

### Synchronise tournament info

```
!sync [id]
```

**Caller permission level**: host for the tournament.

Refreshes the locally stored name, description, status, line-ups, fixtures, and available start
times from Challengermode. Run it after results, registrations, or settings change on the platform.
Manually assigned schedule times are preserved. The dashboard has an equivalent **Sync from
Challengermode** action.

### Repair participant roles

```
!sync-roles [id]
```

**Caller permission level**: host for the tournament.

Re-grants the participant role to every verified player who is missing it. Use after role
accidents or a Discord outage.

### Manage enrolled players

```
!update-player <email> <field:value> [field:value ...] [id]
!drop-player <email> [id]
!verify-player <@user> <email> [id] [override]
!set-participant-role <id> <@role>
```

**Caller permission level**: TO role (or Administrator); `!set-participant-role` additionally needs
Manage Roles.

- `!update-player` changes `email`, `name`, `team`, or `discord` for one enrolled player.
- `!drop-player` removes an enrolment; if the player was verified the bot warns you to remove their
  server roles yourself.
- `!verify-player` links a Discord account to an enrolment by email and verifies it — the recovery
  path when a participant cannot receive email.
  - If the email is already verified to a different Discord account, the command refuses to overwrite
    it silently. To reassign, repeat the command with `override` as the final argument (e.g. `!verify-player @user email id override`); the reassignment is logged in the audit trail.
  - Identity verification is recorded in the database unconditionally. If the participant role cannot
    be assigned (e.g. role hierarchy permissions), access is marked pending; fix the role and have the
    participant run `!check-in` to retry role assignment without re-verifying.
- `!set-participant-role` chooses which existing server role verified players receive. Without it,
  the bot auto-creates a role named `<id>-player` per tournament.

The dashboard's players and participants pages can do the same through the browser.

### Override score

Scores are submitted or corrected on Challengermode. `!forcescore` and `!score` reply with
instructions and change nothing. After correcting a result remotely, run `!sync [id]`.

### Close a ticket

```
!close
```

**Caller permission level**: TO role or Administrator; run inside a ticket channel.

Deletes the ticket channel after five seconds. Participants close their own tickets with the
**Close Ticket** button.

### Utility

```
!help
!coin
!toss
```

`!help` shows the command summary and code revision. `!coin`/`!toss` flip a coin — handy for
deciding map or side picks.

## Dashboard

Most of the above is also available at the web dashboard (`/tournaments`, `/players`, `/system`,
`/config`, `/privacy`, `/support`) — see [Deployment and operations](OPERATIONS.md) and
[Desktop app setup](DESKTOP_APP_SETUP.md).

- **Authentication**: Loopback IP auto-login bypass is removed. All local and remote access requires
  logging in with `WEB_PASSWORD` or the desktop app's one-time bootstrap token.
- **CSRF Protection**: All state-changing web requests (POST/PUT/PATCH/DELETE) require the `X-CSRF-Token` header.
- **Rate Limiting**: Login endpoints are throttled to 10 failed attempts per 5 minutes per IP.

---

[Back to main](../README.md)
