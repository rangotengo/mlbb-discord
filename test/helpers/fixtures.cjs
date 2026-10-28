const assert = require('node:assert/strict');
const { WebsiteWrapperChallengermode } = require('../../dist/website/challengermode');
const { DataSource } = require('typeorm');
const { ChallongeTournament, EnrolledPlayer, MatchSchedule, Participant, Countdown } = require('../../dist/database/orm');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const id = uuid(1);
const player = n => ({ id: uuid(n), name: `Team ${n}`, disqualified: false, seed: n, placement: null });
const metadata = (overrides = {}) => ({
  id, name: 'MLBB Cup', description: 'Cup description', state: 'RUNNING',
  links: { overviewUrl: `https://www.challengermode.com/tournaments/${id}` },
  settings: { tournamentSettings: { format: 'SINGLE_ELIMINATION', maxLineupCount: 128 } },
  attendance: { roster: null, signups: { lineupCount: 2 } }, ...overrides
});
const series = (overrides = {}) => ({
  id: uuid(10), state: 'RUNNING', lineupCount: 2, lineups: [{ id: uuid(2) }, { id: uuid(3) }], labels: [],
  scheduledStartTimeAt: '2026-11-02T12:00:00Z', context: { tournamentContext: { stageNumber: 0, roundNumber: 0 } }, ...overrides
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function mockClient({ tournament = metadata(), teams = [player(2), player(3)], fixtures = [series()], graphql } = {}) {
  const calls = [];
  let tokens = 0;
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    if (url.endsWith('/auth/access_keys')) {
      tokens++;
      assert.deepEqual(body, { refreshKey: 'local-refresh-key' });
      return json({ value: `access-${tokens}`, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() });
    }
    assert.equal(url, 'https://publicapi.challengermode.com/graphql');
    assert.match(options.headers.Authorization, /^Bearer access-/);
    assert.equal(body.variables.id, id);
    if (graphql) {
      const response = await graphql(body, options);
      if (response) return response;
    }
    if (body.query.includes('query BotTournament')) return json({ data: { tournament } });
    if (body.query.includes('query BotSignups')) {
      const { skip, limit } = body.variables;
      return json({ data: { tournament: { attendance: { signups: { lineups: teams.slice(skip, skip + limit) } } } } });
    }
    if (body.query.includes('query BotRoster')) {
      return json({ data: { tournament: { attendance: { roster: { lineups: teams.slice(0, body.variables.limit) } } } } });
    }
    if (body.query.includes('query BotMatches')) return json({ data: { tournament: { matchSeries: fixtures } } });
    throw new Error('Unexpected GraphQL operation');
  };
  return { client: new WebsiteWrapperChallengermode('local-refresh-key', fetch), calls, tokenCount: () => tokens };
}

async function withDatabase(run) {
  const { VerificationChallenge } = require('../../dist/database/orm');
  const db = await new DataSource({ type: 'sqljs', entities: [ChallongeTournament, EnrolledPlayer, MatchSchedule, Participant, Countdown, VerificationChallenge], synchronize: true }).initialize();
  try { return await run(db); } finally { await db.destroy(); }
}

module.exports = { uuid, id, player, metadata, series, json, mockClient, withDatabase };
