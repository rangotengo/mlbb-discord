# Testing and checks

[Back to main](../README.md) · [Operations](OPERATIONS.md)

Use Node.js 24 or newer, then run:

```sh
npm ci
npm test
npm run lint
npm run cover
```

`npm test` compiles the backend, Electron code, and desktop renderer, then runs every `test/*.test.cjs` file with Node's test runner. `npm run test:challengermode` runs only the client, contract, and original migration/sync suite.

`npm run cover` runs the suite in `Asia/Kathmandu` time, prints V8 line/branch/function coverage, and writes `coverage/lcov.info`. Coverage describes exercised modules; it is not a claim of complete coverage of every Discord interaction or browser workflow.

## What the suite covers

- Challengermode authentication, token renewal, pagination, malformed responses, lifecycle/format mapping, UUIDs, and read-only write guards.
- Every generated GraphQL operation against a checked-in public API schema snapshot.
- SQLite schema upgrades, tournament identity collisions, transaction rollback, concurrent syncs, and preservation of verified users/manual schedules.
- CSV imports/exports, UTC round trips, quoted/multiline fields, date validation, timezone offsets and DST transitions.
- Configuration validation, storage selection, env-file updates, and preservation of desktop settings.
- Command feedback, role checks, team identity resolution, private match-thread access, and timer persistence/cancellation.
- Dashboard import, scheduling, export, and configuration routes through a real local HTTP server.
- Documentation: `docs/commands.test.cjs` checks that every command documented in [commands.md](commands.md) exists in `src/commands/` and `src/slash/` (and that no undocumented command ships), and `docs/links.test.cjs` checks that every local link and relative reference in `README.md` and `docs/` resolves to a real file.

Tests use in-memory databases, temporary configuration files, and Discord/API doubles. The preload helper blocks external network calls and prevents local `.env` credentials from being loaded. No Discord login, API key, or local database is needed.

## Continuous integration

The `Code checks` workflow runs `npm test` and `npm run lint` on Linux, Windows, and macOS with `TZ=Asia/Kathmandu`, plus the plain-Node documentation checks above (no build required, so they also run standalone with `node docs/commands.test.cjs` and `node docs/links.test.cjs`).

## What the suite does not prove

Be explicit about the boundary when quoting test results:

- No live Discord account is exercised: real gateway behaviour, actual role hierarchy, and mobile clients are untested.
- No authenticated Challengermode request is made; GraphQL operations are validated against a schema snapshot only.
- The PostgreSQL migration SQL is unit-tested, but a migration against a real populated PostgreSQL database is not part of CI.
- Local compilation does not produce signed Windows/macOS installers; installed-app behaviour (upgrade paths, OS keychain secret storage, single-instance locking) needs manual verification on target platforms.
- Dashboard route tests cover HTTP semantics, not browser interaction: keyboard navigation, screen readers, and touch behaviour are not automated.

For ambiguous or nonexistent local times at DST transitions, schedule imports now require an explicit UTC offset. Exported schedule timestamps are always UTC.

## Writing new tests

- Add `test/<area>.test.cjs` following the existing files; use the doubles in `test/helpers/` rather than real services.
- Keep new user journeys covered end-to-end where practical (verification recovery, schedule change, restart recovery), not just unit-level, per the improvement guide's testing direction.
- Update `docs/commands.md` when a command changes — CI fails otherwise.
