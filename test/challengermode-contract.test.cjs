const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSchema, parse, validate } = require('graphql');
const { WebsiteWrapperChallengermode, ChallengermodeAPIError, getTournamentApi } = require('../dist/website/challengermode');
const { uuid, id, player, metadata, series, json, mockClient } = require('./helpers/fixtures.cjs');

test('every generated operation validates against the published API schema snapshot', async () => {
  const schema = buildSchema(fs.readFileSync(path.join(__dirname, 'fixtures/challengermode-schema.graphql'), 'utf8'));
  const operations = new Set();
  const graphql = body => {
    const document = parse(body.query);
    assert.deepEqual(validate(schema, document).map(e => e.message), []);
    operations.add(document.definitions[0].name.value);
  };
  const signups = mockClient({ graphql });
  await signups.client.getTournament(id);
  await signups.client.getMatches(id);
  const roster = mockClient({ tournament: metadata({ attendance: { roster: { lineupCount: 2 }, signups: { lineupCount: 2 } } }), graphql });
  await roster.client.getPlayers(id);
  assert.deepEqual([...operations].sort(), ['BotMatches', 'BotRoster', 'BotSignups', 'BotTournament']);
});

for (const [remote, local] of Object.entries({ UNLISTED: 'pending', OPEN: 'pending', STARTING: 'pending', RUNNING: 'underway', COMPLETED: 'complete', CANCELLED: 'complete' })) {
  test(`maps tournament lifecycle ${remote}`, async () => {
    const { client } = mockClient({ tournament: metadata({ state: remote, attendance: { roster: null, signups: { lineupCount: 0 } } }) });
    assert.equal((await client.getTournament(id)).state, local);
  });
}
for (const [remote, local] of Object.entries({ SINGLE_ELIMINATION: 'single elimination', DOUBLE_ELIMINATION: 'double elimination', ROUND_ROBIN: 'round robin', SWISS: 'swiss' })) {
  test(`maps tournament format ${remote}`, async () => {
    const { client } = mockClient({ tournament: metadata({ settings: { tournamentSettings: { format: remote, maxLineupCount: 64 } } }) });
    assert.equal((await client.getTournament(id)).format, local);
  });
}
for (const [name, value] of [
  ['missing tournament', null], ['wrong ID', metadata({ id: uuid(999) })], ['missing attendance', metadata({ attendance: null })],
  ['missing settings', metadata({ settings: null })], ['invalid description', metadata({ description: {} })],
  ['invalid capacity', metadata({ settings: { tournamentSettings: { format: 'SWISS', maxLineupCount: -2 } } })],
  ['unknown state', metadata({ state: '__proto__' })], ['unknown format', metadata({ settings: { tournamentSettings: { format: 'constructor', maxLineupCount: 2 } } })]
]) test(`rejects ${name} metadata with a user-facing API error`, async () => {
  await assert.rejects(mockClient({ tournament: value }).client.getTournament(id), ChallengermodeAPIError);
});

for (const [name, value] of [
  ['null fixture', null], ['negative stage', series({ context: { tournamentContext: { stageNumber: -1, roundNumber: 0 } } })],
  ['missing context', series({ context: null })], ['missing opponents', series({ lineups: [null, null] })],
  ['self pairing', series({ lineups: [{ id: uuid(2) }, { id: uuid(2) }] })], ['bad ID', series({ id: 'bad' })],
  ['bad date', series({ scheduledStartTimeAt: 'not a date' })], ['bad labels', series({ labels: null })],
  ['unknown state', series({ state: '__proto__' })], ['invalid lineup', series({ lineups: [false, null] })]
]) test(`rejects ${name} in fixture data`, async () => {
  await assert.rejects(mockClient({ fixtures: [value] }).client.getMatches(id), ChallengermodeAPIError);
});

test('rejects duplicate fixtures and duplicate team IDs across signup pages', async () => {
  await assert.rejects(mockClient({ fixtures: [series(), series()] }).client.getMatches(id), /Duplicate/);
  await assert.rejects(mockClient({ teams: [player(2), player(2)] }).client.getPlayers(id), /duplicate/);
});

test('maps later stages and lower bracket rounds, and resolves uppercase player IDs', async () => {
  const { client } = mockClient({ fixtures: [series({ labels: ['DOUBLE_ELIMINATION_LOWER_BRACKET'] }), series({ id: uuid(11), context: { tournamentContext: { stageNumber: 1, roundNumber: 0 } } })] });
  assert.deepEqual((await client.getMatches(id)).map(m => m.round), [-1, 2]);
  assert.equal((await client.getPlayer(id, uuid(2).toUpperCase())).name, 'Team 2');
  await assert.rejects(client.getPlayer(id, uuid(999)), /Team not found/);
});

test('retries authentication after an earlier refresh failure and redacts response details', async () => {
  let attempts = 0;
  const client = new WebsiteWrapperChallengermode('private-refresh-key', async url => {
    if (url.endsWith('access_keys')) {
      attempts++;
      return attempts === 1 ? json({ detail: 'private-refresh-key' }, 403) : json({ value: 'access', expiresAt: new Date(Date.now() + 1200000).toISOString() });
    }
    return json({ data: { tournament: { matchSeries: [] } } });
  });
  await assert.rejects(client.getMatches(id), e => e instanceof ChallengermodeAPIError && !e.message.includes('private-refresh-key'));
  assert.deepEqual(await client.getMatches(id), []);
  assert.equal(attempts, 2);
});

test('handles network failures, rate limits, arrays, and malformed GraphQL errors', async () => {
  await assert.rejects(new WebsiteWrapperChallengermode('key', async () => { throw new Error('secret'); }).getMatches(id), /Could not connect/);
  await assert.rejects(mockClient({ graphql: () => json({}, 429) }).client.getMatches(id), /rate limit/);
  await assert.rejects(mockClient({ graphql: () => json([]) }).client.getMatches(id), /invalid response/);
  await assert.rejects(mockClient({ graphql: () => json({ data: {}, errors: {} }) }).client.getMatches(id), /Could not read/);
});

test('shares clients for the same key and replaces them after credential rotation', () => {
  const first = getTournamentApi('first');
  assert.equal(getTournamentApi('first'), first);
  assert.notEqual(getTournamentApi('second'), first);
});

test('URL parsing rejects malformed URLs and normalizes alphabetic UUIDs', () => {
  const { extractTournamentId } = require('../dist/website/challengermode');
  assert.throws(() => extractTournamentId('https://['), /Challengermode/);
  const upper = 'ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF';
  assert.equal(extractTournamentId(`https://www.challengermode.com/tournaments/${upper}`), upper.toLowerCase());
});
