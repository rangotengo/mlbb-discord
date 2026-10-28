# Deployment and operations

[Back to main](../README.md)

How to run the bot in production, control dashboard access, back up and restore data, and upgrade
safely. For the packaged desktop app specifically, see [Desktop app setup](DESKTOP_APP_SETUP.md).

## Topology choice

| Deployment | Use when | Notes |
| --- | --- | --- |
| Desktop app | One organiser, one machine | Simplest; SQLite by default; OS-backed secure secret storage; guided 7-step wizard; local dashboard session via bootstrap token, optional network access with a password. |
| Docker Compose | Always-on server | PostgreSQL, daily backups, and the bot as configured in `docker-compose.yaml`. |
| Bare Node.js | Server without Docker | `npm ci && npm run build && npm start` with `.env`; bring your own PostgreSQL (or SQLite for small events). |

## Environment

Copy `.env.example` to `.env` and fill in at least `DISCORD_TOKEN`,
`CHALLENGERMODE_REFRESH_KEY`, `DOT_DEFAULT_PREFIX`, and `DOT_DEFAULT_TO_ROLE`, plus **one**
database setting:

- `SQLITE_DB=./data/dot.db` — single file, fine for one server and small rosters, or
- `POSTGRESQL_URL=postgresql://user:password@host:5432/dbname` — recommended for production.

Optional configuration:

- `WEB_PORT` (default `3000`): port for the administration web dashboard.
- `WEB_BIND` (default `127.0.0.1`): interface to bind to. Set to `0.0.0.0` inside containers or to allow external network access.
- `WEB_PASSWORD`: dashboard password. Mandatory for dashboard access (there is no unauthenticated loopback bypass).
- `WEB_SESSION_SECRET`: secret key for encrypting dashboard sessions. If unset, a random 32-byte hex secret is generated per process start (meaning sessions do not survive process restarts).
- `WEB_TRUST_PROXY`: set to `true` if behind a reverse proxy so `X-Forwarded-*` headers are respected.
- `WEB_HTTPS` or `WEB_FORCE_HTTPS`: set to `true` to require `Secure` cookies.
- `MLBB_DESKTOP_BOOTSTRAP`: generated dynamically by the Electron desktop runner for one-time localhost session authentication.
- `OTP_EXPIRY_MS` (default `600000` = 10 minutes): verification code lifetime.
- `OTP_RESEND_COOLDOWN_MS` (default `60000` = 60 seconds): delay required between `!email` requests.
- `OTP_MAX_ATTEMPTS` (default `5`): incorrect verification attempts permitted before code invalidation.
- `OTP_MAX_SENDS` (default `3`): maximum OTP send requests per participant enrolment.
- `OTP_HMAC_SECRET`: HMAC key for hashing verification codes in memory. Regenerated per process start if unset.
- `DOT_PARTICIPANT_ROLE` (default `Participant` — used as a fallback role name), `DOT_LOGGER_WEBHOOK`, `DOT_REVISION`.

### Roles and permissions

- `DOT_DEFAULT_TO_ROLE` names the role the bot creates when it joins a server and treats as
  Tournament Organisers. **Default in `.env.example`: `TO`.** The desktop app's setup form
  defaults the same field to `Organizer`. Pick one spelling and use the same value everywhere;
  renaming or deleting the role afterwards makes the bot lose track of it and create a new one.
- The bot needs the Discord permissions listed in the
  [README](../README.md#discord-permissions); match threads additionally require the bot's role to
  sit above any participant role it assigns.

### Email delivery (verification codes)

`!email` sends codes through Gmail with OAuth credentials (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, optional `GOOGLE_TOKEN_URI`) or, on Windows, a
`credentials.json` at `C:/mlbb-data/credentials/credentials.json`. If no credentials are
configured, the send fails and the participant is told an error occurred — **no code is delivered
and nothing is silently marked sent**. Configure these before opening check-in, and test with one
enrolled address first. The sending address is currently fixed in the email helper.

## Dashboard access

- The web dashboard listens on `WEB_PORT` (default `3000`) and binds to `WEB_BIND` (default `127.0.0.1`).
- **No loopback IP bypass**: For security, unauthenticated access from `127.0.0.1` is no longer permitted. All access requires a valid session.
- **Login methods**:
  - **Password login**: Submit `WEB_PASSWORD` at `/login`.
  - **Desktop app bootstrap**: The Electron wrapper generates a cryptographically random one-time token in `MLBB_DESKTOP_BOOTSTRAP` and consumes it via `POST /login/desktop` (or `GET /login/desktop?token=&path=`) with constant-time comparison. Once consumed, the token cannot be reused.
- **Brute-force protection**: Login endpoints (`/login` and `/login/desktop`) are rate-limited to **10 failed attempts per 5 minutes per IP** (HTTP 429).
- **CSRF protection**: Every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) with an authenticated session requires an `X-CSRF-Token` header matching the session token.
  - Web pages retrieve this token from the layout `<meta name="csrf-token" content="...">`.
  - API consumers can fetch a token from `GET /api/csrf`.
  - `/login` and `/login/desktop` are CSRF-exempt.
  - State-changing API requests failing CSRF receive `403 JSON` (`{"success":false,"error":"CSRF token missing or invalid"}`); unauthenticated API calls receive `401 JSON`.
- **Pages available**:
  - `/tournaments`: tournament management and sync.
  - `/players`: enrolled participant search and status.
  - `/system`: system liveness, statistics, and recent logs.
  - `/config`: view application configuration.
  - `/privacy`: privacy notice and retention policy.
  - `/support`: diagnostics and troubleshooting information.
- Treat `WEB_PORT` as an administrative port. Put TLS and reverse proxy authentication in front of it if exposed to the public internet, and set `WEB_TRUST_PROXY=true`.

## Data, backups, and restore

**What is stored.** SQLite file (default `./data/dot.db` or desktop `userData/dot.db`) or your
PostgreSQL database. Tournaments, enrolled players (name, email, team, Discord link, verification
state), match schedules, and timers. Secrets (`DISCORD_TOKEN`, `CHALLENGERMODE_REFRESH_KEY`,
`WEB_PASSWORD`, Gmail OAuth) live only in secure configuration (`.env` on servers, OS `safeStorage`
or `secrets.json` [mode 0600] on desktop), never in the database.

**Back up before every upgrade.**

- **Desktop app**: The app automatically creates a timestamped backup before version changes into
  `userData/backups/<timestamp>-vOLD-to-vNEW/` containing `dot.db`, `config.json`, `secrets.json`,
  and `manifest.json`. You can also trigger an immediate snapshot at any time with the **Back up now**
  button on the Storage setup screen. Restore is a manual procedure: fully quit the app and copy the
  files back to `userData/` (see [Desktop app setup](DESKTOP_APP_SETUP.md#backups-upgrades-and-restore)).
  PostgreSQL databases are not file-copied by the desktop backup mechanism.
- **Server SQLite**: Stop the bot, copy the database file, restart.
  ```sh
  cp data/dot.db "backups/dot-$(date -u +%Y%m%dT%H%M%SZ).db"
  ```
- **PostgreSQL**:
  ```sh
  pg_dump --format=custom --file "backups/dot-$(date -u +%Y%m%dT%H%M%SZ).dump" "$POSTGRESQL_URL"
  ```
  The Compose stack runs
  [`prodrigestivill/postgres-backup-local`](https://github.com/prodrigestivill/docker-postgres-backup-local)
  on a schedule into `./backups` — check that `BACKUP_SCHEDULE` fits your event calendar.

**Restore.**

- SQLite: stop the bot, replace the database file with the copy, start the bot.
- PostgreSQL:
  ```sh
  pg_restore --clean --if-exists --dbname "$POSTGRESQL_URL" backups/dot-<timestamp>.dump
  ```
- Configuration and secrets are restored separately by putting your `.env` (or desktop `config.json`
  and `secrets.json`) back in place; a database restore does not restore credentials.

**Retention and privacy.** Enrolled player emails and Discord identities persist until dropped or
the database is deleted; deleted rows are not archived anywhere else, but **backups retain the data
they were taken from** — include backup files in any deletion request and rotate them on a defined
schedule. There is no automated retention job today.

## Migrations and upgrades

1. Read the release notes for schema or configuration changes.
2. Take a backup (above).
3. Update the code (`git pull`, or install the new desktop package — installers keep settings and
   data in place).
4. Start the bot. On startup, pending database migrations run automatically — for SQLite they run
   when the connection opens, as they do for PostgreSQL. A frozen baseline migration creates
   missing tables on fresh installations. Production databases do not use automatic schema synchronisation.
   PostgreSQL execution still needs validation against a real server before deployment.
5. Watch the first start-up in the logs/dashboard for migration or connection errors before
   reopening check-in.

**Downgrades are not supported after an identifier migration.** Migrations that widen identifier
columns (for example numeric Challonge IDs to Challengermode UUIDs) cannot be reversed; restoring
the pre-upgrade backup is the only way back.

### Docker Compose specifics

- `docker-compose up -d postgres` starts only the database; `docker-compose up --build` builds and
  runs everything (bot, adminer, backup, watchtower).
- Database files live in the `database` volume; backups in `./backups`; translations in `./dbs`.
- The bot container connects to PostgreSQL at `postgres:5432` with the credentials from `.env`.

## Monitoring, diagnostics, and support

- **Dashboard overview (`/system`)**: Displays high-level stats, system platform info, and an actionable "Needs attention" panel highlighting upcoming matches, unverified participants, and stale tournament sync alerts.
- **Support & diagnostics (`/support`)**:
  - Live dependency checks against `/api/system/readiness` (testing database read/write, Discord connection, Challengermode sync freshness, and email configuration).
  - Live email delivery testing form (exercises the Google OAuth transport without enrolling participants).
  - Downloadable redacted diagnostic bundle (`/api/system/support-bundle`) for troubleshooting without exposing tokens, passwords, or player emails.
- **Privacy & data retention (`/privacy`)**: Summarises collected participant fields (emails, Discord IDs, team names) and explains that automated retention and privacy export are not yet available.
- **Liveness vs. readiness endpoints**:
  - `GET /api/health` answers `{"status":"ok"}` while the HTTP server is running (liveness probe).
  - `GET /api/system/readiness` verifies end-to-end integration dependencies (database, Discord API, Challengermode, and email).
- **Logs**: Real-time output is written to standard output (`docker-compose logs -f bot`) and displayed in the desktop application's live log pane with automatic secret redaction.
- For user-facing issues and resolution steps, consult [Troubleshooting](TROUBLESHOOTING.md).

## Security checklist for an event

- [ ] `WEB_PASSWORD` set, port exposed only to trusted networks or not at all.
- [ ] Discord bot token and Challengermode refresh key present only in `.env`/desktop config, never
      committed or pasted into tickets.
- [ ] TO role granted only to actual staff.
- [ ] Bot's highest role above every participant role it must assign.
- [ ] Email credentials configured and tested with one address.
- [ ] Backup taken the same day, and its restore path tested at least once.
- [ ] Check-in disabled for finished tournaments so stale records cannot be mutated.

---

[Back to main](../README.md)
