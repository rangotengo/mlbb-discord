const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PersistentTimer, TimeWizard } = require('../dist/timer');
const { addTournament } = require('../dist/util/tournament');
const { id } = require('./helpers/fixtures.cjs');
const { Countdown } = require('../dist/database/orm');
const { withDatabase } = require('./helpers/fixtures.cjs');
const delegate = () => ({ messages: [], edits: [], async sendMessage(channel, content) { this.messages.push({ channel, content }); return String(this.messages.length); }, async editMessage(channel, id, content) { this.edits.push({ channel, id, content }); } });

test('timer formatting handles elapsed, minute, and hour boundaries', () => {
  for (const [value, expected] of [[-1000, '00:00'], [0, '00:00'], [59000, '00:59'], [60000, '01:00'], [3600000, '60:00'], [3661000, '01:01:01']]) assert.equal(PersistentTimer.formatTime(value), expected);
});

test('invalid timers fail before creating a Discord message or database row', async () => withDatabase(async () => {
  const discord = delegate();
  for (const end of [new Date('bad'), new Date(Date.now() - 1000)]) await assert.rejects(PersistentTimer.create(discord, end, 'channel', 'done', 5), /future/);
  for (const interval of [0, -1, 1.5]) await assert.rejects(PersistentTimer.create(discord, new Date(Date.now() + 60000), 'channel', 'done', interval), /positive integer/);
  assert.equal(discord.messages.length, 0);
  assert.equal(await Countdown.count(), 0);
}));

test('expiring a timer sends the final message once and performs no further edits', async () => withDatabase(async () => {
  const discord = delegate();
  const timer = await PersistentTimer.create(discord, new Date(Date.now() + 60000), 'channel', 'done', 5);
  try {
    timer.entity.end = new Date(Date.now() - 1000);
    await Promise.all([timer.tick(), timer.tick()]);
    assert.equal(timer.isActive(), false);
    assert.equal(discord.messages.filter(m => m.content === 'done').length, 1);
    assert.equal(discord.edits.length, 0);
    assert.equal(await Countdown.count(), 0);
    await timer.abort();
  } finally { await timer.abort(); }
}));

test('loading timers prunes expired rows and cancellation removes active ones', async () => withDatabase(async () => {
  await Countdown.create({ channelId: 'c', messageId: '1', end: new Date(Date.now() - 1000), finalMessage: 'expired', cronIntervalSeconds: 5 }).save();
  await Countdown.create({ channelId: 'c', messageId: '2', end: new Date(Date.now() + 60000), finalMessage: 'future', cronIntervalSeconds: 5 }).save();
  const discord = delegate();
  const timers = await PersistentTimer.loadAll(discord);
  try {
    assert.equal(timers.length, 1);
    assert.equal(discord.messages[0].content, 'expired');
    assert.equal(await Countdown.count(), 1);
  } finally { await Promise.all(timers.map(timer => timer.abort())); }
}));

test('replacing tournament timers cancels the old timers and partial startup failures are cleaned up', async () => withDatabase(async () => {
  const discord = delegate();
  await addTournament(id, 'cup', 'guild', 'host');
  await addTournament(id, 'other', 'guild', 'host');
  const wizard = new TimeWizard(discord);
  try {
    await wizard.start('cup', ['first'], new Date(Date.now() + 60000), 'done', 5);
    const first = (await Countdown.find())[0].id;
    await wizard.start('cup', ['second'], new Date(Date.now() + 60000), 'done', 5);
    assert.equal(await Countdown.count(), 1);
    assert.equal(await Countdown.findOneBy({ id: first }), null);
    const failing = new TimeWizard({ ...discord, async sendMessage(channel, content) { if (channel === 'bad') throw new Error('Discord failed'); return discord.sendMessage(channel, content); } });
    await assert.rejects(failing.start('other', ['ok', 'bad'], new Date(Date.now() + 60000), 'done', 5), /Discord failed/);
    assert.equal(await Countdown.count(), 1);
  } finally { await wizard.cancel('cup'); }
}));
