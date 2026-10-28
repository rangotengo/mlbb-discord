import { CommandDefinition } from "../Command";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { resolveTournamentId, syncTournament } from "../util/tournament";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";

const logger = getLogger("command:sync");

const command: CommandDefinition = {
	name: "sync",
	requiredArgs: [],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		const [providedId] = args;
		const id = await resolveTournamentId(providedId, msg.guildId);
		await support.database.authenticateHost(id, msg.author.id, msg.guildId, undefined, isTournamentHost(msg.member, id));
		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "sync",
				event: "attempt"
			})
		);

		// Fetch the full tournament entity for the shared utility
		const fullTournament = await ChallongeTournament.findOne({
			where: { tournamentId: id }
		});

		if (!fullTournament) {
			await msg.reply("Failed to load tournament data.");
			return;
		}

		// Use shared sync utility
		const result = await syncTournament(fullTournament, support.tournamentApi);

		if (!result.success) {
			await msg.reply(`Failed to sync with Challengermode: ${result.error}`);
			return;
		}

		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "sync",
				event: "success"
			})
		);

		// Provide detailed feedback about the sync
		const details = [
			`**${result.name}** synced successfully!`,
			`Matched players: ${result.matchedPlayers}`,
			`Added schedules: ${result.addedSchedules}`,
			`Skipped existing schedules: ${result.skippedSchedules}`
		].join("\n");

		await msg.reply(details);
	}
};

export default command;
