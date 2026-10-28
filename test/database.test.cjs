const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withDatabase, id, uuid, mockClient } = require('./helpers/fixtures.cjs');
const { addTournament, resolveTournamentId, syncTournament } = require('../dist/util/tournament');
const { ChallongeTournament, EnrolledPlayer, MatchSchedule } = require('../dist/database/orm');
const { DatabaseWrapperPostgres } = require('../dist/database/postgres');
const { ChallengermodeIdentifiers1793100000000 } = require('../dist/database/migrations/ChallengermodeIdentifiers');
const { TournamentStatus } = require('../dist/database/interface');

test('tournament creation refuses a global name collision without changing another server', async () => withDatabase(async () => {
  assert.equal((await addTournament(id, 'cup', 'first-server', 'first-host')).success, true);
  assert.equal((await addTournament(id, 'cup', 'second-server', 'second-host')).success, false);
  const saved = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  assert.equal(saved.owningDiscordServer, 'first-server');
  assert.deepEqual(saved.hosts, ['first-host']);
}));

test('simultaneous registration cannot overwrite the winning tournament', async () => withDatabase(async () => {
  const results = await Promise.all([addTournament(id, 'cup', 'one', 'host'), addTournament(id, 'cup', 'two', 'host')]);
  assert.equal(results.filter(r => r.success).length, 1);
  assert.equal(await ChallongeTournament.count(), 1);
}));

test('validates tournament input and resolves absent, single, and multiple IDs by server', async () => withDatabase(async () => {
  for (const name of ['', ' ', 'x'.repeat(51)]) assert.equal((await addTournament(id, name, 'guild', 'host')).success, false);
  assert.equal((await addTournament('https://challonge.com/old', 'cup', 'guild', 'host')).success, false);
  await assert.rejects(resolveTournamentId(undefined, null), /required/);
  await assert.rejects(resolveTournamentId(undefined, 'guild'), /No tournaments/);
  await addTournament(id, ' cup ', 'guild', 'host');
  assert.equal(await resolveTournamentId(undefined, 'guild'), 'cup');
  await addTournament(id, 'second', 'guild', 'host');
  await assert.rejects(resolveTournamentId(undefined, 'guild'), /Multiple tournaments/);
  assert.equal(await resolveTournamentId('explicit', 'guild'), 'explicit');
}));

test('host authentication enforces server, role permission, and lifecycle checks', async () => withDatabase(async () => {
  await addTournament(id, 'cup', 'guild', 'host');
  const db = new DatabaseWrapperPostgres();
  assert.equal((await db.authenticateHost('cup', 'host', 'guild', undefined, true)).id, 'cup');
  await assert.rejects(db.authenticateHost('cup', 'host', 'other', undefined, true), /Unknown tournament/);
  await assert.rejects(db.authenticateHost('cup', 'stranger', 'guild', undefined, false), /not authorised/);
  await assert.rejects(db.authenticateHost('cup', 'host', 'guild', TournamentStatus.IPR, true), /must be/);
  await assert.rejects(db.getTournament('missing'), /Unknown tournament/);
  await db.addHost('cup', 'second');
  await assert.rejects(db.addHost('cup', 'second'), /already includes/);
  await db.removeHost('cup', 'second');
  await assert.rejects(db.removeHost('cup', 'host'), /too few hosts/);
  await db.updateTournament('cup', 'New name', 'Details');
  await db.startTournament('cup');
  await assert.rejects(db.updateTournament('cup', 'Late', 'Details'), /must be/);
  assert.equal((await db.getActiveTournaments('guild')).length, 1);
  assert.equal((await db.getActiveTournaments('other')).length, 0);
  await db.finishTournament('cup');
  assert.equal((await db.getActiveTournaments('guild')).length, 0);
}));

test('only verified players linked to this tournament are confirmed', async () => withDatabase(async () => {
  await addTournament(id, 'cup', 'guild', 'host');
  const db = new DatabaseWrapperPostgres();
  const enrolled = await EnrolledPlayer.create({ tournamentId: 'cup', email: 'a@test.com', team: 'Team', discordId: 'user', challongeId: uuid(2) }).save();
  await assert.rejects(db.getConfirmedPlayer('user', 'cup'), /not a player/);
  enrolled.verified = true; await enrolled.save();
  assert.deepEqual(await db.getConfirmedPlayer('user', 'cup'), { challongeId: uuid(2) });
  await assert.rejects(db.getConfirmedPlayer('user', 'other'), /not a player/);
}));

test('a failure late in sync rolls back player links, schedules, and metadata', async () => withDatabase(async db => {
  await addTournament(id, 'cup', 'guild', 'host');
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  const enrolled = await EnrolledPlayer.create({ tournamentId: 'cup', email: 'a@test.com', team: 'Team 2' }).save();
  await db.query(`CREATE TRIGGER fail_sync BEFORE UPDATE OF name ON challonge_tournament BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END`);
  const result = await syncTournament(tournament, mockClient().client);
  assert.equal(result.success, false);
  assert.match(result.error, /simulated database failure/);
  assert.equal((await EnrolledPlayer.findOneByOrFail({ id: enrolled.id })).challongeId, null);
  assert.equal(await MatchSchedule.count(), 0);
  assert.equal((await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' })).name, 'cup');
}));

test('concurrent syncs create a single schedule without nested SQLite transactions', async () => withDatabase(async () => {
  await addTournament(id, 'cup', 'guild', 'host');
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  const { client } = mockClient();
  const results = await Promise.all([syncTournament(tournament, client), syncTournament(tournament, client)]);
  assert.ok(results.every(r => r.success), JSON.stringify(results));
  assert.equal(results.reduce((n, r) => n + r.addedSchedules, 0), 1);
  assert.equal(await MatchSchedule.count(), 1);
}));

test('PostgreSQL identifier migration uses casts instead of dropping columns', async () => {
  const queries = [];
  const migration = new ChallengermodeIdentifiers1793100000000();
  await migration.up({ connection: { options: { type: 'postgres' } }, getTable: async () => ({ findColumnByName: () => ({ type: 'integer' }) }), query: async sql => queries.push(sql) });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(q => /TYPE varchar\(64\) USING ".*"::text$/.test(q) && !q.includes('DROP')));
  await assert.rejects(migration.down(), /Restore a pre-migration backup/);
});
