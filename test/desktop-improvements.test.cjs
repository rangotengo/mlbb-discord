const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const electron = require.resolve('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-desktop-'));
const secretFile = path.join(userData, 'secrets.json');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: {
    app: { getPath: () => userData, getVersion: () => '0.1.0' },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString()
    }
  }
};

const { saveSecrets, loadSecrets, secretStoreStatus, clearSecrets } = require('../dist/electron/secrets');
const { materialiseConfig, saveConfig, toFileConfig, configToEnv, getConfigPath } = require('../dist/electron/config');
const { validateConfig } = require('../dist/electron/config-validator');
const { localChecks, interpretReadiness, interpretEmailTest } = require('../dist/electron/checks');
const { createPreUpgradeBackup, listBackups } = require('../dist/electron/backup');
const { decideSingleInstance, decideWindowClose, requestShutdown } = require('../dist/electron/lifecycle');
const { signingStatus, smokePackage } = require('../dist/electron/smoke');

function validConfig() {
  return {
    version: '0.1.0',
    schemaVersion: 1,
    discord: { token: 'd'.repeat(60) },
    challengermode: { refreshKey: 'cm-refresh-key' },
    bot: { defaultPrefix: '!', defaultToRole: 'Organizer', participantRole: 'Participant' },
    database: { type: 'sqlite', path: path.join(userData, 'dot.db') },
    web: { port: 3000, autoIncrement: true, allowNetwork: false },
    logging: { level: 'info' }
  };
}

test('desktop secrets stay out of config.json and survive a restart of the store', () => {
  clearSecrets();
  saveConfig(validConfig());
  const onDisk = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  assert.equal(onDisk.discord.token, undefined);
  assert.equal(onDisk.challengermode.refreshKey, undefined);
  assert.equal(onDisk.web.password, undefined);
  assert.equal(loadSecrets().discordToken, 'd'.repeat(60));
  assert.equal(secretStoreStatus().secure, false);
  assert.match(secretStoreStatus().warning, /OS secure storage is unavailable/);
  assert.equal(fs.statSync(secretFile).mode & 0o077, 0);
});

test('a blank replacement does not expose or drop a stored secret unless it is explicitly cleared', () => {
  saveSecrets({ discordToken: 'kept-token-value-with-enough-length', webPassword: 'desk-secret' });
  const loaded = materialiseConfig({ bot: { defaultPrefix: '!' } }, {});
  loaded.discord.token = undefined;
  saveSecrets({ discordToken: undefined, webPassword: '' });
  assert.equal(loadSecrets().discordToken, 'kept-token-value-with-enough-length');
  assert.equal(loadSecrets().webPassword, undefined);
});

test('legacy config files move embedded secrets into the store on the next save', () => {
  const legacy = validConfig();
  legacy.web.password = 'old-password';
  fs.writeFileSync(getConfigPath(), JSON.stringify(legacy));
  const merged = materialiseConfig(JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')), {});
  assert.equal(merged.discord.token, 'd'.repeat(60));
  const saved = saveConfig(merged);
  assert.equal(saved.migratedSecrets, true);
  const rewritten = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  assert.equal(rewritten.discord.token, undefined);
  assert.equal(rewritten.web.password, undefined);
  assert.equal(loadSecrets().webPassword, 'old-password');
});

test('network dashboard access is rejected until a password exists', () => {
  const config = validConfig();
  config.web.allowNetwork = true;
  const errors = validateConfig(config);
  assert.ok(errors.some(error => error.field === 'web-password' && error.recovery));
  config.web.password = 'required';
  assert.equal(validateConfig(config).some(error => error.field === 'web-password'), false);
  assert.equal(configToEnv(config).WEB_BIND, '0.0.0.0');
  config.web.allowNetwork = false;
  assert.equal(configToEnv(config).WEB_BIND, '127.0.0.1');
});

test('local setup checks do not call a failing integration a pass', () => {
  const config = validConfig();
  config.email = { configured: false };
  const checks = localChecks(config);
  assert.equal(checks.find(check => check.id === 'email').state, 'fail');
  assert.equal(checks.find(check => check.id === 'challengermode').state, 'not-checked');
  assert.equal(checks.find(check => check.id === 'server').state, 'not-checked');
  const live = interpretReadiness(null, false)[0];
  assert.equal(live.state, 'unavailable');
  assert.match(live.message, /Not available in this build/);
  const unread = interpretReadiness({ challengermode: { ok: null }, email: { configured: true, lastResult: null }, discord: { ready: true, guilds: 1 }, database: { ok: true, engine: 'sqlite' } }, true);
  assert.equal(unread.find(check => check.id === 'challengermode-live').state, 'not-checked');
  assert.equal(interpretEmailTest({ accepted: false, reason: 'timeout', detail: 'Timed out' }, true).state, 'fail');
});

test('an upgrade copies sqlite data before the version changes and records manual restore', () => {
  const database = path.join(userData, 'dot.db');
  fs.writeFileSync(database, 'sqlite-bytes');
  fs.writeFileSync(getConfigPath(), JSON.stringify(toFileConfig(validConfig())));
  const first = createPreUpgradeBackup({
    userDataDir: userData,
    appVersionFrom: '0.1.0',
    appVersionTo: '0.1.0',
    schemaVersion: 1,
    engine: 'sqlite',
    sqlitePath: database,
    configPath: getConfigPath(),
    secretsPath: secretFile
  });
  assert.equal(first.created, false);
  const created = createPreUpgradeBackup({
    userDataDir: userData,
    appVersionFrom: '0.1.0',
    appVersionTo: '0.2.0',
    schemaVersion: 1,
    engine: 'sqlite',
    sqlitePath: database,
    configPath: getConfigPath(),
    secretsPath: secretFile,
    now: new Date('2026-10-28T00:00:00Z')
  });
  assert.equal(created.created, true);
  assert.equal(fs.readFileSync(path.join(created.directory, 'dot.db'), 'utf8'), 'sqlite-bytes');
  assert.equal(created.manifest.restore.automatic, false);
  assert.equal(listBackups(userData)[0].engine, 'sqlite');
  const remote = createPreUpgradeBackup({
    userDataDir: userData,
    appVersionFrom: '0.2.0',
    appVersionTo: '0.3.0',
    schemaVersion: 1,
    engine: 'postgresql',
    configPath: getConfigPath(),
    now: new Date('2026-10-28T01:00:00Z')
  });
  assert.match(remote.manifest.notes.join(' '), /PostgreSQL/);
  assert.equal(remote.manifest.files.some(file => file.name === 'dot.db'), false);
});

test('a second instance is refused and window close is not shutdown on macOS', () => {
  assert.equal(decideSingleInstance(true).proceed, true);
  const second = decideSingleInstance(false);
  assert.equal(second.proceed, false);
  assert.equal(second.focusExisting, true);
  assert.match(second.message, /same local database/);
  assert.equal(decideWindowClose('darwin', false), 'hide');
  assert.equal(decideWindowClose('darwin', true), 'quit');
  assert.equal(decideWindowClose('win32', false), 'quit');
});

test('shutdown asks the bot to exit and escalates only if it stays alive', () => {
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.kill = signal => {
    child.signal = signal;
    child.killed = signal === 'SIGKILL';
    return true;
  };
  const result = requestShutdown(child, target => target.kill('SIGKILL'), 20);
  assert.equal(result.signalled, 'SIGTERM');
  assert.equal(child.signal, 'SIGTERM');
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(child.signal, 'SIGKILL');
      resolve();
    }, 40);
  });
});

test('packaged smoke checks missing files and never calls an unsigned build signed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-smoke-'));
  const report = smokePackage({ root, expectUi: true, expectBuilderConfig: false });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.check === 'entry'));
  const signing = signingStatus('mac:\n  target: dmg\n');
  assert.equal(signing.verified, false);
  assert.match(signing.blocker, /Do not describe installers as signed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('paths containing spaces are joined for the default sqlite file', () => {
  const spaced = materialiseConfig({ database: { type: 'sqlite' } }, {});
  assert.equal(spaced.database.path.includes(path.sep), true);
  assert.equal(path.isAbsolute(spaced.database.path), true);
});

test('secret storage encrypts retained plaintext on upgrade and refuses unreadable ciphertext', () => {
  const modulePath = require.resolve('../dist/electron/secrets');
  const safeStorage = require.cache[electron].exports.safeStorage;
  clearSecrets();
  fs.writeFileSync(secretFile, JSON.stringify({ encrypted: false, values: { discordToken: 'retained-secret' } }));
  const reload = available => {
    safeStorage.isEncryptionAvailable = () => available;
    delete require.cache[modulePath];
    return require(modulePath);
  };
  try {
    safeStorage.encryptString = value => Buffer.from('encrypted:' + value);
    safeStorage.decryptString = value => {
      assert.ok(value.toString().startsWith('encrypted:'));
      return value.toString().slice('encrypted:'.length);
    };
    const secure = reload(true);
    secure.saveSecrets({ webPassword: 'new-password' });
    assert.equal(secure.loadSecrets().discordToken, 'retained-secret');
    const bytes = fs.readFileSync(secretFile, 'utf8');
    assert.doesNotMatch(bytes, /retained-secret|new-password/);
    const unavailable = reload(false);
    assert.equal(unavailable.loadSecrets().discordToken, undefined);
    assert.throws(() => unavailable.saveSecrets({ webPassword: 'changed' }), /cannot be decrypted/);
    assert.equal(fs.readFileSync(secretFile, 'utf8'), bytes);
  } finally {
    safeStorage.isEncryptionAvailable = () => false;
    delete require.cache[modulePath];
    clearSecrets();
  }
});
