// Tests must never load local credentials, use the production database, or send webhooks.
const path = require('node:path');
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(__dirname, 'no-local-env'), MLBB_CONFIG_PATH: '',
  DISCORD_TOKEN: 'test-discord-token', WEB_PORT: '3000', WEB_PASSWORD: '', DOT_DEFAULT_PREFIX: '!', DOT_DEFAULT_TO_ROLE: 'TO',
  DOT_LOGGER_WEBHOOK: '', CHALLENGERMODE_REFRESH_KEY: '', SQLITE_DB: ':memory:', POSTGRESQL_URL: '',
  GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret', GOOGLE_REFRESH_TOKEN: 'test-google-refresh'
});

const localFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    return Promise.reject(new Error('External network calls are disabled in the test suite.'));
  }
  return localFetch(input, options);
};
