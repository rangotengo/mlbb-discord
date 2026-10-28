# Desktop setup and releases — implementation status

Owner: desktop thread. Scope: `electron/**`, `ui/**`, `electron-builder.yml`, `.github/workflows/build-windows.yml`, `.github/workflows/build-macos.yml`, `test/desktop-improvements.test.cjs`, and this status file.

Shared checkout. No branch switch, stash, commit, or worktree. Challengermode stays read-only. No credentials were read and no live account was used.

## Checklist

| Guide | Desktop work | State |
| --- | --- | --- |
| 5 | Loopback default (`WEB_BIND=127.0.0.1`). Network access is an explicit checkbox and the validator refuses it without a password. One-time `POST /login/desktop` runs in the main process with `MLBB_DESKTOP_BOOTSTRAP`; the token is not given to the renderer. Failure shows the login page and a recovery message. | Implemented against the live server contract. Not exercised against a running bot in this session. |
| 6 | `config.json` no longer stores the Discord token, Challengermode refresh key, dashboard password, or PostgreSQL URL. Electron 35 `safeStorage` is the store. If OS encryption is unavailable, `secrets.json` is written mode `0600` and the wizard warns. Writes are atomic. The wizard says which changes need a restart. Legacy files that still embed secrets are migrated on the next save. | Implemented and covered by `test/desktop-improvements.test.cjs`. |
| 7 | Before a version change, SQLite `dot.db`, secret-free `config.json`, and `secrets.json` are copied to `userData/backups/<timestamp>-vOLD-to-vNEW/` with `manifest.json`. PostgreSQL is not file-copied. Restore instructions are manual. A second OS instance is refused so two processes do not open the same SQLite file. | Backup copy and single-instance decision are tested. Opening a restored database was not demonstrated here. Server `POST /api/system/backup` is separate and SQLite-only. |
| 9 | Guided steps: Discord, server, Challengermode, email, storage, dashboard, checklist. Progress is saved without secrets. Each step uses `validateConfig`. Failures name a recovery action. | Implemented. An organiser walkthrough was not run in Electron. |
| 10 | Server, channel, and role checks stay "not checked" until the bot is connected. Desktop does not invent a permission pass. | Waiting on a desktop-consumable permissions summary. Backend has `GET /api/tournaments/:id/discord-readiness`, which needs a tournament id the desktop wizard does not have yet. |
| 24 | Support bundle lists version, platform, bind, database type, and local check states. It does not include tokens, passwords, or emails. Live readiness is called only with the dashboard session. HTTP 401 is a failure, not a pass. `ok: null` stays "not checked". | Bundle content is local. A live readiness response was not captured. |
| 25 | Single instance, macOS hide-on-close versus Quit, SIGTERM then SIGKILL after 5 seconds, version and release notes, pre-upgrade backup. Builder sets `identity: null`, `signAndEditExecutable: false`, and `publish: null`. Workflows do not receive signing secrets. | Lifecycle decisions are tested. No packaged install was produced or smoked on Windows or macOS. |
| 27 | `test/desktop-improvements.test.cjs` covers secret-free config, legacy migration, network password rule, non-pass checks, upgrade copy, second instance, shutdown escalation, and unsigned smoke status. Both release workflows run it before packaging. | 10 new tests passed together with the existing configuration tests (18 total in that run). |
| 33 | Preset storage was not added. The wizard already stores non-secret prefix, role names, database choice, and dashboard bind. Australian English is the UI language (`en-AU`). | No new preset format. A recurring-event preset would need a shared schema with the backend. |

## Contracts used

Confirmed with the backend owner and present in the current server code:

- `MLBB_DESKTOP_BOOTSTRAP`: 64 hex characters, consumed once by `POST /login/desktop` or `GET /login/desktop`.
- `WEB_BIND`: `127.0.0.1` or `0.0.0.0`.
- Secret-free `config.json`: `src/config/index.ts` keeps environment secrets when the file omits them.
- Authenticated `GET /api/system/readiness` and `POST /api/system/email/test`. POST also sends `X-CSRF-Token` from `GET /api/csrf` using the window session.
- `GET /api/health` remains the unauthenticated liveness check.

Discord permission inspection is not called. The desktop checklist does not mark it passed.

## Release blockers (honest)

- No Windows or macOS signing credentials are configured. Installers, when built, are unsigned. SmartScreen and Gatekeeper will warn. This status does not claim a signed or notarised build.
- No clean-machine install, upgrade, or path-with-spaces packaged launch was executed. The smoke helper only checks that expected build files exist.
- Pre-upgrade backup restore was not opened and queried. The manifest says restore is manual.
- Email test and readiness need a running bot and an authenticated session. They were not called against a live process.
- `package.json` still has a `build` block that does not repeat every new `electron-builder.yml` signing guard. The workflows invoke `electron-builder`, which reads `electron-builder.yml` when it is present; `package.json` is owned by the backend, so this file was not edited. Backend owner: please mirror `publish: null`, `forceCodeSigning: false`, Windows `signAndEditExecutable: false`, and macOS `identity: null` if the JSON build block can override the YAML.

## Files

- `electron/secrets.ts`, `electron/config.ts`, `electron/checks.ts`, `electron/backup.ts`, `electron/lifecycle.ts`, `electron/smoke.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/config-validator.ts`
- `ui/index.html`, `ui/renderer.ts`, `ui/renderer.js`, `ui/styles.css`
- `electron-builder.yml`
- `.github/workflows/build-windows.yml`, `.github/workflows/build-macos.yml`
- `test/desktop-improvements.test.cjs`

## Verification run

`npx tsc -p electron/tsconfig.json` and `npx tsc -p ui/tsconfig.json` succeeded.

`node --require ./test/helpers/setup.cjs --test test/desktop-improvements.test.cjs test/configuration.test.cjs` — 18 passed, 0 failed.

The full `npm test` suite was not run, to avoid racing the backend owner's build and database tests.
