const { test } = require('node:test');
const assert = require('node:assert/strict');
// Select SQLite column decorators before loading the entities. Tests use in-memory databases only.
process.env.SQLITE_DB = ':memory:';
const { WebsiteWrapperChallengermode, extractTournamentId } = require('../dist/website/challengermode');
const { DataSource } = require('typeorm');
const { ChallengermodeIdentifiers1793100000000 } = require('../dist/database/migrations/ChallengermodeIdentifiers');
const { ChallongeTournament, EnrolledPlayer, MatchSchedule, Participant, Countdown } = require('../dist/database/orm');
const { addTournament, syncTournament } = require('../dist/util/tournament');
const { DatabaseWrapperPostgres } = require('../dist/database/postgres');

const { uuid, id, player, metadata, series, json, mockClient, withDatabase } = require('./helpers/fixtures.cjs');

test('extracts tournament UUIDs from canonical and space URLs, never from an unrelated host', () => {
  for (const value of [id, id.toUpperCase(), `https://www.challengermode.com/tournaments/${id}`, `challengermode.com/s/mlbb/tournaments/${id}/brackets?lang=en`]) {
    assert.equal(extractTournamentId(value), id);
  }
  for (const value of ['https://challonge.com/cup', `https://challengermode.com.evil.test/tournaments/${id}`, `https://evil.test/challengermode.com/tournaments/${id}`, `https://challengermode.com@evil.test/tournaments/${id}`, 'https://www.challengermode.com/s/mlbb', 'not-a-tournament']) {
    assert.throws(() => extractTournamentId(value), /Challengermode/);
  }
});

test('maps metadata, teams, capacity, and lifecycle without treating platform IDs as Discord IDs', async () => {
  const { client, tokenCount } = mockClient();
  const tournament = await client.getTournament(id);
  assert.equal(tournament.name, 'MLBB Cup');
  assert.equal(tournament.state, 'underway');
  assert.equal(tournament.format, 'single elimination');
  assert.equal(tournament.signupCap, 128);
  assert.deepEqual(tournament.players.map(p => p.challongeId), [uuid(2), uuid(3)]);
  assert.equal(tournament.players[0].discordId, 'DUMMY');
  await client.getMatches(id);
  assert.equal(tokenCount(), 1);
});

test('paginates all pre-start signups and switches to the confirmed roster after start', async () => {
  const teams = Array.from({ length: 103 }, (_, i) => player(i + 2));
  const { client, calls } = mockClient({ tournament: metadata({ attendance: { roster: null, signups: { lineupCount: 103 } } }), teams });
  assert.equal((await client.getPlayers(id)).length, 103);
  assert.deepEqual(calls.filter(c => c.body.query?.includes('BotSignups')).map(c => c.body.variables.skip), [0, 100]);
  const roster = mockClient({ tournament: metadata({ attendance: { roster: { lineupCount: 2 }, signups: { lineupCount: 103 } } }) });
  assert.equal((await roster.client.getPlayers(id)).length, 2);
  assert.equal(roster.calls.filter(c => c.body.query?.includes('BotSignups')).length, 0);
  assert.equal(roster.calls.find(c => c.body.query?.includes('BotRoster')).body.variables.limit, 2);
});

test('maps whole match series, zero-based rounds, unknown opponents, and filters', async () => {
  const fixtures = [series(), series({ id: uuid(11), state: 'WAITING', lineups: [null, { id: uuid(3) }] }), series({ id: uuid(12), state: 'WAITING' }), series({ id: uuid(13), state: 'COMPLETED' })];
  const { client } = mockClient({ fixtures });
  const matches = await client.getMatches(id);
  assert.equal(matches[0].matchId, uuid(10));
  assert.equal(matches[0].round, 1);
  assert.equal(matches[0].scheduledTime, '2026-11-02T12:00:00Z');
  assert.equal(matches[1].player1, null);
  assert.equal(matches[1].state, 'pending');
  assert.equal(matches[2].state, 'open');
  assert.equal(matches[3].state, 'complete');
  assert.equal((await client.getMatches(id, true, uuid(2))).length, 2);
  assert.equal((await client.getMatches(id, true, uuid(999))).length, 0);
});

test('shares concurrent token refreshes and refreshes once after HTTP 401', async () => {
  let failed = false;
  const { client, tokenCount } = mockClient({ graphql: (_body, options) => {
    if (!failed && options.headers.Authorization === 'Bearer access-1') { failed = true; return json({}, 401); }
  } });
  await Promise.all([client.getMatches(id), client.getMatches(id), client.getMatches(id)]);
  assert.equal(tokenCount(), 2);
});

test('renews tokens before expiry and bounds repeated HTTP 401 responses', async () => {
  const { client, tokenCount } = mockClient();
  await client.getMatches(id);
  const now = Date.now;
  Date.now = () => now() + 20 * 60_000;
  try { await client.getMatches(id); } finally { Date.now = now; }
  assert.equal(tokenCount(), 2);
  const denied = mockClient({ graphql: () => new Response(null, { status: 401 }) });
  await assert.rejects(denied.client.getMatches(id), /Could not read Challengermode/);
  assert.equal(denied.tokenCount(), 2);
});

test('rejects missing credentials, malformed responses, partial GraphQL errors, and unsupported fixtures', async () => {
  await assert.rejects(new WebsiteWrapperChallengermode('', () => { throw new Error('must not call network'); }).getMatches(id), /CHALLENGERMODE_REFRESH_KEY/);
  const invalid = new WebsiteWrapperChallengermode('secret-key', async () => new Response('not json', { status: 502 }));
  await assert.rejects(invalid.getMatches(id), /invalid response/);
  const partial = mockClient({ graphql: () => json({ data: { tournament: { matchSeries: [] } }, errors: [{ message: 'secret server detail' }] }) });
  await assert.rejects(partial.client.getMatches(id), e => /Could not read/.test(e.message) && !e.message.includes('secret server detail'));
  const unsupported = mockClient({ fixtures: [series({ lineupCount: 4 })] });
  await assert.rejects(unsupported.client.getMatches(id), /two teams/);
  const incomplete = mockClient({ tournament: metadata({ attendance: { roster: null, signups: { lineupCount: 3 } } }) });
  await assert.rejects(incomplete.client.getPlayers(id), /Incomplete/);
});

test('blocks unsupported remote writes without issuing requests', async () => {
  const { client, calls } = mockClient();
  await assert.rejects(client.submitScore(id, {}, uuid(2), 2, 0), /Manage registration, scores/);
  await assert.rejects(client.bulkAddParticipants(id, ['Team']), /Manage registration, scores/);
  assert.equal(calls.length, 0);
});

test('migrates existing integer IDs to strings without losing rows and can run twice', async () => {
  const db = await new DataSource({ type: 'sqljs' }).initialize();
  try {
    await db.query('CREATE TABLE enrolled_player (id integer PRIMARY KEY, challongeId integer NULL, email varchar NOT NULL)');
    await db.query('CREATE TABLE match_schedule (id integer PRIMARY KEY, matchId integer NOT NULL)');
    await db.query("INSERT INTO enrolled_player VALUES (1, 456, 'captain@example.test'), (2, NULL, 'reserve@example.test')");
    await db.query('INSERT INTO match_schedule VALUES (1, 789)');
    const migration = new ChallengermodeIdentifiers1793100000000();
    const runner = db.createQueryRunner();
    await migration.up(runner);
    await migration.up(runner);
    assert.deepEqual(await db.query('SELECT challongeId, email FROM enrolled_player ORDER BY id'), [{ challongeId: '456', email: 'captain@example.test' }, { challongeId: null, email: 'reserve@example.test' }]);
    assert.deepEqual(await db.query('SELECT matchId FROM match_schedule'), [{ matchId: '789' }]);
    await db.query('INSERT INTO match_schedule VALUES (?, ?)', [2, uuid(10)]);
    assert.equal((await db.query('SELECT matchId FROM match_schedule WHERE id = 2'))[0].matchId, uuid(10));
    await runner.release();
  } finally { await db.destroy(); }
});

test('sync preserves Discord verification and manual schedules, and is idempotent', async () => withDatabase(async () => {
  const added = await addTournament(`https://www.challengermode.com/s/mlbb/tournaments/${id}`, 'mlbb-cup', '123', '456');
  assert.equal(added.success, true);
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'mlbb-cup' });
  assert.equal(tournament.autoPushScores, false);
  const enrolled = await EnrolledPlayer.create({ tournamentId: 'mlbb-cup', email: 'captain@example.test', team: 'Team 2', discordId: '987654321098765432', verified: true }).save();
  const { client } = mockClient();
  const first = await syncTournament(tournament, client);
  assert.equal(first.success, true);
  assert.equal(first.matchedPlayers, 1);
  assert.equal(first.addedSchedules, 1);
  const playerAfter = await EnrolledPlayer.findOneByOrFail({ id: enrolled.id });
  assert.equal(playerAfter.challongeId, uuid(2));
  assert.equal(playerAfter.discordId, enrolled.discordId);
  assert.equal(playerAfter.verified, true);
  const schedule = await MatchSchedule.findOneByOrFail({ tournamentId: 'mlbb-cup' });
  assert.equal(schedule.matchId, uuid(10));
  assert.equal(schedule.scheduledTime.toISOString(), '2026-11-02T12:00:00.000Z');
  schedule.scheduledTime = new Date('2026-11-03T12:00:00Z');
  await schedule.save();
  const second = await syncTournament(tournament, client);
  assert.equal(second.success, true);
  assert.equal(second.matchedPlayers, 0);
  assert.equal(second.addedSchedules, 0);
  assert.equal(await MatchSchedule.count(), 1);
  assert.equal((await MatchSchedule.findOneByOrFail({ id: schedule.id })).scheduledTime.toISOString(), '2026-11-03T12:00:00.000Z');
  await new DatabaseWrapperPostgres().synchronise('mlbb-cup', { name: 'Cup', description: '', players: [{ challongeId: uuid(2), discordId: 'DUMMY' }] });
  assert.equal((await EnrolledPlayer.findOneByOrFail({ id: enrolled.id })).discordId, enrolled.discordId);
}));

test('a fixture read failure leaves enrolled identities and metadata unchanged', async () => withDatabase(async () => {
  await addTournament(id, 'cup', '123', '456');
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  const enrolled = await EnrolledPlayer.create({ tournamentId: 'cup', email: 'captain@example.test', team: 'Team 2' }).save();
  const result = await syncTournament(tournament, {
    getTournament: async () => ({ name: 'Changed', players: [{ name: 'Team 2', challongeId: uuid(2) }] }),
    getMatches: async () => { throw new Error('Fixtures unavailable'); }
  });
  assert.equal(result.success, false);
  assert.equal((await EnrolledPlayer.findOneByOrFail({ id: enrolled.id })).challongeId, null);
  assert.equal((await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' })).name, 'cup');
}));


test('ambiguous team names are not assigned to an arbitrary platform lineup', async () => withDatabase(async () => {
  await addTournament(id, 'cup', '123', '456');
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  const enrolled = await EnrolledPlayer.create({ tournamentId: 'cup', email: 'captain@example.test', team: 'Team 2' }).save();
  const { client } = mockClient({ teams: [player(2), { ...player(3), name: 'Team 2' }] });
  const result = await syncTournament(tournament, client);
  assert.equal(result.success, true);
  assert.equal(result.matchedPlayers, 0);
  assert.equal((await EnrolledPlayer.findOneByOrFail({ id: enrolled.id })).challongeId, null);
}));

test('source schedule fills a previously unscheduled fixture regardless of local timezone', async () => withDatabase(async () => {
  await addTournament(id, 'cup', '123', '456');
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  const unscheduled = mockClient({ fixtures: [series({ scheduledStartTimeAt: null })] });
  assert.equal((await syncTournament(tournament, unscheduled.client)).success, true);
  assert.equal((await MatchSchedule.findOneByOrFail({ tournamentId: 'cup' })).scheduledTime.toISOString(), '2099-12-31T23:59:59.000Z');
  const scheduled = mockClient();
  const result = await syncTournament(tournament, scheduled.client);
  assert.equal(result.success, true);
  assert.equal(result.updatedSchedules, 1);
  assert.equal((await MatchSchedule.findOneByOrFail({ tournamentId: 'cup' })).scheduledTime.toISOString(), '2026-11-02T12:00:00.000Z');
}));

test('migrates a complete existing SQLite schema before automatic synchronisation', async () => {
  const entities = [ChallongeTournament, EnrolledPlayer, MatchSchedule, Participant, Countdown];
  const oldDb = await new DataSource({ type: 'sqljs', entities, synchronize: true }).initialize();
  let database;
  try {
    const runner = oldDb.createQueryRunner();
    for (const [name, columnName] of [['enrolled_player', 'challongeId'], ['match_schedule', 'matchId']]) {
      const table = await runner.getTable(name);
      const column = table.findColumnByName(columnName);
      const replacement = column.clone(); replacement.type = 'integer'; replacement.length = '';
      await runner.changeColumn(name, column, replacement);
    }
    await addTournament(id, 'cup', '123', '456');
    await EnrolledPlayer.create({ tournamentId: 'cup', email: 'a@example.test', team: 'Legacy', challongeId: '123' }).save();
    await MatchSchedule.create({ tournamentId: 'cup', matchId: '456', scheduledTime: new Date('2026-11-01T12:00:00Z'), threadId: '987' }).save();
    database = oldDb.driver.export();
    await runner.release();
  } finally { await oldDb.destroy(); }
  const upgraded = await new DataSource({ type: 'sqljs', database, entities, migrations: [ChallengermodeIdentifiers1793100000000], migrationsRun: true, synchronize: true }).initialize();
  try {
    const enrolled = await EnrolledPlayer.findOneOrFail({ where: { tournamentId: 'cup' }, relations: ['tournament'] });
    assert.equal(enrolled.challongeId, '123');
    assert.equal(enrolled.tournament.tournamentId, 'cup');
    const schedule = await MatchSchedule.findOneByOrFail({ tournamentId: 'cup' });
    assert.equal(schedule.matchId, '456');
    assert.equal(schedule.threadId, '987');
    assert.equal((await upgraded.query('PRAGMA foreign_key_check')).length, 0);
  } finally { await upgraded.destroy(); }
});
