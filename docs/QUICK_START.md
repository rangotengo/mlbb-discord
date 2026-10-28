# Quick start

[Back to main](../README.md)

Two five-minute paths: one for the person running the bot (organiser) and one to paste into your
tournament channel for players.

## Organiser quick start

Goal: bot running, one tournament connected, players enrolled, check-in open.

1. **Get credentials**
   - A Discord bot token from the [Discord developer portal](https://discord.com/developers/applications)
     (enable the **Server Members** and **Message Content** intents).
   - A Challengermode **application refresh key** — see
     [Challengermode setup](CHALLENGERMODE_SETUP.md).
2. **Run the bot** — pick one:
   - **Desktop app** (no Node.js needed): install, paste the token and refresh key, Save & Start.
     See [Desktop app setup](DESKTOP_APP_SETUP.md).
   - **Server**: set `.env` from `.env.example` and `docker-compose up --build`, or
     `npm ci && npm run build && npm start`. See
     [Deployment and operations](OPERATIONS.md).
3. **Invite the bot** to your server with the permissions listed in the
   [README](../README.md#discord-permissions). On joining, it creates the TO role (default
   `DOT-TO`); give it to yourself and every staff member who will run organiser commands.
4. **Connect the tournament** in Discord:
   ```text
   !add https://www.challengermode.com/s/your-space/tournaments/<uuid> my-cup
   !sync my-cup
   ```
5. **Enrol players** — prepare `players.csv` (`name`, `email`, `team`, optional `discord`), then:
   ```text
   !enroll my-cup        (attach players.csv)
   ```
   Team names must match the Challengermode line-ups. Register the teams on Challengermode itself.
6. **Schedule matches**:
   ```text
   !matches my-cup download     (gives you the match UUIDs)
   !schedule my-cup             (attach schedule.csv: match_id,scheduled_time,timezone)
   ```
7. **Open check-in** (it is open by default; the dashboard tournament page controls it), announce
   the participant quick start below, and watch `!status my-cup` fill in.
8. **On the day**: `!round my-cup #match-threads 1`, confirm, and the threads appear with every
   verified player mentioned. Results go on Challengermode; afterwards `!sync my-cup`.

Stuck? [Troubleshooting](TROUBLESHOOTING.md) · [Command reference](commands.md).

## Participant quick start (paste this into your tournament channel)

To join the tournament:

1. Send `!check-in` in this server. If you were previously verified, your participant role is restored immediately.
2. If this is your first time, the bot opens a **private ticket channel** (`ticket-<your username>`) just for you and staff.
3. In that channel, send `!email your_address@example.com` using the address you registered with (the 6-digit code expires in 10 minutes; max 3 requests).
4. When the code arrives in your email inbox, send `!verify 123456` in the same ticket channel.
5. That's it — the bot grants you the participant role and the ticket closes itself. You will be pinged in your private match thread when your round starts.

Notes:

- Your email is only ever visible in your private ticket, never in public channels.
- You can request a code at most three times; after that, ask a Tournament Organiser.
- **Report scores on Challengermode**, not to the bot.
- Something wrong? See [Troubleshooting](TROUBLESHOOTING.md), or ping a Tournament Organiser.

---

[Back to main](../README.md)
