# Flow diagrams

[Back to main](../README.md) · [User flows](USER_FLOWS.md) · [Command reference](commands.md)

ASCII diagrams for the flows the bot implements today. The integration with Challengermode is
read-only: scores and registration happen on the platform, never through the bot.

## Participant verification flow

```
                              !check-in  (server channel)
                                    │
                                    ▼
                      ┌───────────────────────────┐
                      │ Previously verified       │
                      │ Discord user ID?          │
                      └─────────────┬─────────────┘
                          yes │         │ no (or suggested name match)
                              ▼         ▼
              ┌──────────────────┐  ┌────────────────────────┐
              │ Restore access    │  │ Create private ticket  │
              │ (role + threads); │  │ channel ticket-<user>  │
              │ retry if pending  │  └───────────┬────────────┘
              └──────────────────┘              │
                                                ▼
                                    ┌────────────────────────┐
                                    │ !email <address>       │
                                    │ (in ticket; 10m expiry,│
                                    │  60s cd, max 3 sends)  │
                                    └───────────┬────────────┘
                                                │ code emailed (accepted by provider)
                                                ▼
                                    ┌────────────────────────┐
                                    │ !verify <6-digit code> │
                                    │ (in the same ticket)   │
                                    └───────────┬────────────┘
                                                │
                                    confirm identity (DB)
                                    + grant role & thread membership
                                                │
                                                ▼
                                    ┌────────────────────────┐
                                    │ All enrolments pass?   │
                                    └───────────┬────────────┘
                                        yes │       │ no / role pending
                                            ▼       ▼
                             ┌──────────────────┐  ┌──────────────────┐
                             │ Ticket auto-     │  │ Ticket stays     │
                             │ closes in 5s     │  │ open for staff   │
                             └──────────────────┘  └──────────────────┘

  Failures at any box have a recovery path: see TROUBLESHOOTING.md
```

## Organiser setup flow

```
  TO configures Challengermode refresh key  (docs/CHALLENGERMODE_SETUP.md)
                                    │
                                    ▼
         !add <challengermode-url> <name>          (TO role; auto-syncs)
                                    │
                                    ▼
         Register teams on Challengermode          (platform, not the bot)
                                    │
                                    ▼
         !enroll [id]  + players.csv               (host; local enrolment)
         name,email,team[,discord]; team names match Challengermode
                                    │
                                    ▼
         !matches [id] download                    (match series UUIDs)
         !schedule [id]  + schedule.csv            (host; in-progress only)
         match_id,scheduled_time,timezone          (stored as UTC)
                                    │
                                    ▼
         Check-in open?  dashboard toggle          (open by default)
                                    │
                                    ▼
         Players verify                            (see diagram above)
                                    │
                                    ▼
         !status [id]                              (verified/total per team)
```

## Round management flow

```
                   !round [id] <#channel> <round>          (host)
                                    │
                                    ▼
                      ┌───────────────────────────┐
                      │ Fetch round's open matches │
                      │ from Challengermode        │
                      └─────────────┬─────────────┘
                                    ▼
                      ┌───────────────────────────┐
                      │ Every fixture scheduled?   │──no──▶ reply listing
                      └─────────────┬─────────────┘        missing times;
                          yes │                               fix and retry
                              ▼
                  Confirm & Start  /  Cancel    (5-minute prompt)
                              │ confirm
                              ▼
              ┌───────────────────────────────────────┐
              │ Per fixture: private thread            │
              │ "Team One vs Team Two", mentions of    │
              │ verified players, scheduled time,      │
              │ thread recorded against the schedule   │
              └─────────────┬─────────────────────────┘
                                    ▼
                     Play the match; report the result
                     ON CHALLENGERMODE (not via the bot)
                                    │
                                    ▼
                     !sync [id]  refreshes standings
                     and fixtures; next round repeats
```

## Recovery flow

```
                    A command fails
                          │
                          ▼
            ┌─────────────────────────┐
            │ Which failure?          │
            └────────────┬────────────┘
     │            │             │            │
     ▼            ▼             ▼            ▼
 usage/usage   tournament     provider      internal
 error         not found      (Challermo-  error
 (bad args,    (no/many       mode rate    (logged;
  no perms)    tournaments)   limit/outage) reply "try
     │            │             │            later")
     ▼            ▼             ▼            ▼
 bot replies   bot lists      bot replies   check
 with the     tournaments    "something    /system and
 exact fix    or asks for    went wrong    logs; then
               the id        with         TROUBLE-
                             Challenger-   SHOOTING.md
                             mode"
```

---

[Back to main](../README.md)
