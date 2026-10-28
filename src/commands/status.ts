import { CommandDefinition } from "../Command";
import { TournamentStatus } from "../database/interface";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";
import { ChallongeTournament, EnrolledPlayer } from "../database/orm";

const logger = getLogger("command:status");

const statusEmoji = {
	[TournamentStatus.PREPARING]: "🟡",
	[TournamentStatus.IPR]: "🟢",
	[TournamentStatus.COMPLETE]: "🏁"
} as const;

async function getCheckInSummary(tournamentId: string): Promise<string> {
	const players = await EnrolledPlayer.find({
		where: { tournamentId },
		relations: ["tournament"]
	});

	if (players.length === 0) {
		return "\n\n📋 **No players enrolled yet**";
	}

	// Group by team and count verified
	const teamStats = new Map<string, { total: number; checkedIn: number }>();

	for (const player of players) {
		const team = player.team || "Unknown Team";
		const stats = teamStats.get(team) || { total: 0, checkedIn: 0 };
		stats.total++;
		if (player.verified) {
			stats.checkedIn++;
		}
		teamStats.set(team, stats);
	}

	// Sort by team name
	const sortedTeams = Array.from(teamStats.entries()).sort((a, b) => a[0].localeCompare(b[0]));

	const totalPlayers = players.length;
	const totalCheckedIn = players.filter(p => p.verified).length;

	let summary = `\n\n📋 **Check-in Summary** (${totalCheckedIn}/${totalPlayers} players checked in)\n`;
	summary += "```\n";

	for (const [team, stats] of sortedTeams) {
		const checkMark = stats.checkedIn === stats.total ? "✅" : stats.checkedIn > 0 ? "🔶" : "❌";
		// Truncate team name if too long for display
		const displayName = team.length > 20 ? `${team.substring(0, 17)}...` : team;
		summary += `${checkMark} ${displayName.padEnd(20)} ${stats.checkedIn}/${stats.total} checked in\n`;
	}

	summary += "```";

	return summary;
}

const command: CommandDefinition = {
	name: "status",
	requiredArgs: [],
	optionalArgs: ["id", "newStatus"],
	executor: async (msg, args, support) => {
		// Handle Discord autocomplete weirdness - if we got 1 arg with a space, split it
		if (args.length === 1 && args[0].includes(" ")) {
			args = args[0].split(/\s+/);
		}

		// If no args, show list of all tournaments (requires TO/Host)
		if (args.length === 0) {
			// Authenticate first
			const id = await resolveTournamentId(undefined, msg.guildId);
			await support.database.authenticateHost(id, msg.author.id, msg.guildId, undefined, isTournamentHost(msg.member, id));

			const list = await support.database.getActiveTournaments(msg.guildId || "private");
			if (list.length === 0) {
				await msg.reply("There are no active tournaments.");
				return;
			}
			const text = list
				.map(t => `ID: ${t.id} | Name: ${t.name} | Status: ${statusEmoji[t.status]} ${t.status} | Players: ${t.players.length}`)
				.join("\n");
			await msg.reply(`**Active Tournaments**\n\`\`\`\n${text}\`\`\``);
			return;
		}

		// Determine if we're viewing or changing status
		let id: string;
		let newStatusString: string | undefined;

		if (args.length === 1) {
			// One arg - could be tournament ID or status
			const possibleStatuses = ["preparing", "in", "progress", "ipr", "complete"];
			const firstArgLower = args[0].toLowerCase();

			if (possibleStatuses.includes(firstArgLower)) {
				// First arg is a status, no id provided
				id = await resolveTournamentId(undefined, msg.guildId);
				newStatusString = args[0];
			} else {
				// First arg is tournament ID - viewing status
				id = await resolveTournamentId(args[0], msg.guildId);
			}
		} else {
			// 2+ args: treat as [id] <newStatus>
			const possibleStatuses = ["preparing", "in", "progress", "ipr", "complete"];
			const firstArgLower = args[0].toLowerCase();

			if (possibleStatuses.includes(firstArgLower)) {
				// First arg is a status, no id provided
				id = await resolveTournamentId(undefined, msg.guildId);
				newStatusString = args.join(" ");
			} else {
				// First arg is id, rest is status
				id = await resolveTournamentId(args[0], msg.guildId);
				newStatusString = args.slice(1).join(" ");
			}
		}

		// Authenticate as host - required for all status operations
		await support.database.authenticateHost(id, msg.author.id, msg.guildId, undefined, isTournamentHost(msg.member, id));

		// If no new status, show current status with check-in summary
		if (!newStatusString) {
			const tournament = await support.database.getTournament(id);
			const checkInSummary = await getCheckInSummary(id);

			await msg.reply(`**${tournament.name}** Status\nCurrent Status: ${statusEmoji[tournament.status]} **${tournament.status}**${checkInSummary}`);
			return;
		}

		// Parse the new status
		let newStatus: TournamentStatus;
		const statusLower = newStatusString.toLowerCase().trim();

		if (statusLower === "preparing" || statusLower === "pending") {
			newStatus = TournamentStatus.PREPARING;
		} else if (statusLower === "in progress" || statusLower === "ipr" || statusLower === "underway") {
			newStatus = TournamentStatus.IPR;
		} else if (statusLower === "complete" || statusLower === "completed" || statusLower === "finished") {
			newStatus = TournamentStatus.COMPLETE;
		} else {
			await msg.reply(
				`❌ **Invalid Status**\n\n` +
				`Available statuses:\n` +
				`• \`preparing\` - Tournament is being set up\n` +
				`• \`in progress\` (or \`ipr\`) - Tournament is running\n` +
				`• \`complete\` - Tournament has finished\n\n` +
				`Usage: \`!status [id] <new_status>\``
			);
			return;
		}

		// Update the status
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: id } });
		if (!tournament) {
			await msg.reply(`❌ Tournament \`${id}\` not found.`);
			return;
		}

		const oldStatus = tournament.status;
		tournament.status = newStatus;
		await tournament.save();

		logger.info(`Tournament ${id} status changed from ${oldStatus} to ${newStatus} by ${msg.author.id}`);

		await msg.reply(
			`✅ **Tournament Status Updated**\n\n` +
			`**${tournament.name}**\n` +
			`${statusEmoji[oldStatus]} ${oldStatus} → ${statusEmoji[newStatus]} **${newStatus}**`
		);
	}
};

export default command;
