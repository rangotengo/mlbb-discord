# Command reference

[Back to main](../README.md)

Every command the bot currently supports, generated against the source in `src/commands/` and
`src/slash/` and verified by `docs/commands.test.cjs` in CI: if a command is added, removed, or
renamed in code without this page changing, the checks fail.

**Prefix.** All prefix commands use the configured prefix, `!` by default (`DOT_DEFAULT_PREFIX`).

**Tournament `id`.** Optional when the server has exactly one tournament; required when it has
several.

**Authority levels.**

| Level | Meaning |
| --- | --- |
| everyone | Any member, in any channel the bot can read. |
| participant | Any member *without* the TO role (TOs are blocked from participant verification commands). |
| host | Host of that specific tournament (granted via `!addhost`, or by creating it). |
| TO | Holder of the TO role (default `DOT-TO`, set by `DOT_DEFAULT_TO_ROLE`). |
| TO or Admin | TO role or Discord Administrator. |

## Prefix commands

| Command | Level | Where | Parameters | Summary |
| --- | --- | --- | --- | --- |
| `!add` | TO | server | `<url> [...name]` | Add a Challengermode tournament by URL/UUID and name, then auto-sync. |
| `!addhost` | host | server | `[id] <@user>` | Add a host to a tournament. |
| `!check-in` | participant | server | — | Restore access for returning verified users, or open a private ticket to verify. |
| `!close` | TO or Admin | ticket channel | — | Delete this ticket channel. |
| `!coin` | everyone | server/DM | — | Flip a coin. |
| `!drop-player` | TO or Admin | server | `<email> [id]` | Remove an enrolment by email. |
| `!email` | participant | ticket channel | `<address>` | Send a 6-digit OTP to your enrolled email (10m expiry, 60s cooldown, max 3 requests). |
| `!enroll` | host | server | `[id] <CSV attachment>` | Import players locally from CSV (`name`, `email`, `team`, optional `discord`). |
| `!forcescore` | host | server | `[id] <score>` | Explains that scores are managed on Challengermode; changes nothing. |
| `!help` | everyone | server/DM | — | Show the command summary and code revision. |
| `!info` | everyone | server | `[id]` | Show tournament details embed. |
| `!list` | TO | server | — | List preparing/in-progress tournaments. |
| `!matches` | host | server | `[id] [download]` | List fixtures by round, or download a schedule CSV of match UUIDs. |
| `!pingteam` | TO | server | `[id] <teamName> <message>` | Ping all verified players of a team. |
| `!removehost` | host | server | `[id] <@user or id>` | Remove a tournament host. |
| `!round` | host | server | `[id] <#channel> <roundNumber>` | Create match threads for a round after confirmation. |
| `!schedule` | host | server | `[id] <CSV attachment>` | Import match times (`match_id`, `scheduled_time`, `timezone`). Tournament must be in progress. |
| `!score` | participant | server | `[id] <score>` | Explains that scores are managed on Challengermode; changes nothing. |
| `!set-participant-role` | TO (Manage Roles) | server | `<id> <@role>` | Choose the role granted to verified participants. |
| `!status` | host | server | `[id] [new_status]` | Show status + check-in summary, or set `preparing`/`in progress`/`complete`. |
| `!sync` | host | server | `[id]` | Refresh tournament data from Challengermode. |
| `!sync-roles` | host | server | `[id]` | Re-grant missing participant roles for verified players. |
| `!toss` | everyone | server/DM | — | Flip a coin. |
| `!update` | host | server | `[id] <name> <description>` | Update local name/description while preparing. |
| `!update-player` | TO or Admin | server | `<email> <field:value>… [id]` | Update one enrolled player's `email`/`name`/`team`/`discord`. |
| `!verify` | participant | ticket channel | `<otp>` | Submit 6-digit OTP; confirms identity and grants role (ticket auto-closes if all pass). |
| `!verify-player` | TO or Admin | server | `<@user> <email> [id] [override]` | Manually verify/link a participant; use `override` to reassign. |

## Slash commands

Slash commands are registered when the bot starts. Several are restricted through Discord's own
permission system; the bot re-checks tournament authority when they run.

| Command | Discord-level gating | Parameters | Summary |
| --- | --- | --- | --- |
| `/add tournament` | Administrator | `url`, `name`, `participantrole?` | Add a Challengermode tournament (equivalent of `!add`). |
| `/host add` | hidden default (no one; must be granted) | `tournament?`, `user` | Add a tournament host. |
| `/host remove` | hidden default | `tournament?`, `user` | Remove a tournament host. |
| `/info` | hidden default | `tournament?` | Show tournament details. |
| `/invite` | hidden default | `channel?`, `uses?`, `quantity?` | Create invite links. |
| `/list` | hidden default | — | List tournaments in this server. |
| `/set-participant-role` | Manage Roles | `tournament`, `role` | Set the participant role for a tournament. |
| `/thread` | hidden default | `team_a`, `team_b`, `channel?` | Create a match thread for two teams. |
| `/timer` | hidden default | `duration`, `final_message?` | Start a countdown timer in the current channel. |
| `/update` | hidden default | `tournament?`, `name?`, `description?` | Update local tournament details. |
| `/verify-player` | Manage Roles | `user`, `email`, `tournament?` | Manually verify a participant. |

"Hidden default" means the command is disabled for `@everyone` and must be enabled per-role in
**Server Settings → Integrations**. `/add tournament` additionally requires Administrator by
default; the bot still requires the TO role for tournament creation.

The participant journey (`!check-in`, `!email`, `!verify`) is prefix-command based; there are no
slash equivalents yet.

## Buttons

| Button | Where it appears | Effect |
| --- | --- | --- |
| Confirm & Start / Cancel | `!round` prompt | Create the round's match threads, or abort. |
| Close Ticket | ticket channels | Delete the ticket channel. |

## Dashboard equivalents

| Task | Prefix | Dashboard |
| --- | --- | --- |
| Add a tournament | `!add` | Tournaments → Add Tournament (full URL) |
| Sync | `!sync` | Tournament page → Sync from Challengermode |
| Enrol players | `!enroll` | Tournament page → import participants CSV |
| Import/export schedule | `!schedule`, `!matches … download` | Tournament page → schedules import/download |
| Toggle check-in | — | Tournament page → Enable/Disable Check-in (per tournament), or toggle-all on the list page |
| Edit players | `!update-player`, `!drop-player` | Participants/Players pages |
| View status & logs | `!status`, logs | `/system` |
| Configuration | — | `/config` |
| Privacy & Retention | — | `/privacy` |
| Support & Diagnostics | — | `/support` |

## Examples

Fictional data; times carry explicit timezone labels and are stored as UTC.

```csv
name,email,team,discord
Asha Patel,asha.patel@example.com,Team Koala,ashapatel
Ben Taylor,ben.taylor@example.com,Team Koala,bentaylor
```

```csv
match_id,scheduled_time,timezone
00000000-0000-0000-0000-000000000001,2026-03-13 18:00:00,+05:30
00000000-0000-0000-0000-000000000002,2026-03-13 19:00:00,+05:30
```

```text
!add https://www.challengermode.com/s/example-space/tournaments/00000000-0000-0000-0000-00000000000a example-cup
!enroll example-cup          (attach players.csv)
!sync example-cup
!matches example-cup download   (attach nothing; returns schedule CSV)
!schedule example-cup          (attach schedule.csv)
!status example-cup
!round example-cup #match-threads 1
```

---

[Back to main](../README.md)
