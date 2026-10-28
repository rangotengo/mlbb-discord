import { CommandDefinition } from "../Command";
import { addTournament, extractTournamentId, syncTournament } from "../util/tournament";
import { getLogger } from "../util/logger";
import { ChallongeTournament } from "../database/orm";

const logger = getLogger("command:add");

const command: CommandDefinition = {
	name: "add",
	requiredArgs: ["url", "...name"],
	optionalArgs: [],
	executor: async (msg, args, support) => {
		await support.organiserRole.authorise(msg);

		if (args.length < 2) {
			await msg.reply(
				`Missing tournament name. Expected format: !add https://www.challengermode.com/tournaments/<uuid> name`
			);
			return;
		}

		const url = args[0];
		const customName = args.slice(1).join(" ");

		// Validate URL format using centralized function
		try {
			extractTournamentId(url);
		} catch {
			await msg.reply(
				`Invalid Challengermode URL. Expected format: !add https://www.challengermode.com/tournaments/<uuid> name`
			);
			return;
		}

		// Use shared service to add tournament
		const result = await addTournament(url, customName, msg.guildId!, msg.author.id);

		if (!result.success) {
			await msg.reply(result.error!);
			return;
		}

		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: customName,
				command: "add",
				event: "success"
			})
		);

		// Auto-sync after adding tournament
		try {
			const tournament = await ChallongeTournament.findOneOrFail({ where: { tournamentId: result.customName } });
			const synced = await syncTournament(tournament, support.tournamentApi);
			if (!synced.success) throw new Error(synced.error);

			logger.info(`Tournament "${result.customName}" auto-synced after adding via Discord command`);

			await msg.reply(
				`Tournament **${result.customName}** has been added and synced!\n\n` +
					`Challengermode URL: ${result.url}\n` +
					`Challengermode ID: ${result.challongeId}\n` +
					`Host: <@${result.userId}>\n` +
					`Status: ${synced.status || "preparing"}\n` +
					`Format: ${synced.format || "unknown"}`
			);
		} catch (syncError) {
			logger.error(`Auto-sync failed for tournament "${result.customName}":`, syncError);
			await msg.reply(
				`Tournament **${result.customName}** has been added!\n\n` +
					`Challengermode URL: ${result.url}\n` +
					`Challengermode ID: ${result.challongeId}\n` +
					`Host: <@${result.userId}>\n\n` +
					`⚠️ Auto-sync failed: ${syncError instanceof Error ? syncError.message : "Unknown error"}\nUse \`!sync ${result.customName}\` after completing setup.`
			);
		}
	}
};

export default command;
