#!/usr/bin/env node
/**
 * Command reference validator (documentation side of the improvement guide item 28).
 *
 * Reads the command definitions straight from src/commands/*.ts and the slash command names from
 * src/slash/*.ts, then checks docs/commands.md against them:
 *
 *  - every documented prefix command exists in code;
 *  - every prefix command in code is documented;
 *  - every documented slash command exists in code, and vice versa;
 *  - documented examples use the documented syntax (spot checks for the participant journey).
 *
 * Run standalone:  node docs/commands.test.cjs
 * Exits non-zero with a report if anything fails. No build, no network.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'src', 'commands');
const SLASH_DIR = path.join(ROOT, 'src', 'slash');
const DOC = path.join(ROOT, 'docs', 'commands.md');

const problems = [];

function commandNamesInCode() {
	const names = new Map(); // name -> file
	for (const entry of fs.readdirSync(COMMANDS_DIR, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
		if (entry.name === 'index.ts' || entry.name === '_TEMPLATE.ts') continue;
		const source = fs.readFileSync(path.join(COMMANDS_DIR, entry.name), 'utf8');
		// The CommandDefinition is the object assigned to the default export; its `name` is the
		// first `name:` property at one tab of indentation inside `const command: CommandDefinition`.
		const definition = /const command: CommandDefinition = \{([\s\S]*?)\n\};/.exec(source);
		const match = definition
			? /\bname:\s*"([^"]+)"/.exec(definition[1])
			: /name:\s*"([^"]+)"\s*,/.exec(source);
		if (match) {
			if (names.has(match[1])) {
				problems.push(`Duplicate command name "${match[1]}" in ${entry.name} and ${names.get(match[1])}`);
			}
			names.set(match[1], entry.name);
		} else {
			problems.push(`${entry.name}: could not find a \`name: "..."\` definition`);
		}
	}
	return names;
}

function slashNamesInCode() {
	const names = new Map(); // top-level name -> file
	for (const entry of fs.readdirSync(SLASH_DIR, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
		if (entry.name === 'database.ts') continue; // shared helpers, not a command
		const source = fs.readFileSync(path.join(SLASH_DIR, entry.name), 'utf8');
		// The top-level command name is the setName directly on a SlashCommandBuilder chain:
		// `new SlashCommandBuilder()\n .setName("x")`. Subcommands/suboptions appear after
		// add(Sub)Command/option builders, which introduce other tokens first.
		const meta = /static override get meta[\s\S]*?\{([\s\S]*?)\n\t\t\t\.toJSON\(\)/.exec(source);
		if (!meta) {
			problems.push(`src/slash/${entry.name}: could not locate the meta builder block`);
			continue;
		}
		const builder = /new SlashCommandBuilder\(\)([\s\S]*?)(?:\.addSubcommand|\.addStringOption|\.addUserOption|\.addRoleOption|\.addChannelOption|\.addIntegerOption|\.setDMPermission|\.setDefaultMemberPermissions)/.exec(meta[1]);
		const scope = builder ? builder[1] : meta[1];
		const match = /\.setName\("([^"]+)"\)/.exec(scope);
		if (match) {
			if (names.has(match[1])) {
				problems.push(`Duplicate slash command name "${match[1]}" in ${entry.name} and ${names.get(match[1])}`);
			}
			names.set(match[1], entry.name);
		} else {
			problems.push(`src/slash/${entry.name}: no top-level .setName() found`);
		}
	}
	return names;
}

const codeCommands = commandNamesInCode();
const codeSlash = slashNamesInCode();

const docText = fs.readFileSync(DOC, 'utf8');

function documentedPrefixCommands() {
	const names = new Set();
	const section = docText.split('## Prefix commands')[1]?.split('## Slash commands')[0] ?? '';
	const pattern = /`!([a-z-]+)`/g;
	for (const match of section.matchAll(pattern)) names.add(match[1]);
	return names;
}

function documentedSlashCommands() {
	const names = new Set();
	const section = docText.split('## Slash commands')[1]?.split('## Buttons')[0] ?? '';
	const pattern = /`\/([a-z-]+)(?:\s+[a-z_]+)*`/g;
	for (const match of section.matchAll(pattern)) names.add(match[1]);
	return names;
}

const docCommands = documentedPrefixCommands();
const docSlash = documentedSlashCommands();

for (const name of docCommands) {
	if (!codeCommands.has(name)) problems.push(`docs/commands.md documents "!${name}" but no such command exists in src/commands/`);
}
for (const name of codeCommands.keys()) {
	if (!docCommands.has(name)) problems.push(`Command "${name}" (${codeCommands.get(name)}) exists in code but is not documented in docs/commands.md`);
}
for (const name of docSlash) {
	if (!codeSlash.has(name)) problems.push(`docs/commands.md documents "/${name}" but no such slash command exists in src/slash/`);
}
for (const name of codeSlash.keys()) {
	if (!docSlash.has(name)) problems.push(`Slash command "${name}" (${codeSlash.get(name)}) exists in code but is not documented in docs/commands.md`);
}

// Usage examples must match documented syntax.
const checks = [
	{ label: 'email requires an address argument', re: /`!email` \| participant \| ticket channel \| `<address>`/ },
	{ label: 'verify requires the code argument', re: /`!verify` \| participant \| ticket channel \| `<otp>`/ },
	{ label: 'check-in takes no arguments', re: /`!check-in` \| participant \| server \| —/ },
	{ label: 'add requires url and name', re: /`!add` \| TO \| server \| `<url> \[\.\.\.name\]`/ },
	{ label: 'round needs a channel and round number', re: /`!round` \| host \| server \| `\[id\] <#channel> <roundNumber>`/ }
];
for (const check of checks) {
	if (!check.re.test(docText)) problems.push(`docs/commands.md: ${check.label} — expected pattern missing`);
}

// Documented permission vocabulary should stay defined.
const vocabulary = ['everyone', 'participant', 'host', 'TO', 'TO or Admin'];
for (const term of vocabulary) {
	if (!docText.includes(`**${term}**`) && !docText.includes(`| ${term} |`)) {
		problems.push(`docs/commands.md: authority level "${term}" used but not defined`);
	}
}

if (problems.length > 0) {
	console.error(`Command reference validation failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`Command reference OK: ${codeCommands.size} prefix commands and ${codeSlash.size} slash commands documented and matching code.`
);
