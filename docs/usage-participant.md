# Commands for participants

[Back to main](../README.md) · [Command reference](commands.md) · [Troubleshooting](TROUBLESHOOTING.md)

To play in a Mobile Legends tournament run with this bot, you check in once, verify your email if
the bot cannot recognise you, and then you receive the tournament participant role and match pings.
You never need to give your email to a person or post it in a public channel.

**Registering your team and submitting scores happens on
[Challengermode](https://www.challengermode.com/), not in Discord.** Verification with this bot only
links your Discord account to your locally enrolled entry and grants access in this server.

## Quick start

1. In any channel of the tournament server, send `!check-in`.
2. If your Discord account was previously verified, your participant role and match-thread access are restored immediately.
3. If you are not yet verified, the bot creates a **private ticket channel** visible only to you and the organisers, named `ticket-<your username>`.
4. In that ticket channel, send `!email your_address@example.com` (use the address the organiser enrolled you with).
5. Check your inbox for a 6-digit code, then send `!verify 123456` in the same ticket channel.
6. Once verified, the ticket closes automatically.

## Reference

### Help

Explicitly ping the bot (a reply does not count) or send `!help` in a channel where the bot is
present. This replies with a link to the documentation and the code revision currently running,
which is useful when asking for support.

### Verifying for a tournament

#### Step 0 — Check in

```
!check-in
```

Send this in a normal server channel, not a direct message.

- **Returning verified participant** — if your Discord account was already verified for tournaments
  in this server, `!check-in` verifies that check-in is still open, restores your participant role if
  missing, adds you to active match threads, and reports per-tournament status.
- **First-time / unverified participant** — matching usernames or server display names are suggestions
  only and do not prove account ownership. The bot opens a private ticket channel `ticket-<your username>`
  for you and links to it.

If you already have an open ticket, the bot replies with a link to it instead of creating another one.

#### Step 1 — Request a verification code, inside your ticket

```
!email your_address@example.com
```

`!email` only works inside your ticket channel. Anywhere else the bot replies that the command is
restricted and points you back to `!check-in`. This is deliberate: your email address is only ever
visible to you and the organisers.

- The address must be the one the organiser enrolled for you in an open tournament. Closed tournaments
  are skipped automatically; an open tournament can still proceed.
- Codes are 6 digits and expire in **10 minutes**.
- There is a **60-second cooldown** between code requests.
- You can request a code at most **three times** (`OTP_MAX_SENDS`); after that, ask an organiser for help.
- Requesting a new code **invalidates** the previous one.
- The bot only confirms that a code was sent when the email provider actually accepts it. If delivery
  fails (e.g. missing provider credentials, expired authorization, or network timeout), the bot
  explicitly informs you that the code was **not** delivered and advises you to contact staff.

#### Step 2 — Submit the code, inside the same ticket

```
!verify 123456
```

`!verify` is also restricted to ticket channels and accepts **exactly 6 digits**. If the code matches:

1. **Identity is confirmed**: your Discord account is permanently linked and marked verified in the database.
2. **Access is granted**: the bot assigns you the tournament participant role and adds you to any match threads already created.
3. **Per-tournament evaluation**: if enrolled in multiple tournaments, each is evaluated individually (closed tournaments are left untouched).
4. **Ticket lifecycle**: the ticket auto-closes after 5 seconds **only** if every requested tournament succeeded. If any tournament has an issue, the ticket stays open for staff assistance.

If role assignment fails (e.g. due to Discord role hierarchy permissions), your identity remains safely verified, and the bot reports:
`⚠️ identity verified; access pending`. In that case, ask a Tournament Organizer to fix the role, then run `!check-in` again to retry role assignment — **you do not need to re-enter a verification code**.

### During a tournament

The organiser decides when each round begins. When a round starts, the bot creates a private match
thread per fixture named `Team One vs Team Two`, and mentions every verified player in it. If you
verify after a round started, `!check-in` adds you to the threads you missed.

If a match has a scheduled time, the thread shows it as a Discord timestamp rendered in your local
timezone.

### Tickets

- Created automatically by `!check-in` when you need email verification.
- Visible only to you and tournament staff.
- You can close yours with the **Close Ticket** button inside it.
- An organiser can close any ticket with `!close` in that channel.
- Auto-closes after successful verification only when all requested tournament enrolments succeed.

### Submitting scores

Submit or correct results on Challengermode, or tell an organiser. The bot reads tournament data; it
does not submit scores. `!score` and `!forcescore` only explain this. After a result changes on
Challengermode, an organiser runs `!sync [id]` to refresh the bot.

## If something goes wrong

Full recovery steps, including missing enrolment, wrong email, closed check-in, and a missing
participant role, are in [Troubleshooting](TROUBLESHOOTING.md). The short version:

| Message you saw | What to do |
| --- | --- |
| "This command can only be used in ticket channels." | Send `!check-in` first; use `!email`/`!verify` inside the ticket it gives you. |
| "Invalid E-Mail address provided or you have not been enrolled by the TO." | Ask the organiser which address they enrolled for you. |
| "Please wait Xs before requesting a new code." | Wait for the 60-second resend cooldown before asking for another OTP. |
| "You have reached the limit of 3 code requests." | You used your three email requests; an organiser must help or verify you manually. |
| "Your code could not be sent: ..." | Email delivery failed on the provider side. Do not wait for email; alert a TO. |
| "Invalid OTP provided." | Use the newest code in your inbox; older codes are invalidated when a new one is sent. |
| "Your code has expired." | Request a fresh code with `!email <your_email>`. Codes expire in 10 minutes. |
| "Too many incorrect attempts." | The code was invalidated after 5 incorrect entries. Request a fresh one with `!email`. |
| "identity verified; access pending" | Your verification succeeded, but the role could not be assigned. Ask staff to fix the role, then run `!check-in`. |
| "Check in is already closed." | Check-in is finished for that tournament; ask an organiser. |
| Verified but no role / no match thread. | Send `!check-in` again; it repairs roles and thread membership. |

---

[Back to main](../README.md)
