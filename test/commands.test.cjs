const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Command } = require('../dist/Command');
const { SlashCommand } = require('../dist/SlashCommand');
const { UserError } = require('../dist/util/errors');
const { WebsiteWrapperChallengermode } = require('../dist/website/challengermode');
const { parseUserMention } = require('../dist/util/discord');
const message = () => ({ channelId: 'channel', id: 'message', author: { id: 'user' }, replies: [], async reply(value) { this.replies.push(value); } });

test('command usage rejects missing/excess arguments and accepts variadic input', async () => {
  let executions = 0;
  const command = new Command({ name: 'example', requiredArgs: ['one'], executor: async () => { executions++; } });
  for (const args of [[], [''], ['one', 'extra']]) { const msg = message(); await command.run(msg, args, {}); assert.match(msg.replies[0], /Usage/); }
  await command.run(message(), ['one'], {}); assert.equal(executions, 1);
  const variadic = new Command({ name: 'many', requiredArgs: ['...values'], executor: async () => { executions++; } });
  await variadic.run(message(), ['one', 'two', 'three'], {}); assert.equal(executions, 2);
});

test('command failures give feedback and never leak internal errors or reject the handler', async () => {
  for (const value of [new UserError('Fix the input'), new Error('private server details'), null, 'failure']) {
    const command = new Command({ name: 'error', requiredArgs: [], executor: async () => { throw value; } });
    const msg = message(); await command.run(msg, [], {});
    assert.equal(msg.replies.length, 1);
    assert.equal(msg.replies[0], value instanceof UserError ? 'Fix the input' : 'Something went wrong. Please try again later.');
  }
});

test('slash command failures use reply, editReply, or followUp according to interaction state', async () => {
  class Example extends SlashCommand {
    get logger() { return { verbose() {}, error() {} }; }
    async execute() { throw new UserError('Configure the tournament key'); }
  }
  for (const [state, expected] of [[{}, 'reply'], [{ deferred: true }, 'editReply'], [{ replied: true }, 'followUp']]) {
    const calls = [];
    const interaction = { ...state, user: { id: 'u' }, client: { ws: { ping: 0 } } };
    for (const method of ['reply', 'editReply', 'followUp']) interaction[method] = async content => calls.push([method, content]);
    await new Example().run(interaction);
    assert.deepEqual(calls, [[expected, 'Configure the tournament key']]);
  }
});

test('read-only score and registration commands fail before network requests or local changes', async () => {
  const api = new WebsiteWrapperChallengermode('', async () => { throw new Error('Network must not be called'); });
  for (const file of ['score', 'forcescore', 'enroll']) {
    const command = require(`../dist/commands/${file}`).default;
    await assert.rejects(command.executor(message(), file === 'enroll' ? ['cup', 'register'] : ['2-1'], { tournamentApi: api }), /reads data/);
  }
});

test('user mentions exclude role mentions, empty IDs, and malformed markup', () => {
  const id = '123456789012345678';
  assert.equal(parseUserMention(`<@${id}>`), id);
  assert.equal(parseUserMention(`<@!${id}>`), id);
  for (const value of [`<@&${id}>`, '<@abc>', '<@>', `prefix<@${id}>`, id]) assert.equal(parseUserMention(value), null);
});
