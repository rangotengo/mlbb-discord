const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveTeamMembers } = require('../dist/util/teams');
const { assignParticipantRole, getParticipantRoleName } = require('../dist/util/roles');
const { isTournamentHost } = require('../dist/util/discord');
const logger = { warn() {}, error() {}, info() {} };

test('team membership prefers lineup UUIDs and normalizes fallback display names', () => {
  const linked = { name: 'One', team: 'Old name', challongeId: 'lineup-a' };
  const fallback = { name: 'Two', team: ' TEAM A ' };
  const other = { name: 'Three', team: 'Team A', challongeId: 'different-lineup' };
  assert.deepEqual(resolveTeamMembers([linked, fallback, other], { name: 'Team A', challongeId: 'lineup-a' }), [linked, fallback]);
  assert.deepEqual(resolveTeamMembers([fallback], null), []);
});

test('host access depends on the organiser role or tournament-specific admin role', () => {
  const member = roles => ({ roles: { cache: roles.map(name => ({ name })) } });
  assert.equal(isTournamentHost(member(['TO']), 'cup'), true);
  assert.equal(isTournamentHost(member(['cup-admin']), 'cup'), true);
  assert.equal(isTournamentHost(member(['other-admin']), 'cup'), false);
  assert.equal(isTournamentHost(null, 'cup'), false);
});

test('participant roles use configured roles or a scoped provider and report permission failures', async () => {
  const tournament = { tournamentId: 'cup' };
  assert.equal(getParticipantRoleName(tournament), 'cup-player');
  const added = [];
  const member = { id: 'user', user: { tag: 'Player' }, guild: { id: 'guild', roles: { cache: [{ id: 'role', name: 'Competitor' }] } }, roles: { add: async role => added.push(role.id) } };
  assert.equal(await assignParticipantRole(member, { ...tournament, participantRoleName: 'Competitor' }, logger), true);
  assert.deepEqual(added, ['role']);
  assert.equal(await assignParticipantRole(member, { ...tournament, participantRoleName: 'Missing' }, logger), false);
  const granted = [];
  assert.equal(await assignParticipantRole(member, tournament, logger, { grant: async (...args) => granted.push(args) }), true);
  assert.deepEqual(granted, [['user', { id: 'cup', server: 'guild' }]]);
  assert.equal(await assignParticipantRole(member, tournament, logger, { grant: async () => { throw new Error('Missing permission'); } }), false);
});
