import { UUID_PATTERN } from "../website/challengermode";
import { CommandDefinition } from "../Command";
import { TournamentStatus } from "../database/interface";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";
import { downloadAndValidateCSV, parseCSV } from "../util";
import { MatchSchedule } from "../database/orm/MatchSchedule";
import { parseDateTime } from "../util/parseDateTime";

const logger = getLogger("command:schedule");

const command: CommandDefinition = {
	name: "schedule",
	requiredArgs: [],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		const [providedId] = args;
		const id = await resolveTournamentId(providedId, msg.guildId);

		// Verify host permissions
		const tournament = await support.database.authenticateHost(
			id,
			msg.author.id,
			msg.guildId,
			TournamentStatus.IPR,
			isTournamentHost(msg.member, id)
		);

		// Check for CSV attachment
		const attachment = msg.attachments.first();
		let csvText: string;
		try {
			csvText = await downloadAndValidateCSV(attachment);
		} catch (err) {
			if (err instanceof Error) {
				await msg.reply(err.message);
			} else {
				await msg.reply("Failed to process CSV file.");
			}
			return;
		}

		const lines = parseCSV(csvText);

		// Parse header to find column indices
		const headers = lines[0].map(h => h.toLowerCase());
		const matchIdIdx = headers.findIndex(h => h.includes("match") && h.includes("id"));
		const scheduledTimeIdx = headers.findIndex(h => h.includes("scheduled") || h.includes("time") || h.includes("date"));
		const timezoneIdx = headers.findIndex(h => h.includes("timezone") || h.includes("tz") || h.includes("zone"));

		if (matchIdIdx === -1 || scheduledTimeIdx === -1) {
			await msg.reply("CSV header must contain 'match_id' and 'scheduled_time' columns.");
			return;
		}

		let successCount = 0;
		let failCount = 0;
		const errors: string[] = [];

		// Process each row
		for (let i = 1; i < lines.length; i++) {
			const columns = lines[i];
			const matchIdStr = columns[matchIdIdx];
			const scheduledTimeStr = columns[scheduledTimeIdx];
			const timezoneStr = timezoneIdx !== -1 ? columns[timezoneIdx] : undefined;

			if (!matchIdStr || !scheduledTimeStr) {
				failCount++;
				errors.push(`Row ${i + 1}: Missing match_id or scheduled_time`);
				continue;
			}

			const matchId = matchIdStr.trim().toLowerCase();
			if (!UUID_PATTERN.test(matchId)) {
				failCount++;
				errors.push(`Row ${i + 1}: Invalid match_id "${matchIdStr}"`);
				continue;
			}

			try {
				const scheduledDate = parseDateTime(scheduledTimeStr, timezoneStr);

				// Check if schedule already exists
				const existing = await MatchSchedule.findOne({
					where: { matchId, tournamentId: id }
				});

				if (existing) {
					// Update existing
					existing.scheduledTime = scheduledDate;
					await existing.save();
				} else {
					// Create new
					const schedule = new MatchSchedule();
					schedule.matchId = matchId;
					schedule.tournamentId = id;
					schedule.scheduledTime = scheduledDate;
					schedule.notified = false;
					await schedule.save();
				}

				successCount++;
			} catch (err) {
				failCount++;
				const errorMsg = err instanceof Error ? err.message : String(err);
				errors.push(`Row ${i + 1}: ${errorMsg}`);
				logger.error(`Failed to schedule match ${matchId}:`, err);
			}
		}

		// Send result
		const resultMsg = `Schedule import complete for **${tournament.name}**!\n✅ Successfully processed: ${successCount} match(es)\n${failCount > 0 ? `❌ Failed: ${failCount} match(es)\n` : ""}`;

		if (errors.length > 0 && errors.length <= 10) {
			await msg.reply(`${resultMsg}\n**Errors:**\n${errors.join("\n")}`);
		} else if (errors.length > 10) {
			await msg.reply(`${resultMsg}\n(First 10 errors shown)\n**Errors:**\n${errors.slice(0, 10).join("\n")}`);
		} else {
			await msg.reply(resultMsg);
		}

		logger.info(JSON.stringify({
			tournament: id,
			command: "schedule",
			user: msg.author.id,
			success: successCount,
			failed: failCount,
			event: "complete"
		}));
	}
};

export default command;
