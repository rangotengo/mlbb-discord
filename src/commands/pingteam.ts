import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";

const logger = getLogger("command:pingteam");

const command: CommandDefinition = {
	name: "pingteam",
	requiredArgs: ["teamName"],
	optionalArgs: ["tournamentId", "...message"],
	executor: async (msg, args) => {
		// Permission check
		if (!isTournamentHost(msg.member, args[0] || "")) {
			await msg.reply("❌ Only Tournament Organizers can use this command.");
			return;
		}

		if (!msg.guild) return;

		// Parse arguments - tournamentId is optional
		let tournamentId: string | undefined;
		let teamName: string;
		let message: string;

		if (args.length >= 2) {
			// Check if first arg is a tournament ID or team name
			const potentialId = await resolveTournamentId(args[0], msg.guildId);
			if (potentialId) {
				tournamentId = potentialId;
				teamName = args[1];
				message = args.slice(2).join(" ");
			} else {
				// First arg is team name, use default tournament
				teamName = args[0];
				message = args.slice(1).join(" ");
			}
		} else {
			teamName = args[0];
			message = "";
		}

		// Resolve tournament ID if not provided
		const id = await resolveTournamentId(tournamentId, msg.guildId);

		// Find all enrolled players for this team
		const players = await EnrolledPlayer.find({
			where: { tournamentId: id, team: teamName, verified: true }
		});

		if (players.length === 0) {
			await msg.reply(`❌ No verified players found for team **${teamName}** in tournament **${id}**.`);
			return;
		}

		// Filter for players who have linked Discord accounts
		const linkedPlayers = players.filter(p => p.discordId);

		if (linkedPlayers.length === 0) {
			await msg.reply(`⚠️ Team **${teamName}** has ${players.length} enrolled player(s), but none have linked their Discord accounts yet.`);
			return;
		}

		// Generate user mentions
		const mentions = linkedPlayers.map(p => `<@${p.discordId}>`).join(" ");

		// Build and send the message
		const fullMessage = message ? `${mentions}\n\n${message}` : mentions;
		await msg.reply(fullMessage);

		logger.info(`Pinged ${linkedPlayers.length} player(s) for team ${teamName} in tournament ${id}`);
	}
};

export default command;
