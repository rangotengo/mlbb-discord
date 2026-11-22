import { Message } from "discord.js";
import { CommandDefinition } from "../Command";
import { addPreCheckinTournament, addTournament, AddTournamentResult, extractChallongeId, isPreCheckinName } from "../util/tournament";
import { getLogger } from "../util/logger";
import { EnrolledPlayer } from "../database/orm";
import { TournamentFormat, TournamentStatus } from "../database/interface";

const logger = getLogger("command:add");

async function addLinked(args: string[], msg: Message): Promise<AddTournamentResult> {
	const url = args[0];
	const customName = args.slice(1).join(" ");
	try {
		extractChallongeId(url);
	} catch {
		return {
			success: false,
			error: "Invalid Challonge URL. Expected `!add https://challonge.com/xyz name` or `!add pre-checkin name`."
		};
	}
	return addTournament(url, customName, msg.guildId!, msg.author.id);
}

const command: CommandDefinition = {
	name: "add",
	requiredArgs: ["...name"],
	optionalArgs: [],
	executor: async (msg, args, support) => {
		await support.organiserRole.authorise(msg);

		const first = args[0] ?? "";
		const preCheckin = isPreCheckinName(args.join(" ")) && !/challonge\.com/i.test(first);
		if (!preCheckin && args.length < 2) {
			await msg.reply(
				`Missing tournament name. Expected \`!add https://challonge.com/xyz name\` or \`!add pre-checkin name\`.`
			);
			return;
		}

		const result = preCheckin
			? await addPreCheckinTournament(args.join(" "), msg.guildId!, msg.author.id)
			: await addLinked(args, msg);

		if (!result.success) {
			await msg.reply(result.error!);
			return;
		}

		if (result.phase === "pre-checkin") {
			await msg.reply(
				`Pre-check-in tournament **${result.customName}** is ready. No Challonge bracket yet.\n` +
					`Enroll teams, then \`!precheckin open\`. After teams check in, \`!precheckin close\` creates the bracket.`
			);
			return;
		}

		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: result.customName,
				command: "add",
				event: "success"
			})
		);

		// Auto-sync after adding tournament
		try {
			const tournamentData = await support.challonge.getTournament(result.challongeId!);

			// Match enrolled players to Challonge participants by team name and store challongeId
			const enrolledPlayers = await EnrolledPlayer.find({
				where: { tournamentId: result.customName }
			});

			let matchedCount = 0;
			for (const enrolled of enrolledPlayers) {
				const challongePlayer = tournamentData.players.find(
					p => p.name.toLowerCase() === enrolled.team.toLowerCase()
				);

				if (challongePlayer && !enrolled.challongeId) {
					enrolled.challongeId = challongePlayer.challongeId;
					await enrolled.save();
					matchedCount++;
				}
			}

			// Map Challonge state to TournamentStatus
			let status: TournamentStatus | undefined;
			if (tournamentData.state) {
				switch (tournamentData.state) {
					case "pending":
						status = TournamentStatus.PREPARING;
						break;
					case "underway":
						status = TournamentStatus.IPR;
						break;
					case "complete":
						status = TournamentStatus.COMPLETE;
						break;
				}
			}

			// Map Challonge tournament type to TournamentFormat
			let format: TournamentFormat | undefined;
			if (tournamentData.format) {
				format = tournamentData.format as TournamentFormat;
			}

			const participantLimit = tournamentData.signupCap ?? 0;

			await support.database.synchronise(result.customName, {
				name: tournamentData.name,
				description: tournamentData.desc,
				players: tournamentData.players.map(({ challongeId, discordId }) => ({ challongeId, discordId })),
				status,
				format,
				participantLimit
			});

			logger.info(`Tournament "${result.customName}" auto-synced after adding via Discord command`);

			await msg.reply(
				`Tournament **${result.customName}** has been added and synced!\n\n` +
					`Challonge URL: ${result.url}\n` +
					`Challonge ID: ${result.challongeId}\n` +
					`Host: <@${result.userId}>\n` +
					`Status: ${status || "preparing"}\n` +
					`Format: ${format || "unknown"}`
			);
		} catch (syncError) {
			logger.error(`Auto-sync failed for tournament "${result.customName}":`, syncError);
			await msg.reply(
				`Tournament **${result.customName}** has been added!\n\n` +
					`Challonge URL: ${result.url}\n` +
					`Challonge ID: ${result.challongeId}\n` +
					`Host: <@${result.userId}>\n\n` +
					`⚠️ Auto-sync failed. Use \`!sync ${result.customName}\` to sync manually.`
			);
		}
	}
};

export default command;
