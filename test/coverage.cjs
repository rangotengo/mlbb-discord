const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
fs.mkdirSync(path.join(__dirname, '..', 'coverage'), { recursive: true });
const result = spawnSync(process.execPath, [
  '--require', './test/helpers/setup.cjs', '--experimental-test-coverage',
  '--test-coverage-include=dist/**/*.js',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', '--test-reporter-destination=coverage/lcov.info',
  '--test', 'test/*.test.cjs'
], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, TZ: 'Asia/Kathmandu' }, stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
