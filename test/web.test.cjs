const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { withDatabase, id, uuid } = require('./helpers/fixtures.cjs');
const { addTournament } = require('../dist/util/tournament');
const { MatchSchedule, EnrolledPlayer } = require('../dist/database/orm');
const { parseCSV } = require('../dist/util/csv');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-web-test-'));
process.env.DOTENV_CONFIG_PATH = path.join(temp, '.env');
const config = require('../dist/web/routes/config').default;
const participants = require('../dist/web/routes/participants').default;
const schedules = require('../dist/web/routes/schedules').default;

async function withServer(run) {
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: true }));
  app.use(participants); app.use(schedules); app.use(config);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { return await run((route, body, method = 'POST') => fetch(url + route, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' })); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('participant CSV import handles teamName before player name and multiline names', async () => withDatabase(async () => withServer(async request => {
  await addTournament(id, 'cup', 'guild', 'host');
  const route = '/api/tournaments/cup/participants/import';
  const csv = 'teamName,name,email\r\n"Team ""A"", One","Player\nOne",CAPTAIN@EXAMPLE.COM';
  const response = await request(route, { csv });
  assert.equal(response.status, 200);
  const saved = await EnrolledPlayer.findOneByOrFail({ tournamentId: 'cup' });
  assert.equal(saved.team, 'Team "A", One');
  assert.equal(saved.name, 'Player\nOne');
  assert.equal(saved.email, 'captain@example.com');
  await request(route, { csv });
  assert.equal(await EnrolledPlayer.count(), 1);
  const blocked = await request(route, { csv, registerToChallonge: true });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /Register teams on Challengermode/);
})));

test('schedule endpoints preserve UUIDs, validate inputs, and export UTC without sentinel dates', async () => withDatabase(async () => withServer(async request => {
  await addTournament(id, 'cup', 'guild', 'host');
  const route = '/api/tournaments/cup/schedules';
  assert.equal((await request(route, { matchId: '123', scheduledTime: '2026-11-01 12:00' })).status, 400);
  assert.equal((await request(route, { matchId: uuid(10), scheduledTime: 'invalid' })).status, 400);
  const created = await request(route, { matchId: uuid(10).toUpperCase(), scheduledTime: '2026-11-01 12:00', timezone: '+05:45' });
  assert.equal(created.status, 200);
  const saved = await MatchSchedule.findOneByOrFail({ tournamentId: 'cup' });
  assert.equal(saved.matchId, uuid(10));
  assert.equal(saved.scheduledTime.toISOString(), '2026-11-01T06:15:00.000Z');
  assert.equal((await request(route, { matchId: uuid(10), scheduledTime: '2026-11-01 12:00' })).status, 400);
  await MatchSchedule.create({ tournamentId: 'cup', matchId: uuid(11), scheduledTime: new Date('2099-12-31T23:59:59Z') }).save();
  const download = await request(route + '/download');
  const rows = parseCSV(await download.text());
  assert.deepEqual(rows[1].slice(0, 3), [uuid(10), '2026-11-01 06:15:00', 'UTC']);
  assert.equal(rows[2][1], '');
  const template = parseCSV(await (await request(route + '/download-blank')).text());
  assert.match(template[1][0], /^[a-f0-9-]{36}$/);
})));

test('config endpoint edits only the isolated env file and never replaces the Discord token', async () => withServer(async request => {
  fs.writeFileSync(process.env.DOTENV_CONFIG_PATH, 'DISCORD_TOKEN=keep\nCHALLENGERMODE_REFRESH_KEY=old\n');
  const response = await request('/config', { DISCORD_TOKEN: '', CHALLENGERMODE_REFRESH_KEY: 'key#with-hash' });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /botRestart=true/);
  const parsed = require('dotenv').parse(fs.readFileSync(process.env.DOTENV_CONFIG_PATH));
  assert.equal(parsed.DISCORD_TOKEN, 'keep');
  assert.equal(parsed.CHALLENGERMODE_REFRESH_KEY, 'key#with-hash');
  const rejected = await request('/config', { CHALLENGERMODE_REFRESH_KEY: 'bad\nDISCORD_TOKEN=bad' });
  assert.match(rejected.headers.get('location'), /error=/);
  assert.equal(require('dotenv').parse(fs.readFileSync(process.env.DOTENV_CONFIG_PATH)).DISCORD_TOKEN, 'keep');
}));

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('all-or-nothing participant import rolls back earlier rows after a database failure', async () => withDatabase(async db => withServer(async request => {
  await addTournament(id, 'cup', 'guild', 'host');
  await db.query(`CREATE TRIGGER reject_import BEFORE INSERT ON enrolled_player WHEN NEW.email = 'fail@example.com' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  const csv = 'name,email,team\nFirst,first@example.com,Alpha\nFail,fail@example.com,Beta';
  const result = await request('/api/tournaments/cup/participants/import', { csv, mode: 'all-or-nothing' });
  assert.equal(result.status, 500);
  assert.equal(await EnrolledPlayer.count(), 0);
})));

test('importing a Discord ID never proves ownership of an unverified enrolment', async () => withDatabase(async () => withServer(async request => {
  await addTournament(id, 'cup', 'guild', 'host');
  const result = await request('/api/tournaments/cup/participants/import', { csv: 'name,email,team,discord id\nPlayer,player@example.com,Alpha,123456789012345678' });
  assert.equal(result.status, 200);
  const player = await EnrolledPlayer.findOneByOrFail({ tournamentId: 'cup' });
  assert.equal(player.verified, false);
  assert.equal(player.identityVerified, false);
})));
