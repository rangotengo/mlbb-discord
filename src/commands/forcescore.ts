import { escapeMarkdown } from "discord.js";
import { CommandDefinition } from "../Command";
import { TournamentStatus } from "../database/interface";
import { findClosedMatch } from "../util/challonge";
import { firstMentionOrFail, isTournamentHost } from "../util/discord";
import { UserError } from "../util/errors";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";
import { parseScore } from "../util";

const logger = getLogger("command:forcescore");

const command: CommandDefinition = {
	name: "forcescore",
	requiredArgs: ["score"],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		if (!support.tournamentApi.supportsWrites) support.tournamentApi.assertWritesSupported();
		let providedId: string | undefined;
		let score: string;

		if (args.length === 2) {
			[providedId, score] = args;
		} else {
			score = args[0];
		}

		const id = await resolveTournamentId(providedId, msg.guildId);
		const player = firstMentionOrFail(msg);
		const scores = parseScore(score);
		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "forcescore",
				mention: player.id,
				scores,
				event: "attempt"
			})
		);
		// Check command syntax first to avoid a database round trip
		const tournament = await support.database.authenticateHost(
			id,
			msg.author.id,
			msg.guildId,
			TournamentStatus.IPR,
			isTournamentHost(msg.member, id)
		);
		try {
			// eslint-disable-next-line no-var
			var { challongeId } = await support.database.getConfirmedPlayer(player.id, id);
		} catch {
			throw new UserError(`${player} isn't playing in **${tournament.name}**.`);
		}
		// can also find open matches, just depends on current round
		const match = await findClosedMatch(tournament.challongeTournamentId, challongeId, support.tournamentApi);
		if (!match) {
			throw new UserError(`Could not find an open match in **${tournament.name}** including ${player}.`);
		}
		await support.tournamentApi.submitScore(tournament.challongeTournamentId, match, challongeId, scores[0], scores[1]);
		const cleared = support.scores.get(id)?.delete(challongeId); // Remove any pending participant-submitted score.
		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "forcescore",
				mention: player.id,
				scores,
				cleared,
				event: "success"
			})
		);
		const who = `${player} (${escapeMarkdown(player.tag)})`;
		await msg.reply(`Score of ${scores[0]}-${scores[1]} submitted in favour of ${who} in **${tournament.name}**!`);
	}
};

export default command;
