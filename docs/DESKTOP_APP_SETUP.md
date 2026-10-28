# Desktop app setup guide

[Back to main](../README.md) · [Operations](OPERATIONS.md) · [Command reference](commands.md)

The desktop application runs the bot and its dashboard on your own machine, without requiring Node.js
or Docker to be pre-installed. These instructions describe what the app does today.

## Installation and release state

### Windows

1. Download `MLBB Tournament Bot Setup.exe` from the build output (`dist/installers/`).
2. Run the installer.
3. Choose the installation directory (default: `%LOCALAPPDATA%\Programs\mlbb-tournament-bot`).
4. Click "Finish" to launch the application.

### macOS

1. Download `MLBB Tournament Bot-X.X.X.dmg` from `dist/installers/`.
2. Open the disk image.
3. Drag "MLBB Tournament Bot" into Applications.
4. Launch from Applications.

### Signing, notarisation, and auto-update status

- **Installers are unsigned**: Code-signing credentials and Apple notarisation are not configured
  (`identity: null`, `signAndEditExecutable: false` in `electron-builder.yml`).
- On Windows, **SmartScreen** will prompt; on macOS, **Gatekeeper** will require right-clicking the app
  and choosing Open, or approving it in System Settings → Privacy & Security.
- **No auto-update**: Updates are installed by downloading and running the new installer over the old version.
  Configuration and data in the user profile are preserved across upgrades.

## Guided setup wizard

When opened, the app provides a 7-step guided setup wizard:

### Step 1: Discord connection

- **Bot token**: Paste the token from the [Discord developer portal](https://discord.com/developers/applications).
- Enable **Server Members** and **Message Content** intents under the Bot tab before inviting the bot.
- **Secret protection**: The token is encrypted using your operating system's secure credential store
  (see [Secret storage](#secret-storage-and-security) below) and is **never** written to `config.json`.
  Leaving the field blank on later visits preserves the stored token.

### Step 2: Server selection

- **Command prefix**: Default `!`.
- **Organiser role name**: The Discord role treated as Tournament Organisers.
  - **The desktop form defaults to `Organizer`**.
  - **README default is `DOT-TO`**; `.env.example` default is `TO`.
  - The bot creates whatever role name you configure here when joining a server; whichever spelling
    you choose, ensure the same name is assigned to staff in Discord.
- **Participant role name**: Default `Participant`. Fallback role name assigned to verified players.
- Note: Channel and role hierarchy checks run after the bot is online; a saved token is not proof of server access.

### Step 3: Challengermode access

- **Application refresh key**: Generated in the [Challengermode developer dashboard](https://www.challengermode.com/developers/applications)
  under your application's **Credentials** tab.
- The bot integration is **strictly read-only**: scores and player registrations stay on Challengermode.
- Stored securely in OS safe storage; leaving blank retains the existing key.

### Step 4: Email setup

- Configures verification code delivery via Google OAuth:
  - **Google Client ID**
  - **Google Client Secret**
  - **Google Refresh Token**
  - **Token URI** (default: `https://oauth2.googleapis.com/token`)
- **Save email credentials**: Encrypts and saves credentials to the OS store.
- **Send test email**: Sends a test message to an entered recipient once the bot is running.
  - Live email tests require an authenticated dashboard session and CSRF token (`X-CSRF-Token`); an HTTP 401
    indicates the dashboard session is not established.
  - An empty or failed test indicates email verification will not work for participants.

### Step 5: Storage

- **Database selection**:
  - **SQLite on this computer** (default): Stored in the application's user-data directory (`dot.db`).
    Only one app instance can access the SQLite file at a time.
  - **PostgreSQL server**: Provide a `postgresql://user:password@host:5432/dbname` connection string.
- **Back up now**: Creates an immediate backup of the SQLite database, secret-free `config.json`,
  and `secrets.json` into `userData/backups/<timestamp>-manual/` with a `manifest.json`.
- *Note*: PostgreSQL databases are **not** copied by the desktop app backup tool; use database server tools (`pg_dump`).

### Step 6: Dashboard access

- **Port**: Default `3000`.
- **Auto-increment**: Checked by default; finds the next free port (3001, 3002, …) if 3000 is occupied.
- **Allow other devices on the network**:
  - When unchecked: Binds to loopback (`WEB_BIND=127.0.0.1`).
  - When checked: Binds to all interfaces (`WEB_BIND=0.0.0.0`).
  - **Access password**: Mandatory if network access is enabled. There is no password-free loopback bypass.
- **Local session exchange**: Clicking "Web Interface" in the desktop app performs a one-time
  `POST /login/desktop` using a per-launch bootstrap token (`MLBB_DESKTOP_BOOTSTRAP`) from the main process.
  The token is never displayed in the renderer or written to disk.

### Step 7: Checklist

- Summarises the configuration state before starting.
- Independent checks show `pass`, `fail`, `not-checked`, or `unavailable`.
- Items requiring a running bot (Discord server permissions, Challengermode connectivity, email delivery)
  remain "not checked" or "not available" until the bot is online and live evidence is obtained.
- Click **Save and start bot** to validate settings, save public configuration, and launch the bot process.

## Secret storage and security

- **Secrets never go to `config.json`**: `config.json` contains only non-sensitive settings (prefix,
  role names, port, database type and file path).
- **Electron safeStorage (Electron 35)**:
  - **macOS**: Encrypted via macOS Keychain.
  - **Windows**: Encrypted via DPAPI (Data Protection API).
  - **Linux**: Encrypted via Secret Service / libsecret.
- **Fallback warning**: If OS secure storage is unavailable, secrets are stored in `secrets.json`
  inside the user-data folder with permissions `0600` (user read/write only). The wizard displays a
  clear warning that the machine login is the sole protection.
- Sensitive values (tokens, passwords, refresh keys) in stdout/stderr logs are automatically redacted
  before being emitted to the UI log pane.

## Application lifecycle and single instance

- **Single instance lock**: Only one OS process of the desktop app can run at once. Launching a
  second copy automatically focuses the existing window and exits without corrupting data or locking SQLite.
- **Window closing**:
  - On **macOS**: Closing the window hides it rather than killing the bot. Quitting from the dock or
    menu (`Cmd+Q`) gracefully shuts down the bot.
  - On **Windows/Linux**: Closing the window prompts and initiates bot shutdown.
- **Graceful shutdown**: The desktop app sends `SIGTERM` to the child bot process, allowing up to 5
  seconds for connections and SQLite locks to close cleanly, before escalating to `SIGKILL`.

## Backups, upgrades, and restore

### Pre-upgrade backups

- Before applying an application upgrade (detected when `installed-version.json` differs from `app.getVersion()`),
  the app automatically creates a backup folder:
  `userData/backups/<timestamp>-vOLD-to-vNEW/`
- The backup directory contains:
  - `dot.db` (for SQLite deployments)
  - `config.json` (sanitised, secret-free)
  - `secrets.json` (encrypted or protected credentials)
  - `manifest.json` (metadata, schema version, timestamp, engine type, restore instructions)

### Manual backups

- Clicking **Back up now** on the Storage setup step creates a manual snapshot in the same format.
- Server-side SQLite backup endpoints exist (`/api/system/backup`), but the desktop button performs
  local filesystem snapshots directly.

### Restoration procedure

- Restoration is currently a **manual procedure**; automatic restore is not claimed as tested:
  1. Fully quit the desktop app (ensure the process is stopped).
  2. Locate the desired backup folder in your user-data directory:
     - Windows: `%APPDATA%\mlbb-tournament-bot\backups\<timestamp>\`
     - macOS: `~/Library/Application Support/mlbb-tournament-bot/backups/<timestamp>/`
     - Linux: `~/.config/mlbb-tournament-bot/backups/<timestamp>/`
  3. Copy `dot.db`, `config.json`, and `secrets.json` back to the parent `userData` directory, replacing existing files.
  4. Relaunch the desktop application.
- For PostgreSQL deployments, database restore must be performed using PostgreSQL native tools (`pg_restore`).

## Troubleshooting

### Bot won't start

- Check the checklist for failed validation items (token format, required fields).
- Ensure port 3000 (or the auto-increment range) is not blocked by firewall rules.
- View real-time logs in the log pane for Discord login or database connection errors.

### "OS secure storage is unavailable" warning

- Common on Linux desktop environments without an active secret service (e.g. `gnome-keyring` or `ksecretservice`).
- Credentials will be stored in `secrets.json` with file permissions `0600`. Protect your operating system user account.

### "Rejected desktop bootstrap attempt" or Dashboard 401

- The desktop bootstrap token is single-use per start.
- If you reload or open multiple tabs, use your configured **Access Password** at `/login`.
- If the bot restarted, click "Web Interface" again in the desktop app to generate a fresh bootstrap session.

### Email test reports error

- Email delivery requires Google OAuth client ID, client secret, and refresh token.
- Ensure the bot is running and you have clicked **Save email credentials** first.
- The test request needs an active dashboard session and CSRF token (`X-CSRF-Token`); open the Web Interface once if testing directly.

---

[Back to main](../README.md)

---

[Back to main](../README.md)
