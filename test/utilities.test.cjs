const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV, parseCSVRow, formatCSVRow, formatCSVDate, downloadAndValidateCSV } = require('../dist/util/csv');
const { parseDateTime } = require('../dist/util/parseDateTime');
const { parseTime } = require('../dist/util/parseTime');
const { splitText, parseScore, formatScheduledTime } = require('../dist/util');
const { parseUserMention } = require('../dist/util/discord');
const { getIdParam } = require('../dist/web/params');

test('CSV parses BOM, CRLF, commas, escaped quotes, trailing fields, and multiline records', () => {
  assert.deepEqual(parseCSV('\uFEFFname,email,team\r\n"Player, One",a@test.com,"Team ""A""\nSquad"\r\n\r\n'), [
    ['name', 'email', 'team'], ['Player, One', 'a@test.com', 'Team "A"\nSquad']
  ]);
  assert.deepEqual(parseCSVRow(' a,"b,c","d""e",'), ['a', 'b,c', 'd"e', '']);
  for (const value of ['"unclosed', 'bad"quote,value', '"closed"trailing,value']) assert.throws(() => parseCSV(value), /CSV/);
  assert.throws(() => parseCSVRow('one\ntwo'), /one CSV record/);
});

test('CSV serialization round-trips commas, quotes, and newlines', () => {
  const values = ['Team "A", captain', 'Player\nOne', '', 'test@example.com'];
  assert.deepEqual(parseCSV(formatCSVRow(values)), [values]);
  assert.equal(formatCSVRow([null, undefined, 3]), ',,3');
});

test('schedule dates export as UTC and leave unscheduled values blank', () => {
  assert.equal(formatCSVDate(new Date('2026-11-01T12:34:56Z')), '2026-11-01 12:34:56');
  for (const value of [null, undefined, new Date('bad'), new Date('2099-12-31T23:59:59Z')]) assert.equal(formatCSVDate(value), '');
  assert.equal(parseDateTime(formatCSVDate(new Date('2026-11-01T12:34:56Z')), 'UTC').toISOString(), '2026-11-01T12:34:56.000Z');
});

test('CSV attachment validation handles HTTP failures, file types, and minimum record counts', async t => {
  await assert.rejects(downloadAndValidateCSV(null), /attach a CSV/);
  await assert.rejects(downloadAndValidateCSV({ name: 'file.txt' }), /must be a CSV/);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('error', { status: 404 }));
  const attachment = { name: 'Players.CSV', url: 'https://example.test/players.csv' };
  await assert.rejects(downloadAndValidateCSV(attachment), /Failed to download/);
  fetch.mock.mockImplementation(async () => new Response('header\n'));
  await assert.rejects(downloadAndValidateCSV(attachment), /at least 2 rows/);
  fetch.mock.mockImplementation(async () => new Response('name,team\n"Player\nOne",Team'));
  assert.match(await downloadAndValidateCSV(attachment), /Player\nOne/);
});

for (const [value, expected] of [['1:30', 90], ['00:05', 5], ['45', 45], [' 0 ', 0]]) {
  test(`duration accepts ${JSON.stringify(value)}`, () => assert.equal(parseTime(value), expected));
}
for (const value of ['', '-1', '1:60', '1:2:3', '1.5', '10minutes', '3e4', '9007199254740992']) {
  test(`duration rejects ${JSON.stringify(value)}`, () => assert.throws(() => parseTime(value), /Invalid time/));
}

test('score parser requires exactly two safe non-negative integer scores', () => {
  assert.deepEqual(parseScore(' 2-1 '), [2, 1]);
  for (const value of ['1-2-3', '1.5-0', '1win-0', '-1-2', '1-NaN', '1', '9007199254740992-1']) assert.throws(() => parseScore(value));
});

for (const [value, zone, expected] of [
  ['2026-11-01 12:30:45', undefined, '2026-11-01T12:30:45.000Z'],
  ['2026-11-01T12:30', 'UTC', '2026-11-01T12:30:00.000Z'],
  ['2026-11-01T12:30:45', 'Z', '2026-11-01T12:30:45.000Z'],
  ['11/25/2026 12:30', 'IST', '2026-11-25T07:00:00.000Z'],
  ['25/11/2026 12:30', '+05:45', '2026-11-25T06:45:00.000Z'],
  ['2026-11-01 12:30', 'UTC-08:00', '2026-11-01T20:30:00.000Z'],
  ['2024-02-29 12:30', 'Asia/Kathmandu', '2024-02-29T06:45:00.000Z'],
  ['2026-11-01 00:00', ' Asia/Kathmandu ', '2026-10-31T18:15:00.000Z'],
  ['2026-03-08 03:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
  ['0099-01-01 12:00', 'UTC', '0099-01-01T12:00:00.000Z']
]) test(`date parsing ${value} ${zone || 'default UTC'}`, () => assert.equal(parseDateTime(value, zone).toISOString(), expected));

for (const [value, zone] of [
  ['2026-02-29 10:00'], ['2026-13-01 10:00'], ['2026-01-00 10:00'], ['2026-04-31 10:00'],
  ['2026-01-01 24:00'], ['2026-01-01 12:60'], ['2026-01-01 12:00:60'], ['garbage'],
  ['2026-01-01 12:00', '+14:01'], ['2026-01-01 12:00', '-15:00'], ['2026-01-01 12:00', '+05:99'],
  ['2026-01-01 12:00', 'Invalid/Timezone'], ['2026-03-08 02:30', 'America/New_York'],
  ['2026-11-01 01:30', 'America/New_York']
]) test(`date parsing rejects ${value} ${zone || ''}`, () => assert.throws(() => parseDateTime(value, zone)));

test('text splitting terminates at leading newlines and respects length limits', () => {
  assert.deepEqual(splitText('\nabcdef', 3), ['\nab', 'cde', 'f']);
  assert.deepEqual(splitText('abc\ndef\nghi', 4), ['abc', 'def', 'ghi']);
  for (const length of [0, -1, NaN, 1.5]) assert.throws(() => splitText('text', length), /positive integer/);
  for (const part of splitText('abcdefghijk', 3)) assert.ok(part.length <= 3);
});

test('route parameters preserve UUIDs, arrays and missing values', () => {
  assert.equal(getIdParam({ id: ['one', 'two'] }), 'one');
  assert.equal(getIdParam({}), '');
  assert.equal(getIdParam({ matchId: 'uuid' }, 'matchId'), 'uuid');
});

test('scheduled display handles invalid and unset dates', () => {
  for (const value of [null, undefined, 'invalid', '2099-12-31T23:59:59Z']) {
    assert.equal(formatScheduledTime(value), 'Not set');
    assert.match(formatScheduledTime(value, { html: true }), /<span/);
  }
  assert.notEqual(formatScheduledTime('2026-11-01T12:00:00Z'), 'Not set');
});
