import * as commands from "../commands";
import { slashCommandMetadata } from "../events/interaction";

type Help = { description: string; usage?: string };
const help: Record<keyof typeof commands, Help> = {
	add: { description: "Add a tournament using its Challonge URL and an internal ID. Mention pre-check-in and omit the URL to collect team check-in before the bracket exists. Requires the Tournament Organizer role.", usage: "<url> <internal-id> | pre-checkin <name>" },
	precheckin: { description: "Open team check-in, list checked-in teams, check in one enrolled team, or close check-in and create the Challonge bracket from those teams. Requires tournament host or organizer access.", usage: "open | list | close | <team name>" },
	check: { description: "Check in by matching your enrolled Discord username. If verification needs help, open or reuse a private verification thread." },
	close: { description: "Close a private verification thread. Requires Tournament Organizer or Administrator access." },
	coin: { description: "Flip a coin." },
	dropPlayer: { description: "Remove an enrolled player by email. Requires Tournament Organizer or Administrator access.", usage: "<email> [tournament-id]" },
	email: { description: "Send an email verification code to your enrolled email address. Use inside your private verification thread.", usage: "<email>" },
	enroll: { description: "Import players from an attached CSV or TSV. Supports one team per row with up to six players, or one player per row. Add register to register teams on Challonge. Requires tournament host or organizer access.", usage: "[tournament-id] [register] + file attachment" },
	forcescore: { description: "Override a match score for a mentioned winner. Requires tournament host or organizer access. The current argument parser needs correction before this command can reliably accept the winner mention." },
	help: { description: "Show the bot's help message." },
	info: { description: "Show tournament details, capacity, format, and hosts. Requires the Tournament Organizer role.", usage: "[tournament-id]" },
	list: { description: "List ongoing tournaments. Requires the Tournament Organizer role." },
	matches: { description: "List Challonge matches, rounds, and match IDs. Add download for a schedule CSV. Requires tournament host or organizer access.", usage: "[tournament-id] [download]" },
	round: { description: "Create match threads for the open matches in a round. The target text channel must be under the allowed category. Requires tournament host or organizer access.", usage: "[tournament-id] <#channel> <round>" },
	schedule: { description: "Import match times from an attached schedule CSV. Requires tournament host or organizer access.", usage: "[tournament-id] + file attachment" },
	score: { description: "Report your match score for opponent approval. Tournament Organizers cannot use this player command.", usage: "[tournament-id] <score, e.g. 2-1>" },
	status: { description: "View or change a tournament's status. Requires tournament host or organizer access.", usage: "[tournament-id] [new-status]" },
	sync: { description: "Sync tournament details, team links, and match schedules from Challonge. Requires tournament host or organizer access.", usage: "[tournament-id]" },
	syncRoles: { description: "Verify enrolled players by Discord ID or an exact, case-insensitive match to their imported Discord username, global name, server display name, or tag. Ambiguous names require manual verification. Assign participant roles and restore match-thread access. Requires tournament host or organizer access; only authorized tournaments in this server are processed.", usage: "[tournament-id]" },
	toss: { description: "Flip a coin, like the coin command." },
	update: { description: "Update the tournament name and description through the bot. Requires tournament host or organizer access. Use the dashboard editor to change the internal ID.", usage: "[tournament-id] <name> <description>" },
	updatePlayer: { description: "Update an enrolled player's email, name, team, or Discord username using field:value arguments. Requires Tournament Organizer or Administrator access.", usage: "<email> <field:value> [tournament-id]" },
	verify: { description: "Complete email verification with your code inside your private verification thread. Successful verification grants the participant role and closes the thread.", usage: "<code>" },
	verifyPlayer: { description: "Manually verify an enrolled player by email and assign their participant role. Requires Tournament Organizer or Administrator access.", usage: "<@user> <email> [tournament-id]" },
	setParticipantRole: { description: "Choose the existing role assigned to verified players in a tournament. Requires Tournament Organizer or Administrator access.", usage: "<tournament-id> <@role>" },
	addhost: { description: "Add a tournament host. Requires tournament host or organizer access.", usage: "[tournament-id] <@user>" },
	pingteam: { description: "Mention a team's enrolled Discord members, optionally with a message. Requires tournament host or organizer access.", usage: "<tournament-id> <team-name> [message]" },
	removehost: { description: "Remove a tournament host. Requires tournament host or organizer access.", usage: "[tournament-id] <@user>" }
};

export interface CommandReference {
	name: string;
	usage: string;
	description: string;
	type: "Message" | "Slash";
	options: { name: string; description: string; required: boolean }[];
}

type SlashOption = { name: string; description: string; type: number; required?: boolean; options?: SlashOption[] };
function slashEntries(name: string, description: string, options: SlashOption[] = []): CommandReference[] {
	const subcommands = options.filter(option => option.type === 1 || option.type === 2);
	if (subcommands.length) return subcommands.flatMap(option => slashEntries(`${name} ${option.name}`, option.description, option.options));
	return [{ name: `/${name}`, description, type: "Slash", usage: `/${name} ${options.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(" ")}`.trim(),
		options: options.map(option => ({ name: option.name, description: option.description, required: !!option.required })) }];
}

export function getCommandReference(prefix: string): CommandReference[] {
	const message = (Object.keys(commands) as (keyof typeof commands)[]).map(key => ({
		name: `${prefix}${commands[key].name}`, usage: `${prefix}${commands[key].name}${help[key].usage ? ` ${help[key].usage}` : ""}`,
		description: help[key].description, type: "Message" as const, options: []
	}));
	const slash = slashCommandMetadata.flatMap(meta => "description" in meta ? slashEntries(meta.name, meta.description, meta.options as SlashOption[]) : []);
	return [...message.sort((a, b) => a.name.localeCompare(b.name)), ...slash.sort((a, b) => a.name.localeCompare(b.name))];
}
