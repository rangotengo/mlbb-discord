import { formatCSVDate, formatCSVRow } from "../util/csv";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";
import { MatchSchedule } from "../database/orm/MatchSchedule";
import { In } from "typeorm";

const logger = getLogger("command:matches");

const command: CommandDefinition = {
	name: "matches",
	requiredArgs: [],
	optionalArgs: ["id", "download"],
	executor: async (msg, args, support) => {
		// Check if download flag is present
		const downloadIndex = args.indexOf("download");
		const shouldDownload = downloadIndex !== -1;

		// Remove download from args if present
		const filteredArgs = shouldDownload ? args.filter((_, i) => i !== downloadIndex) : args;

		const [providedId] = filteredArgs;
		const id = await resolveTournamentId(providedId, msg.guildId);

		// Verify host permissions
		const tournament = await support.database.authenticateHost(
			id,
			msg.author.id,
			msg.guildId,
			undefined, // No status restriction for viewing matches
			isTournamentHost(msg.member, id)
		);

		// Use the actual Challengermode tournament ID to query Challengermode API
		const challongeId = tournament.challongeTournamentId;

		const allMatches = await support.tournamentApi.getMatches(challongeId, false);
		const players = await support.tournamentApi.getPlayers(challongeId);

		// Fetch existing schedules from database for CSV export
		const matchIds = allMatches.map(m => m.matchId);
		const schedules = await MatchSchedule.find({
			where: { tournamentId: id, matchId: In(matchIds) }
		});
		const scheduleMap = new Map(schedules.map(s => [s.matchId, s]));

		// Handle CSV export if requested
		if (shouldDownload) {
			// Generate CSV content
			const csvHeader = "match_id,match,scheduled_time,timezone\n";
			const csvRows = allMatches.map(match => {
				const schedule = scheduleMap.get(match.matchId);
				const scheduledTime = formatCSVDate(schedule?.scheduledTime);

				// Get player names for match description
				const p1 = match.state === "pending"
					? "TBD"
					: (players.find(p => p.challongeId === match.player1)?.name || "Unknown");
				const p2 = match.state === "pending"
					? "TBD"
					: (players.find(p => p.challongeId === match.player2)?.name || "Unknown");
				const matchDesc = `${p1} vs ${p2}`;

				return formatCSVRow([match.matchId, matchDesc, scheduledTime, "UTC"]);
			});
			const csvContent = csvHeader + csvRows.join("\n");

			// Create and send attachment
			const attachment = new AttachmentBuilder(Buffer.from(csvContent), {
				name: `${tournament.name}_schedule.csv`
			});

			await msg.reply({
				content: `📥 Schedule export for **${tournament.name}** (${allMatches.length} matches)`,
				files: [attachment]
			});

			logger.info(JSON.stringify({
				tournament: id,
				command: "matches",
				action: "download",
				user: msg.author.id,
				event: "complete"
			}));
			return;
		}

		// Group matches by round
		const roundsMap = new Map<number, typeof allMatches>();
		for (const match of allMatches) {
			if (!roundsMap.has(match.round)) {
				roundsMap.set(match.round, []);
			}
			roundsMap.get(match.round)!.push(match);
		}

		// Sort rounds ascending
		const sortedRounds = Array.from(roundsMap.keys()).sort((a, b) => a - b);

		if (sortedRounds.length === 0) {
			await msg.reply("No matches found for this tournament.");
			return;
		}

		// Build paginated embeds (Discord limit: 4096 chars per description)
		const EMBED_LIMIT = 4096;
		const pages: string[] = [];
		let currentPage = "";

		for (const roundNum of sortedRounds) {
			const roundMatches = roundsMap.get(roundNum)!;
			const pendingMatches = roundMatches.filter(m => m.state === "pending");
			const openMatches = roundMatches.filter(m => m.state === "open");
			const underwayMatches = roundMatches.filter(m => m.state === "underway");
			const completedMatches = roundMatches.filter(m => m.state === "complete");

			const activeCount = openMatches.length + underwayMatches.length;

			let roundBlock = `\n**Round ${roundNum}** (${activeCount} active, ${pendingMatches.length} upcoming, ${completedMatches.length} completed)\n`;

			for (const match of roundMatches) {
				const p1 = match.state === "pending" ? "TBD" : (players.find(p => p.challongeId === match.player1)?.name || "Unknown");
				const p2 = match.state === "pending" ? "TBD" : (players.find(p => p.challongeId === match.player2)?.name || "Unknown");

				const statusEmoji = {
					pending: "⏳",
					open: "🔓",
					underway: "🎮",
					complete: "✅"
				}[match.state];

				const statusText = {
					pending: "Upcoming",
					open: "Open",
					underway: "In Progress",
					complete: "Completed"
				}[match.state];

				// Add thread link if exists
				const schedule = scheduleMap.get(match.matchId);
				const threadLink = schedule?.threadId ? ` [<#${schedule.threadId}>]` : "";

				roundBlock += `  \`Match ${match.matchId}\` **${p1}** vs **${p2}** - ${statusEmoji} ${statusText}\n${threadLink}\n`;
			}
			roundBlock += "\n";

			// If adding this round would overflow the page, flush and start a new one
			if ((currentPage + roundBlock).length > EMBED_LIMIT) {
				if (currentPage.trim()) pages.push(currentPage.trim());
				currentPage = roundBlock;
			} else {
				currentPage += roundBlock;
			}
		}
		if (currentPage.trim()) pages.push(currentPage.trim());

		// Build one embed per page
		const embeds = pages.map((pageContent, i) =>
			new EmbedBuilder()
				.setTitle(i === 0 ? `📊 Matches for ${tournament.name}` : `📊 Matches for ${tournament.name} (cont.)`)
				.setDescription(pageContent)
				.setColor("#3498db")
				.setFooter(pages.length > 1 ? { text: `Page ${i + 1} of ${pages.length}` } : null)
		);

		// Discord allows up to 10 embeds per message; send in batches if needed
		for (let i = 0; i < embeds.length; i += 10) {
			const batch = embeds.slice(i, i + 10);
			if (i === 0) {
				await msg.reply({ embeds: batch });
			} else {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				await (msg.channel as any).send({ embeds: batch });
			}
		}

		logger.info(JSON.stringify({
			tournament: id,
			command: "matches",
			user: msg.author.id,
			event: "complete"
		}));
	}
};

export default command;
