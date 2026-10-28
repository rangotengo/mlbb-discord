const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { withDatabase, id } = require('./helpers/fixtures.cjs');
const { addTournament } = require('../dist/util/tournament');
const { ChallongeTournament, EnrolledPlayer, VerificationChallenge } = require('../dist/database/orm');
const { IdentityLifecycle1793110000000 } = require('../dist/database/migrations/IdentityLifecycle');
const verification = require('../dist/role/helper/verification');
const otp = require('../dist/util/otp');
const email = require('../dist/role/helper/email');
const sqliteFile = require('../dist/database/sqliteFile');
const settings = require('../dist/config/settings');
const server = require('../dist/web/server');

process.env.MLBB_DISABLE_EMAIL_FILE = '1';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-otp-secret';
process.env.OTP_EXPIRY_MS = '600000';
process.env.OTP_RESEND_COOLDOWN_MS = '0';
process.env.OTP_MAX_ATTEMPTS = '2';
process.env.OTP_MAX_SENDS = '3';

async function seed(guild = 'guild') {
  await addTournament(id, 'cup', guild, 'host');
  await addTournament(id, 'closed', guild, 'host');
  await ChallongeTournament.update({ tournamentId: 'closed' }, { checkInDisabled: true });
  await EnrolledPlayer.create({ tournamentId: 'cup', email: 'player@example.com', name: 'Player', team: 'Alpha', discordUsername: 'sharedname' }).save();
  await EnrolledPlayer.create({ tournamentId: 'closed', email: 'player@example.com', name: 'Player', team: 'Alpha', discordUsername: 'sharedname' }).save();
}

test('name matches are suggestions and cannot claim another verified Discord account', async () => withDatabase(async () => {
  await seed();
  const first = await verification.matchCheckIn('discord-a', 'guild', ['sharedname']);
  assert.equal(first.kind, 'suggested');
  assert.equal(first.players.length, 2);
  const player = await EnrolledPlayer.findOneByOrFail({ tournamentId: 'cup' });
  player.identityVerified = true;
  player.verified = true;
  player.discordId = 'discord-a';
  await player.save();
  const owner = await verification.matchCheckIn('discord-a', 'guild', ['someone-else']);
  assert.equal(owner.kind, 'returning');
  const impostor = await verification.matchCheckIn('discord-b', 'guild', ['sharedname']);
  assert.equal(impostor.kind, 'suggested');
  assert.equal(impostor.players.some(candidate => candidate.tournamentId === 'cup'), false);
}));

test('OTP lifecycle rejects malformed, expired, replayed, and exhausted codes', async () => withDatabase(async () => {
  assert.equal(otp.normaliseOtpInput('123456extra'), null);
  assert.equal(otp.normaliseOtpInput('12345'), null);
  const issued = await verification.issueChallenge({ discordId: 'discord-a', guildId: 'guild', email: 'player@example.com' });
  assert.equal(issued.ok, true);
  const stored = await VerificationChallenge.findOneByOrFail({ discordId: 'discord-a' });
  assert.notEqual(stored.digest, issued.code);
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: '123456extra' })).error, 'malformed');
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: '000000' })).error, 'mismatch');
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: '000000' })).error, 'attempts-exhausted');
  await VerificationChallenge.update({ id: stored.id }, { attempts: 0, expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: issued.code })).error, 'expired');
  await VerificationChallenge.update({ id: stored.id }, { expiresAt: new Date(Date.now() + 60_000), attempts: 0 });
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: issued.code })).ok, true);
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: issued.code })).error, 'not-found');
}));

test('resend invalidates the previous code without permanently spending a failed delivery', async () => withDatabase(async () => {
  const first = await verification.issueChallenge({ discordId: 'discord-a', guildId: 'guild', email: 'player@example.com' });
  const second = await verification.issueChallenge({ discordId: 'discord-a', guildId: 'guild', email: 'player@example.com' });
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: first.code })).error, 'mismatch');
  await VerificationChallenge.update({ discordId: 'discord-a' }, { attempts: 0 });
  assert.equal((await verification.verifyChallenge({ discordId: 'discord-a', guildId: 'guild', code: second.code })).ok, true);
  const before = (await VerificationChallenge.findOneByOrFail({ discordId: 'discord-a' })).sends;
  await verification.recordDeliveryAttempt({ discordId: 'discord-a', guildId: 'guild', email: 'player@example.com', accepted: false });
  assert.equal((await VerificationChallenge.findOneByOrFail({ discordId: 'discord-a' })).sends, before);
}));

test('closed tournaments stay closed while an open tournament can be verified', async () => withDatabase(async () => {
  await seed();
  const players = await EnrolledPlayer.find();
  const classified = await verification.classifyEnrolments(players, 'guild');
  assert.deepEqual(classified.map(item => [item.player.tournamentId, item.eligible]).sort(), [['closed', false], ['cup', true]]);
  const open = classified.find(item => item.eligible).player;
  await verification.markIdentityVerified(open, 'email');
  const saved = await EnrolledPlayer.findOneByOrFail({ tournamentId: 'cup' });
  assert.equal(saved.identityVerified, true);
  assert.equal(saved.accessPending, true);
  await verification.markAccessGranted(saved);
  assert.equal((await EnrolledPlayer.findOneByOrFail({ tournamentId: 'cup' })).accessPending, false);
  assert.equal((await EnrolledPlayer.findOneByOrFail({ tournamentId: 'closed' })).identityVerified, false);
}));

test('email delivery reports failure instead of pretending a code was sent', async () => {
  const saved = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].map(key => [key, process.env[key]]);
  for (const [key] of saved) delete process.env[key];
  try {
  const missing = await email.sendOtpEmail('player@example.com', '123456');
  assert.equal(missing.accepted, false);
  assert.equal(missing.reason, 'missing-credentials');
  assert.doesNotMatch(JSON.stringify(missing), /client|secret|refresh|token/i);
  const invalid = await email.sendOtpEmail('not-an-email', '123456');
  assert.equal(invalid.reason, 'invalid-address');
  } finally {
    for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('identity migration backfills verified rows and is safe on a fresh database', async () => {
  const queries = [];
  const columns = new Set();
  const migration = new IdentityLifecycle1793110000000();
  await migration.up({
    connection: { options: { type: 'postgres' } },
    getTable: async name => name === 'enrolled_player' ? { findColumnByName: column => columns.has(column) } : null,
    query: async sql => { queries.push(sql); columns.add((/"(\w+)"/.exec(sql) || [])[1]); }
  });
  assert.ok(queries.some(sql => sql.includes('ADD COLUMN "identityVerified"')));
  assert.ok(queries.some(sql => sql.includes('SET "identityVerified" = "verified"')));
  const before = queries.length;
  await migration.up({ connection: { options: { type: 'postgres' } }, getTable: async () => null, query: async () => { throw new Error('fresh database should not be altered'); } });
  assert.equal(queries.length, before);
});

test('SQLite backups round-trip and reject a truncated backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-backup-'));
  const dbPath = path.join(root, 'dot.db');
  const backups = path.join(root, 'backups');
  fs.writeFileSync(dbPath, Buffer.from('populated-database'));
  const manifest = sqliteFile.createSqliteBackup(dbPath, backups);
  assert.equal(manifest.engine, 'sqlite');
  assert.equal(manifest.schemaVersion, '1793120000000');
  fs.writeFileSync(dbPath, Buffer.from('changed'));
  sqliteFile.restoreSqliteBackup(manifest, dbPath);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'populated-database');
  manifest.sizeBytes += 1;
  assert.throws(() => sqliteFile.restoreSqliteBackup(manifest, dbPath), /size does not match/);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'populated-database');
  fs.rmSync(root, { recursive: true, force: true });
});

test('configuration rejects unknown keys and preserves secrets', () => {
  const current = { WEB_PASSWORD: 'kept', DISCORD_TOKEN: 'secret' };
  assert.match(settings.validateSettings({ UNKNOWN: 'x' }, current), /Unknown setting/);
  assert.match(settings.validateSettings({ WEB_PORT: '70000' }, current), /65535/);
  assert.match(settings.validateSettings({ WEB_BIND: '0.0.0.0' }, {}), /password is required/);
  assert.equal(settings.validateSettings({ WEB_BIND: '0.0.0.0', WEB_PASSWORD: '' }, current), null);
  assert.equal(settings.validateSettings({ DOT_DEFAULT_PREFIX: '!' }, current), null);
});

test('dashboard requests fail without authentication and local redirects cannot leave the app', async () => {
  assert.equal(server.safeRedirectPath('https://evil.example'), '/tournaments');
  assert.equal(server.safeRedirectPath('//evil.example'), '/tournaments');
  assert.equal(server.safeRedirectPath('/players?team=Alpha'), '/players?team=Alpha');
  server.setDesktopBootstrapToken('a'.repeat(64));
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-session', resave: false, saveUninitialized: false }));
  app.get('/api/private', (req, res) => req.session.authenticated ? res.json({ success: true }) : res.status(401).json({ success: false }));
  app.post('/login/desktop', (req, res) => {
    if (req.body.token !== 'a'.repeat(64)) return res.status(401).json({ success: false });
    req.session.authenticated = true;
    res.json({ success: true });
  });
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/private`)).status, 401);
    const login = await fetch(`${base}/login/desktop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'b'.repeat(64) }) });
    assert.equal(login.status, 401);
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});
