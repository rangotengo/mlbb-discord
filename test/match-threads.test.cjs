const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ThreadChannel } = require('discord.js');
const { addUserToMatchThreads } = require('../dist/util/matchThreads');
const { addTournament } = require('../dist/util/tournament');
const { ChallongeTournament, EnrolledPlayer, MatchSchedule } = require('../dist/database/orm');
const { withDatabase, id, uuid, mockClient } = require('./helpers/fixtures.cjs');

async function setup() {
  await addTournament(id, 'cup', 'guild', 'host');
  const tournament = await ChallongeTournament.findOneByOrFail({ tournamentId: 'cup' });
  tournament.activeRound = 1; await tournament.save();
  const player = await EnrolledPlayer.create({ tournamentId: 'cup', email: 'a@example.test', name: 'Player', team: 'Team 2', challongeId: uuid(2), verified: true, discordId: 'user' }).save();
  await MatchSchedule.create({ tournamentId: 'cup', matchId: uuid(10), scheduledTime: new Date('2026-11-01T12:00:00Z'), roundNumber: 1, threadId: 'thread' }).save();
  const added = [], sent = [], cache = new Set();
  const thread = Object.create(ThreadChannel.prototype);
  Object.defineProperties(thread, {
    name: { value: 'Team match' },
    members: { value: { cache, async fetch() {}, async add(user) { added.push(user); cache.add(user); } } },
    send: { writable: true, value: async message => sent.push(message) }
  });
  const guild = { id: 'guild', members: { fetch: async () => ({ id: 'user' }) }, channels: { fetch: async () => thread } };
  return { tournament, player, guild, thread, added, sent };
}

test('verified players are added only to their active-round match thread and notified once', async () => withDatabase(async () => {
  const { player, guild, added, sent } = await setup();
  const { client } = mockClient();
  assert.equal(await addUserToMatchThreads(guild, player, client), 1);
  assert.deepEqual(added, ['user']); assert.match(sent[0], /<@user>/);
  assert.equal(await addUserToMatchThreads(guild, player, client), 0);
  assert.equal(sent.length, 1);
}));

test('unverified players, inactive rounds, and other guilds never gain access', async () => withDatabase(async () => {
  const { tournament, player, guild } = await setup();
  const api = { getMatches: async () => { throw new Error('Must not fetch fixtures'); } };
  player.verified = false;
  assert.equal(await addUserToMatchThreads(guild, player, api), 0);
  player.verified = true;
  assert.equal(await addUserToMatchThreads({ ...guild, id: 'other' }, player, api), 0);
  tournament.activeRound = null; await tournament.save();
  assert.equal(await addUserToMatchThreads(guild, player, api), 0);
}));

test('missing threads are skipped and successful membership survives a notification failure', async () => withDatabase(async () => {
  const { player, guild, thread, added } = await setup();
  const { client } = mockClient();
  assert.equal(await addUserToMatchThreads({ ...guild, channels: { fetch: async () => null } }, player, client), 0);
  thread.send = async () => { throw new Error('Cannot send notification'); };
  assert.equal(await addUserToMatchThreads(guild, player, client), 1);
  assert.deepEqual(added, ['user']);
}));

test('team-name fallback normalizes casing and refuses ambiguous matches', async () => withDatabase(async () => {
  const { player, guild } = await setup();
  player.challongeId = undefined; player.team = ' TEAM 2 ';
  const { client } = mockClient();
  assert.equal(await addUserToMatchThreads(guild, player, client), 1);
  const ambiguous = { getMatches: (...args) => client.getMatches(...args), getPlayers: async () => [{ name: 'Team 2', challongeId: uuid(2) }, { name: 'TEAM 2', challongeId: uuid(3) }] };
  assert.equal(await addUserToMatchThreads(guild, player, ambiguous), 0);
}));
