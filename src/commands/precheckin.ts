import { Message } from "discord.js";
import { CommandDefinition, CommandSupport } from "../Command";
import { ChallongeTournament } from "../database/orm";
import { TournamentPhase } from "../database/interface";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { checkInTeam, createBracketFromCheckin, openPreCheckin, resolveTournamentId } from "../util/tournament";

const logger = getLogger("command:precheckin");

function formatTeams(teams: string[]): string {
	return teams.length ? teams.map(team => `• ${team}`).join("\n") : "None yet.";
}

async function loadHostedTournament(msg: Message, support: CommandSupport): Promise<ChallongeTournament | undefined> {
	const id = await resolveTournamentId(undefined, msg.guildId);
	await support.database.authenticateHost(
		id,
		msg.author.id,
		msg.guildId,
		undefined,
		isTournamentHost(msg.member, id)
	);
	const tournament = await ChallongeTournament.findOne({ where: { tournamentId: id } });
	if (!tournament) {
		await msg.reply("Failed to load tournament data.");
	}
	return tournament ?? undefined;
}

const command: CommandDefinition = {
	name: "precheckin",
	requiredArgs: ["action"],
	optionalArgs: ["...rest"],
	executor: async (msg, args, support) => {
		const [action, ...rest] = args;
		const tournament = await loadHostedTournament(msg, support);
		if (!tournament) return;

		if (action === "open") {
			const result = await openPreCheckin(tournament);
			await msg.reply(
				result.ok
					? result.already
						? `Check-in is already open for **${tournament.name}**.\n${formatTeams(result.teams)}`
						: `Check-in is open for **${tournament.name}**. A team checks in with \`!precheckin <team name>\`.`
					: result.error
			);
			return;
		}

		if (action === "list") {
			await msg.reply(
				`**${tournament.name}** is \`${tournament.phase}\`.\nChecked in:\n${formatTeams(tournament.checkedInTeams)}`
			);
			return;
		}

		if (action === "close") {
			const result = await createBracketFromCheckin(tournament, support.challonge);
			if (!result.ok) {
				await msg.reply(result.error);
				return;
			}
			logger.info(`Created Challonge bracket for ${tournament.tournamentId}: ${result.url}`);
			await msg.reply(
				result.already
					? `Bracket already exists: ${result.url}`
					: `Bracket created from ${result.teams.length} team(s): ${result.url}\nUse \`!sync ${tournament.tournamentId}\` to pull matches.`
			);
			return;
		}

		if (tournament.phase !== TournamentPhase.CHECKIN_OPEN) {
			await msg.reply(
				`Unknown action \`${action}\`. Use \`open\`, \`list\`, \`close\`, or a team name while check-in is open.`
			);
			return;
		}

		const requested = [action, ...rest].join(" ");
		const result = await checkInTeam(tournament, requested);
		const matched = result.ok
			? result.teams.find(team => team.toLowerCase() === requested.trim().toLowerCase())
			: undefined;
		await msg.reply(
			result.ok
				? result.already
					? `**${matched || requested.trim()}** is already checked in.`
					: `Checked in **${matched || requested.trim()}**. ${result.teams.length} team(s) ready.`
				: result.error
		);
	}
};

export default command;
