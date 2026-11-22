import { Router, Request, Response } from "express";
import { MatchSchedule } from "../../database/orm/MatchSchedule";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { parseCSVRow, parseDateTime } from "../../util";
import { getLogger } from "../../util/logger";
import { WebsiteWrapperChallonge } from "../../website/challonge";
import { getConfig } from "../../config";

const router = Router();
const logger = getLogger("web:schedules");

// Helper to safely get string from params
function getIdParam(params: any, key: string = 'id'): string {
	const id = params[key];
	return Array.isArray(id) ? id[0] : id;
}

// Helper to validate tournament exists
async function validateTournament(tournamentId: string): Promise<ChallongeTournament | null> {
	return ChallongeTournament.findOne({
		where: { tournamentId }
	});
}

// API: Get all schedules for a tournament
router.get("/api/tournaments/:id/schedules", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		const schedules = await MatchSchedule.find({
			where: { tournamentId },
			order: { scheduledTime: "ASC" }
		});

		// Create single Challonge client for this request
		const config = getConfig();
		const challonge = new WebsiteWrapperChallonge(
			config.challongeUsername,
			config.challongeToken
		);

		// Fetch Challonge tournament data (participants and matches)
		let playerMap = new Map<number, string>();
		let challongeMatches: any[] = []; // Type: ChallongeMatch[] from getTournament()

		try {
			if (!tournament.challongeTournamentId) {
				throw new Error("This tournament has no Challonge bracket yet.");
			}
			const tournamentData = await challonge.getTournament(tournament.challongeTournamentId);

			// Build player ID -> name map
			playerMap = new Map(tournamentData.players.map(p => [p.challongeId, p.name]));

			// Get matches array - need to fetch separately since getTournament doesn't include matches
			challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);
		} catch (error) {
			logger.error("Failed to fetch Challonge data:", error);
			// Continue with empty data - will show 'TBD' for all player names
		}

		// Create match ID -> player IDs and round map
		const matchMap = new Map<number, { player1: number | null; player2: number | null, round: number }>();
		for (const cm of challongeMatches) {
			matchMap.set(cm.matchId, {
				player1: cm.player1 ?? null,
				player2: cm.player2 ?? null,
				round: cm.round
			});
		}

		// Default player name for TBD cases
		const DEFAULT_PLAYER_NAME = 'TBD';

		res.json({
			success: true,
			data: schedules.map(s => {
				const matchData = matchMap.get(s.matchId);
				const player1Name = matchData?.player1 ? playerMap.get(matchData.player1) : null;
				const player2Name = matchData?.player2 ? playerMap.get(matchData.player2) : null;

				return {
					id: s.id,
					matchId: s.matchId,
					round: s.roundNumber ?? matchData?.round ?? 0,
					scheduledTime: s.scheduledTime,
					player1Name: player1Name ?? DEFAULT_PLAYER_NAME,
					player2Name: player2Name ?? DEFAULT_PLAYER_NAME,
					notified: s.notified,
					threadId: s.threadId,
					channelId: s.channelId,
					guildId: tournament.owningDiscordServer,
				};
			})
		});
	} catch (error) {
		logger.error("Failed to fetch schedules:", error);
		res.status(500).json({ success: false, error: "Failed to fetch schedules" });
	}
});

// API: Create a schedule
router.post("/api/tournaments/:id/schedules", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const { matchId, scheduledTime, timezone } = req.body;

		if (!matchId || !scheduledTime) {
			return res.status(400).json({
				success: false,
				error: "Missing required fields: matchId, scheduledTime"
			});
		}

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Check if schedule for this match already exists
		const existing = await MatchSchedule.findOne({
			where: { matchId, tournamentId }
		});

		if (existing) {
			return res.status(400).json({ success: false, error: "Schedule for this match already exists" });
		}

		const schedule = new MatchSchedule();
		schedule.matchId = parseInt(matchId, 10);
		schedule.tournamentId = tournamentId;

		// Try to get round number from Challonge
		try {
			const config = getConfig();
			const challonge = new WebsiteWrapperChallonge(
				config.challongeUsername,
				config.challongeToken
			);
			if (!tournament.challongeTournamentId) {
				throw new Error("This tournament has no Challonge bracket yet.");
			}
			const challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);
			const matchData = challongeMatches.find(m => m.matchId === parseInt(matchId, 10));
			if (matchData) {
				schedule.roundNumber = matchData.round;
			}
		} catch (error) {
			logger.warn("Failed to fetch round from Challonge:", error);
			// Continue without round number - it's optional
		}

		try {
			schedule.scheduledTime = parseDateTime(scheduledTime, timezone);
		} catch (err) {
			return res.status(400).json({
				success: false,
				error: `Invalid date/time: ${err instanceof Error ? err.message : String(err)}`
			});
		}

		schedule.notified = false;
		schedule.threadId = null;

		await schedule.save();

		res.json({
			success: true,
			data: {
				id: schedule.id,
				matchId: schedule.matchId,
				scheduledTime: schedule.scheduledTime,
			}
		});
	} catch (error) {
		logger.error("Failed to create schedule:", error);
		res.status(500).json({ success: false, error: "Failed to create schedule" });
	}
});

// API: Update a schedule
router.put("/api/tournaments/:id/schedules/:scheduleId", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const scheduleId = parseInt(getIdParam(req.params, 'scheduleId'), 10);
		const { scheduledTime, timezone } = req.body;

		const schedule = await MatchSchedule.findOne({
			where: { id: scheduleId, tournamentId }
		});

		if (!schedule) {
			return res.status(404).json({ success: false, error: "Schedule not found" });
		}

		if (scheduledTime !== undefined) {
			try {
				schedule.scheduledTime = parseDateTime(scheduledTime, timezone);
			} catch (err) {
				return res.status(400).json({
					success: false,
					error: `Invalid date/time: ${err instanceof Error ? err.message : String(err)}`
				});
			}
		}

		await schedule.save();

		res.json({ success: true, data: { id: schedule.id } });
	} catch (error) {
		logger.error("Failed to update schedule:", error);
		res.status(500).json({ success: false, error: "Failed to update schedule" });
	}
});

// API: Delete a schedule
router.delete("/api/tournaments/:id/schedules/:scheduleId", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const scheduleId = parseInt(getIdParam(req.params, 'scheduleId'), 10);

		const schedule = await MatchSchedule.findOne({
			where: { id: scheduleId, tournamentId }
		});

		if (!schedule) {
			return res.status(404).json({ success: false, error: "Schedule not found" });
		}

		await MatchSchedule.delete({ id: scheduleId, tournamentId });

		res.json({ success: true });
	} catch (error) {
		logger.error("Failed to delete schedule:", error);
		res.status(500).json({ success: false, error: "Failed to delete schedule" });
	}
});

// API: Import schedules from CSV
router.post("/api/tournaments/:id/schedules/import", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const { csv } = req.body;

		if (!csv) {
			return res.status(400).json({
				success: false,
				error: "Missing CSV data"
			});
		}

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		const lines = csv.trim().split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);

		if (lines.length < 2) {
			return res.status(400).json({ success: false, error: "CSV must have at least a header and one data row" });
		}

		// Parse header
		const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase());
		const matchIdIdx = headers.findIndex(h => h.includes("match") && h.includes("id"));
		const scheduledTimeIdx = headers.findIndex(h => h.includes("scheduled") || h.includes("time") || h.includes("date"));
		const timezoneIdx = headers.findIndex(h => h.includes("timezone") || h.includes("tz") || h.includes("zone"));

		if (matchIdIdx === -1 || scheduledTimeIdx === -1) {
			return res.status(400).json({
				success: false,
				error: "CSV header must contain 'match_id' and 'scheduled_time' columns"
			});
		}

		let successCount = 0;
		let updatedCount = 0;
		const errors: string[] = [];

		// Fetch Challonge matches to get round numbers (do this once for all rows)
		let challongeMatchMap = new Map<number, number>();
		try {
			const config = getConfig();
			const challonge = new WebsiteWrapperChallonge(
				config.challongeUsername,
				config.challongeToken
			);
			if (!tournament.challongeTournamentId) {
				throw new Error("This tournament has no Challonge bracket yet.");
			}
			const challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);
			challongeMatchMap = new Map(challongeMatches.map(m => [m.matchId, m.round]));
		} catch (error) {
			logger.warn("Failed to fetch Challonge matches for round numbers:", error);
			// Continue without round numbers - they're optional
		}

		// Process each row
		for (let i = 1; i < lines.length; i++) {
			const columns = parseCSVRow(lines[i]);
			const matchIdStr = columns[matchIdIdx];
			const scheduledTimeStr = columns[scheduledTimeIdx];
			const timezoneStr = timezoneIdx !== -1 ? columns[timezoneIdx] : undefined;

			if (!matchIdStr || !scheduledTimeStr) {
				errors.push(`Row ${i + 1}: Missing match_id or scheduled_time`);
				continue;
			}

			const matchId = parseInt(matchIdStr, 10);
			if (isNaN(matchId)) {
				errors.push(`Row ${i + 1}: Invalid match_id "${matchIdStr}"`);
				continue;
			}

			try {
				const scheduledDate = parseDateTime(scheduledTimeStr, timezoneStr);

				// Check if schedule already exists
				const existing = await MatchSchedule.findOne({
					where: { matchId, tournamentId }
				});

				if (existing) {
					// Update existing
					existing.scheduledTime = scheduledDate;
					// Set round number from Challonge if not already set
					if (!existing.roundNumber && challongeMatchMap.has(matchId)) {
						existing.roundNumber = challongeMatchMap.get(matchId)!;
					}
					await existing.save();
					updatedCount++;
				} else {
					// Create new
					const schedule = new MatchSchedule();
					schedule.matchId = matchId;
					schedule.tournamentId = tournamentId;
					schedule.scheduledTime = scheduledDate;
					schedule.roundNumber = challongeMatchMap.get(matchId);
					schedule.notified = false;
					await schedule.save();
					successCount++;
				}
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				errors.push(`Row ${i + 1}: ${errorMsg}`);
			}
		}

		res.json({
			success: true,
			data: {
				added: successCount,
				updated: updatedCount,
				errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
				totalErrors: errors.length
			}
		});
	} catch (error) {
		logger.error("Failed to import schedules:", error);
		res.status(500).json({ success: false, error: "Failed to import schedules" });
	}
});

// API: Download schedule template as CSV
router.get("/api/tournaments/:id/schedules/download", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		const schedules = await MatchSchedule.find({
			where: { tournamentId },
			order: { scheduledTime: "ASC" }
		});

		// Create CSV content
		const headers = 'match_id,scheduled_time,timezone,round,teams';
		const rows = schedules.map(s => {
			const date = new Date(s.scheduledTime);
			const formattedTime = date.getFullYear() + '-' +
				String(date.getMonth() + 1).padStart(2, '0') + '-' +
				String(date.getDate()).padStart(2, '0') + ' ' +
				String(date.getHours()).padStart(2, '0') + ':' +
				String(date.getMinutes()).padStart(2, '0') + ':' +
				String(date.getSeconds()).padStart(2, '0');
			const round = s.roundNumber || '';
			return `${s.matchId},${formattedTime},UTC,${round},`;
		});

		const csvContent = [headers, ...rows].join('\n');

		// Set headers for download
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="schedules-template-${tournamentId}.csv"`);
		res.send(csvContent);
	} catch (error) {
		logger.error("Failed to download schedule template:", error);
		res.status(500).json({ success: false, error: "Failed to download template" });
	}
});

// API: Download blank schedule template as CSV
router.get("/api/tournaments/:id/schedules/download-blank", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Create blank CSV with examples
		const headers = 'match_id,scheduled_time,timezone,round,teams';
		const exampleRows = [
			'448723392,2026-03-13 18:00:00,IST,1,"Team Alpha vs Team Beta"',
			'448723393,2026-03-13 19:00:00,IST,1,"Team Gamma vs Team Delta"',
			'448723394,2026-03-14 14:00:00,IST,2,"Team Alpha vs Team Gamma"',
			'448723395,2026-03-14 15:00:00,IST,2,"Team Beta vs Team Delta"'
		];
		const csvContent = [headers, ...exampleRows].join('\n');

		// Set headers for download
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', 'attachment; filename="schedules-template.csv"');
		res.send(csvContent);
	} catch (error) {
		logger.error("Failed to download blank schedule template:", error);
		res.status(500).json({ success: false, error: "Failed to download template" });
	}
});

export default router;
