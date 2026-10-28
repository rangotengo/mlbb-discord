# Troubleshooting

[Back to main](../README.md) · [Command reference](commands.md)

Task-oriented recovery steps. The quoted messages are the bot's actual replies, so you can find
your case by searching this page for what you saw.

## Participants

### "This command can only be used in ticket channels. Please use `!check-in` to create a ticket."

`!email` and `!verify` are deliberately restricted to the private ticket channel.

1. Send `!check-in` in a normal server channel.
2. If you are not auto-verified, the bot opens `ticket-<your username>` and links you to it.
3. Use `!email` and `!verify` inside that channel only.

If you already have a ticket, `!check-in` replies with a link to it instead of creating a new one.

### "We couldn't automatically verify you … issue creating a ticket"

The bot could not create the ticket channel. Usually missing **Manage Channels** permission for the
bot, or a `tickets` category with restrictive permissions. Ask an organiser to check the bot's
permissions, then send `!check-in` again.

### "Verification Failed — Invalid E-Mail address provided or you have not been enrolled by the TO."

The address you gave is not enrolled for any tournament in this server.

- Check for typos, including on mobile where pasting can add invisible characters (the bot strips
  these, but a genuinely wrong address still fails).
- The enrolment may use a different address. Ask the organiser which address is on their list; they
  can check the dashboard **Players** page or `!update-player` to correct it.
- If you were never enrolled, the organiser must add you to the CSV and re-import it.

### "Please wait Xs before requesting a new code."

There is a 60-second cooldown (`OTP_RESEND_COOLDOWN_MS`) between verification requests. Wait the
indicated number of seconds and send `!email <address>` again.

### "You have reached the limit of 3 code requests. Please contact a Tournament Organizer for assistance."

You have exhausted the maximum of 3 code requests (`OTP_MAX_SENDS`). This limit is per enrolment
and protects against email spam or misdelivery. An organiser can manually verify you using:
```text
!verify-player @your-user your_email@example.com [tournament-id]
```

### "Verification Code Not Sent — Your code could not be sent: ..."

The bot attempted to send an OTP email, but delivery was rejected by the provider or failed with a
timeout or missing credentials.

- **Do not wait for an email**; no email was delivered.
- You can retry `!email` after a moment.
- If it fails again, alert a Tournament Organizer: Gmail API credentials may have expired or need setup.

### "Please provide a valid 6-digit OTP."

Verification codes are strictly 6 digits. Ensure you send only the numbers with no extra letters,
spaces, or quotes (e.g. `!verify 123456`).

### "No active verification code found for you. Please use `!email <your_email>` first..."

You ran `!verify` before `!email`, or requesting a new code invalidated an earlier one. Send
`!email <address>` to get a fresh code, and use the code from the most recent email.

### "Your code has expired. Please request a new one with `!email <your_email>`."

Verification codes expire after 10 minutes (`OTP_EXPIRY_MS`). Run `!email <address>` inside your
ticket to receive a new code.

### "Too many incorrect attempts. Please request a new one with `!email <your_email>`."

You entered incorrect codes 5 times (`OTP_MAX_ATTEMPTS`). For security, the active code was
invalidated. Request a new code with `!email <address>`.

### "Invalid OTP provided. X attempts remaining."

The 6-digit code does not match the active challenge. Check that you are typing the newest code from
your inbox.

### "⚠️ ... identity verified; access pending. The participant role could not be assigned..."

Your email identity verification succeeded and is recorded in the database, but Discord refused to
grant you the tournament role (commonly because the bot's role is below the participant role in Server
Settings → Roles).

- **You do not need to re-enter a code.**
- Alert a Tournament Organizer so they can adjust the role hierarchy.
- Once fixed, simply send `!check-in` in any channel to complete your role assignment and join match threads.

### "This Email has already been verified."

That email's enrolment is already linked to a Discord account. If it is linked to *your* old
account, ask an organiser to relink it with `!verify-player @user email [id] override`. If someone
else claimed it, the organiser can see the linked account on the dashboard players page and should
investigate.

### "❌ Check in is already closed. Please contact the Tournament Organizer for assistance."

Check-in is disabled for that tournament (or for every tournament you are enrolled in). Ask an
organiser; if you are legitimately a late joiner, they can re-open check-in from the dashboard
tournament page (**Enable Check-in**) and you can run `!check-in` again.

### I am verified but have no participant role / no match thread.

Role grant can fail if the bot's highest role is below the role it must assign, or the role was
deleted. Send `!check-in` again — it detects a verified player missing the role and repairs it,
also re-adding you to existing match threads. An organiser can repair everyone at once with
`!sync-roles [id]`, or use **Set participant role** to point the tournament at a role the bot can
actually assign.

### Where do I report a score?

On [Challengermode](https://www.challengermode.com/), or to an organiser. The bot reads results; it
does not submit them.

## Organisers

### "⚠️ Already Verified to Another Account" when using `!verify-player`

If an email enrolment is already linked to another Discord account, `!verify-player` refuses to
silently replace the link. If the reassignment is intentional (e.g. participant changed Discord
accounts), supply `override` as the final argument:
```text
!verify-player @new-user player@example.com [tournament-id] override
```
The reassignment and the authorising organiser are logged in the audit trail.

### "⚠️ Identity verified for ..., but the participant role could not be assigned"

The identity link is saved in the database, but Discord rejected the role assignment. Move the
bot's role above the participant role in **Server Settings → Roles**, or use
`!set-participant-role <id> <@role>` to point the tournament to a role the bot is permitted to
manage. Then have the participant run `!check-in` to claim their role.

### "429 Too Many Requests" / "Too many attempts. Try again in a few minutes."

The dashboard login endpoint throttles requests to **10 failed attempts per 5 minutes per IP**. Wait
for the 5-minute window to elapse before trying again.

### "403 Forbidden" / "CSRF token missing or invalid"

All state-changing web requests (POST/PUT/PATCH/DELETE) require a valid CSRF token in the
`X-CSRF-Token` header. If submitting via an external script or API client, obtain a token from
`GET /api/csrf` first and include the `X-CSRF-Token` header in your request. In browser sessions,
refresh the page to refresh expired layout tokens.

### Localhost dashboard prompts for login

The previous loopback IP auto-login bypass has been removed for security (preventing unauthenticated
access through local reverse proxies). All dashboard access requires authentication with
`WEB_PASSWORD` or the desktop app's bootstrap token (`MLBB_DESKTOP_BOOTSTRAP`).

### "Must be a Tournament Organizer" / commands silently do nothing for a helper

The TO role (default `DOT-TO`) gates `!add`, `!list`, and player-management commands. Give the role
to anyone who must run them. Do **not** rename or delete it — the bot finds it by name and will
create a new, empty one.

Per-tournament commands (`!sync`, `!round`, `!update`, …) need **host** status instead:
`!addhost [id] @user`. Being TO does not automatically make someone a host of a tournament they
did not create.

### "Multiple tournaments exist in this server. Please specify the tournament ID"

Add the tournament ID to the command, e.g. `!sync mlbb-cup`.

### CSV imports fail

- Enrolment CSV needs `name`, `email`, and `team` headers (`discord` optional). See
  [examples/enroll-example.csv](examples/enroll-example.csv) or download the template from the
  tournament page.
- Schedule CSV needs `match_id`, `scheduled_time`, `timezone`. Match IDs are Challengermode match
  series UUIDs — export them with `!matches [id] download` rather than typing them.
- Ambiguous or nonexistent local times during a DST changeover are rejected; give an explicit UTC
  offset (`+05:30`) or use UTC.
- A UUID that belongs to a different tournament cannot be scheduled; export the UUIDs from the
  tournament you are scheduling.

### Players cannot verify en masse

Check, in order:

1. Email delivery is configured (server/desktop). On the server, Gmail credentials must be present
   or every send fails; participants then see a generic error rather than a code.
2. The participant's email in the enrolment CSV is correct — dashboard players page.
3. Check-in is open for that tournament.
4. The bot's role is above the participant role it assigns.

### "Something went wrong with Challengermode! Please try again later."

The API call failed — expired or missing refresh key, a rate limit, or an outage. First stop:
`/system` page or the logs. If the refresh key is wrong, replace it in `.env` (server) or the
desktop **Challengermode Configuration** (see [Challengermode setup](CHALLENGERMODE_SETUP.md)) and
restart. A tournament whose last sync failed shows its last successful data; re-run `!sync [id]`
once the cause is fixed.

### Duplicate or missing match threads

`!round` refuses to start a round where any fixture has no scheduled time — set the missing times
(dashboard schedule page or `!schedule`) and run `!round` again. If a thread exists but players are
missing, `!check-in` (by the player) or `!sync-roles [id]` repairs membership. Threads are only
created through `!round`; re-running it for the same round creates new threads, so fix schedules
before confirming rather than after.

### Tickets piling up

Participants can close their own with the **Close Ticket** button; you can close any with `!close`
inside it. A stale ticket means the participant never completed verification — check the dashboard
players page for their enrolment state before deleting.

## Desktop app

See [Desktop app setup](DESKTOP_APP_SETUP.md#troubleshooting) for start-up, port, network access,
and configuration-validation problems.

## Server operators

See [Deployment and operations](OPERATIONS.md) for database, migration, backup/restore, upgrade,
and dashboard-access procedures.

---

[Back to main](../README.md)
