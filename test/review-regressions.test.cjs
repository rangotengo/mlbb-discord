const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { withDatabase, id } = require('./helpers/fixtures.cjs');
const orm = require('../dist/database/orm');
const { addTournament } = require('../dist/util/tournament');
const verification = require('../dist/role/helper/verification');
const { CompleteSchema1793120000000 } = require('../dist/database/migrations/CompleteSchema');
const { IdentityLifecycle1793110000000 } = require('../dist/database/migrations/IdentityLifecycle');
const { ChallengermodeIdentifiers1793100000000 } = require('../dist/database/migrations/ChallengermodeIdentifiers');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-review-'));
process.env.DOTENV_CONFIG_PATH = path.join(root, '.env');
process.env.OTP_RESEND_COOLDOWN_MS = '0';
process.env.OTP_HMAC_SECRET = 'isolated-review-test-secret';
const { createWebApp, setDesktopBootstrapToken } = require('../dist/web/server');

test('real dashboard protects API and accepts only authenticated CSRF form submissions', async () => {
  fs.writeFileSync(process.env.DOTENV_CONFIG_PATH, 'DOT_DEFAULT_PREFIX=!\n');
  setDesktopBootstrapToken('review-test-bootstrap');
  const listener = createWebApp().listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/config')).status, 401);
    const login = await fetch(base + '/login/desktop', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token: 'review-test-bootstrap' }), redirect: 'manual' });
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/login/desktop', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token: 'review-test-bootstrap' }), redirect: 'manual' })).status, 401);
    const csrf = (await (await fetch(base + '/api/csrf', { headers: { Cookie: cookie } })).json()).data.token;
    const save = token => fetch(base + '/config', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: token, DOT_DEFAULT_PREFIX: '?' }), redirect: 'manual' });
    assert.equal((await save('wrong')).status, 403);
    const saved = await save(csrf);
    assert.equal(saved.status, 302);
    assert.match(saved.headers.get('location'), /success=true/);
    assert.equal(require('dotenv').parse(fs.readFileSync(process.env.DOTENV_CONFIG_PATH)).DOT_DEFAULT_PREFIX, '?');
    assert.doesNotMatch(fs.readFileSync(process.env.DOTENV_CONFIG_PATH, 'utf8'), /_csrf/);
    const restore = await fetch(base + '/api/system/restore', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(restore.status, 409);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});

test('production migrations create an empty schema and restore a missing challenge table without synchronize', async () => {
  const entities = [orm.ChallongeTournament, orm.EnrolledPlayer, orm.MatchSchedule, orm.Participant, orm.Countdown, orm.VerificationChallenge];
  const db = await new DataSource({ type: 'sqljs', entities, synchronize: false, migrations: [ChallengermodeIdentifiers1793100000000, IdentityLifecycle1793110000000, CompleteSchema1793120000000], migrationsRun: true }).initialize();
  try {
    await addTournament(id, 'cup', 'guild', 'host');
    await orm.EnrolledPlayer.create({ tournamentId: 'cup', email: 'player@example.com', team: 'Alpha' }).save();
    const runner = db.createQueryRunner();
    await runner.dropTable('verification_challenge');
    await new CompleteSchema1793120000000().up(runner);
    assert.equal(await orm.EnrolledPlayer.count(), 1);
    const challenge = await verification.issueChallenge({ discordId: 'user', guildId: 'guild', email: 'player@example.com' });
    assert.equal(challenge.ok, true);
    assert.equal(await orm.VerificationChallenge.count(), 1);
  } finally { await db.destroy(); }
});

test('a code proves only its email and never verifies other pending enrolments', async () => withDatabase(async () => {
  await addTournament(id, 'cup', 'guild', 'host');
  for (const email of ['owner@example.com', 'victim@example.com']) {
    await orm.EnrolledPlayer.create({ tournamentId: 'cup', email, team: 'Alpha', discordId: 'requester' }).save();
  }
  const issued = await verification.issueChallenge({ discordId: 'requester', guildId: 'guild', email: 'owner@example.com' });
  const command = require('../dist/commands/verify').default;
  const messages = [];
  await command.executor({ author: { id: 'requester', username: 'requester' }, guildId: 'guild', member: null, guild: null, channel: { name: 'ticket-requester', isTextBased: () => true }, reply: async message => messages.push(message) }, [issued.code], {});
  assert.equal((await orm.EnrolledPlayer.findOneByOrFail({ email: 'owner@example.com' })).identityVerified, true);
  assert.equal((await orm.EnrolledPlayer.findOneByOrFail({ email: 'victim@example.com' })).identityVerified, false);
}));

test('failed delivery does not consume successful-send allowance', async () => withDatabase(async () => {
  const subject = { discordId: 'requester', guildId: 'guild', email: 'owner@example.com' };
  for (let i = 0; i < 5; i++) {
    assert.equal((await verification.issueChallenge(subject)).ok, true);
    await verification.recordDeliveryAttempt({ ...subject, accepted: false });
  }
  assert.equal((await orm.VerificationChallenge.findOneByOrFail(subject)).sends, 0);
  await verification.recordDeliveryAttempt({ ...subject, accepted: true });
  assert.equal((await orm.VerificationChallenge.findOneByOrFail(subject)).sends, 1);
}));

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
