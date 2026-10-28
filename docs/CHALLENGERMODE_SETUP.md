# Challengermode setup and migration

The bot now reads tournament data from Challengermode's official Client API. A Challonge API key cannot authenticate to Challengermode.

## Get application credentials

1. Sign in to [Challengermode's developer dashboard](https://www.challengermode.com/developers/applications) and create an application.
2. In the application's **Credentials** tab, generate a long-lived **refresh key**. Save it locally when shown.
3. For the command-line/server version, set `CHALLENGERMODE_REFRESH_KEY` in your local `.env`, using `.env.example` as a template. For the desktop app, enter the key in **Challengermode Configuration → Application Refresh Key**, or set `challengermode.refreshKey` in your JSON configuration.
4. Restart the app after changing credentials. The bot exchanges the refresh key for a short-lived access token and renews it automatically.
5. Create or choose your MLBB tournament on Challengermode and copy its tournament URL. The bot does not create a tournament on the platform.

The app can run without the key from `.env` so other setup can proceed. Tournament reads return a setup message until a key is configured. The desktop setup form requires the key before starting.

Official references: [server authentication](https://www.challengermode.com/developers/docs/auth-api/server-authentication), [Client API](https://www.challengermode.com/developers/docs/client-api/using-the-api), and [GraphQL schema](https://publicapi.challengermode.com/graphql?sdl).

## Connect a tournament

In Discord, as a Tournament Organiser:

```text
!add https://www.challengermode.com/s/your-space/tournaments/<uuid> mlbb-cup
!enroll mlbb-cup
!sync mlbb-cup
!matches mlbb-cup download
```

Attach your enrollment CSV to `!enroll`. Use `name`, `email`, and `team` columns and make team names match the Challengermode lineup names. Existing email verification and Discord role assignment continue to use those locally enrolled players. The public API does not provide their email addresses or Discord IDs.

You can also use **Add Tournament** and **Sync from Challengermode** in the dashboard. Full tournament URLs, URLs under a Space, and raw tournament UUIDs are accepted by the shared service. The dashboard URL field expects a full URL.

Sync imports the name, description, lifecycle status, format, capacity, lineup IDs, fixtures, round numbers, and available scheduled start times. Before a tournament has a confirmed roster, all signup pages are read; afterwards, the confirmed roster is used. Existing manually assigned schedule times are retained. UUID match identifiers in schedule CSVs refer to **match series** (the whole best-of fixture), rather than an individual game.

Supported formats are single elimination, double elimination, round robin, and Swiss with two opposing lineups per fixture. Multi-format (`OTHER`) tournaments and fixtures with more than two lineups are rejected explicitly. Round numbers are displayed from 1, with stage offsets and negative numbers for lower-bracket fixtures labelled by the API.

## Scores, registration, and remote settings

This integration reads data. Register teams, submit/correct scores, and start or finish tournaments on Challengermode, then sync the bot. `!score`, `!forcescore`, and `!enroll ... register` return instructions without submitting remote changes. CSV imports enroll players locally. `!update` and `/update` edit local display details; the next sync refreshes those details from Challengermode.

## Existing installations

Back up your database before deploying. On startup, the included migration converts existing numeric `enrolled_player.challongeId` and `match_schedule.matchId` columns to text while preserving existing values. It runs before schema synchronisation for SQLite and PostgreSQL. PostgreSQL production installations still require their existing base schema; this migration only changes identifier types. Downgrading requires restoring a pre-migration backup because UUID values cannot fit integer columns.

The ORM entity/table names and `challongeId`/`challongeTournamentId` property names are retained for stored-data compatibility; new values are Challengermode UUIDs. Old Challonge tournament slugs cannot identify Challengermode events. Add the corresponding Challengermode tournament under a new local name and import/enroll its players, then sync. Existing tournament records are not silently reassigned to another event.

Replace `CHALLONGE_USERNAME`/`CHALLONGE_TOKEN` and JSON `challonge` credentials with the new refresh-key setting. Legacy desktop configuration loads with an empty refresh-key field so you can enter the new credential.

## Verification

Run `npm run test:challengermode` for API-client and in-memory SQLite migration/sync checks, and `npm run electron:build` for desktop compilation. The GraphQL queries were validated against the official schema on 2026-10-27. Live authenticated tournament reads still require your application refresh key and a tournament URL; no live credentials were available during this migration.
