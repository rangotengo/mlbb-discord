const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { updateEnvContent } = require('../dist/config/envFile');
const { getConfig } = require('../dist/config');
// Only configuration persistence needs Electron's app object; no desktop runtime is launched.
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => os.tmpdir() } } };
const { configToEnv } = require('../dist/electron/config');
const { validateConfig } = require('../dist/electron/config-validator');
const valid = () => ({ version: '1', discord: { token: 'x'.repeat(60) }, challengermode: { refreshKey: 'refresh' }, bot: { defaultPrefix: '!', defaultToRole: 'TO' }, database: { type: 'sqlite', path: './data/test.db' }, web: { port: 3000, autoIncrement: true }, logging: { level: 'info' } });

test('desktop credentials and database selection map correctly into process variables', () => {
  const config = valid();
  assert.equal(configToEnv(config).CHALLENGERMODE_REFRESH_KEY, 'refresh');
  assert.equal(configToEnv(config).SQLITE_DB, './data/test.db');
  config.database = { type: 'postgresql', url: 'postgresql://localhost/test' };
  const env = configToEnv(config);
  assert.equal(env.SQLITE_DB, '');
  assert.equal(env.POSTGRESQL_URL, 'postgresql://localhost/test');
});

test('desktop configuration rejects missing credentials, invalid storage, and invalid ports', () => {
  assert.deepEqual(validateConfig(valid()), []);
  assert.ok(validateConfig({}).length >= 5);
  for (const change of [{ challengermode: { refreshKey: ' ' } }, { discord: { token: 'short' } }, { database: { type: 'postgresql' } }, { web: { port: 65536 } }, { web: { port: 1.5 } }, { bot: { defaultPrefix: 'x'.repeat(11), defaultToRole: '' } }]) assert.ok(validateConfig({ ...valid(), ...change }).length > 0);
});

test('JSON runtime configuration honours PostgreSQL selection without enabling SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-config-'));
  try {
    const config = valid(); config.database = { type: 'postgresql', url: 'postgresql://localhost/test' };
    const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify(config));
    const result = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require('./dist/config').getConfig()))`], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, MLBB_CONFIG_PATH: file }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sqliteDb, '');
    assert.equal(output.postgresqlUrl, 'postgresql://localhost/test');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('env editing preserves secrets, comments, hashes, quotes, and literal backslashes', () => {
  const original = '# keep this\nDISCORD_TOKEN=keep\nDOT_DEFAULT_PREFIX=!\n';
  for (const value of ['abc#def', 'has space', `a'b"c`, 'literal\\nvalue', '']) {
    const result = updateEnvContent(original, { CHALLENGERMODE_REFRESH_KEY: value, DISCORD_TOKEN: '' });
    assert.equal(dotenv.parse(result).CHALLENGERMODE_REFRESH_KEY, value);
    assert.equal(dotenv.parse(result).DISCORD_TOKEN, 'keep');
    assert.match(result, /# keep this/);
  }
  assert.equal(dotenv.parse(updateEnvContent('KEY=old\nKEY=stale', { KEY: 'new' })).KEY, 'new');
});

test('env editing rejects injected assignments and structured values', () => {
  for (const update of [{ KEY: 'value\nDISCORD_TOKEN=bad' }, { KEY: { secret: true } }, { 'BAD\nKEY': 'value' }, { key: 'bad' }]) assert.throws(() => updateEnvContent('', update), /Environment settings/);
});

test('runtime configuration rejects malformed ports and empty required variables', t => {
  const original = process.env.WEB_PORT;
  try {
    for (const value of ['3000x', '-1', '0', '65536', '1.5']) { process.env.WEB_PORT = value; assert.throws(getConfig, /WEB_PORT/); }
    process.env.WEB_PORT = '3000';
    const token = process.env.DISCORD_TOKEN;
    try { process.env.DISCORD_TOKEN = ''; assert.throws(getConfig, /DISCORD_TOKEN/); } finally { process.env.DISCORD_TOKEN = token; }
  } finally { if (original === undefined) delete process.env.WEB_PORT; else process.env.WEB_PORT = original; }
});

test('saving desktop settings preserves loaded PostgreSQL and advanced configuration', () => {
  const vm = require('node:vm');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: 'Stopped', disabled: false, querySelector: () => ({ textContent: '', disabled: false }), classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const submitted = [];
  const sandbox = { document: { getElementById: element, addEventListener() {}, querySelectorAll: () => [] }, localStorage: { setItem() {} }, window: { electronAPI: { startBot: config => submitted.push(config) } }, console, navigator: { clipboard: { writeText() {} } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, alert: message => { throw new Error(message); } };
  const code = fs.readFileSync(path.join(__dirname, '../ui/renderer.js'), 'utf8').replace(/export\s*\{\s*\};?/, '');
  vm.runInNewContext(code, sandbox);
  const config = valid(); config.challengermode.refreshKey = 'x'.repeat(40);
  config.database = { type: 'postgresql', url: 'postgresql://localhost/test' };
  config.bot.participantRole = 'Competitor'; config.web.port = 3456; config.logging.level = 'debug';
  sandbox.populateConfigForm(config);
  sandbox.handleConfigSubmit({ preventDefault() {} });
  const saved = JSON.parse(JSON.stringify(submitted[0]));
  assert.deepEqual(saved.database, config.database);
  assert.equal(saved.bot.participantRole, 'Competitor');
  assert.equal(saved.web.port, 3456);
  assert.equal(saved.logging.level, 'debug');
});


test('malformed JSON configuration returns validation errors instead of throwing', () => {
  for (const config of [null, undefined, false, { ...valid(), discord: { token: 42 } }, { ...valid(), challengermode: { refreshKey: {} } }, { ...valid(), database: { type: 'postgresql', url: 42 } }, { ...valid(), bot: { defaultPrefix: 42, defaultToRole: [] } }]) {
    assert.ok(validateConfig(config).length > 0);
  }
});
