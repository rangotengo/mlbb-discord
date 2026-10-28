import { EntityManager } from "typeorm";
import { formatCSVDate, formatCSVRow } from "../../util/csv";
import { getIdParam } from "../params";
import { UUID_PATTERN, WebsiteMatch } from "../../website/challengermode";
import { Router, Request, Response } from "express";
import { MatchSchedule } from "../../database/orm/MatchSchedule";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { parseCSV, parseDateTime } from "../../util";
import { getLogger } from "../../util/logger";
import { previewSchedules } from "../../services/importPreview";
import { getTournamentApi } from "../../website/challengermode";
import { getConfig } from "../../config";

const router = Router();
const logger = getLogger("web:schedules");


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

		// Create single Challengermode client for this request
		const config = getConfig();
		const challonge = getTournamentApi(config.challengermodeRefreshKey);

		// Fetch Challengermode tournament data (participants and matches)
		let playerMap = new Map<string, string>();
		let challongeMatches: WebsiteMatch[] = [];

		try {
			const tournamentData = await challonge.getTournament(tournament.challongeTournamentId);

			// Build player ID -> name map
			playerMap = new Map(tournamentData.players.map(p => [p.challongeId, p.name]));

			// Get matches array - need to fetch separately since getTournament doesn't include matches
			challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);
		} catch (error) {
			logger.error("Failed to fetch Challengermode data:", error);
			// Continue with empty data - will show 'TBD' for all player names
		}

		// Create match ID -> player IDs and round map
		const matchMap = new Map<string, { player1: string | null; player2: string | null, round: number }>();
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

router.get("/api/tournaments/:id/matches", async (req: Request, res: Response) => {
	try {
		const tournament = await validateTournament(getIdParam(req.params));
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const config = getConfig();
		const api = getTournamentApi(config.challengermodeRefreshKey);
		const [details, matches] = await Promise.all([
			api.getTournament(tournament.challongeTournamentId),
			api.getMatches(tournament.challongeTournamentId)
		]);
		const names = new Map(details.players.map(player => [player.challongeId, player.name]));
		res.json({
			success: true,
			source: "challengermode",
			fetchedAt: new Date().toISOString(),
			data: matches.map(match => ({
				matchId: match.matchId,
				round: match.round,
				player1Name: match.player1 ? names.get(match.player1) || "TBD" : "TBD",
				player2Name: match.player2 ? names.get(match.player2) || "TBD" : "TBD",
				scheduledTime: match.scheduledTime || null,
				state: match.state
			}))
		});
	} catch (error) {
		logger.warn("Failed to fetch tournament matches:", error);
		res.status(503).json({ success: false, error: "Challengermode is unavailable" });
	}
});

// API: Create a schedule
router.post("/api/tournaments/:id/schedules", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const { scheduledTime, timezone } = req.body;
		const matchId = typeof req.body.matchId === "string" ? req.body.matchId.trim().toLowerCase() : "";

		if (!UUID_PATTERN.test(matchId) || !scheduledTime) {
			return res.status(400).json({
				success: false,
				error: "Provide a Challengermode match series UUID and scheduledTime"
			});
		}

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}
		try {
			parseDateTime(scheduledTime, timezone);
		} catch (error) {
			return res.status(400).json({ success: false, error: `Invalid date/time: ${error instanceof Error ? error.message : String(error)}` });
		}
		const configuredKey = getConfig().challengermodeRefreshKey.trim();
		if (configuredKey) try {
			const api = getTournamentApi(configuredKey);
			const matches = await api.getMatches(tournament.challongeTournamentId);
			if (!matches.some(match => match.matchId === matchId)) {
				return res.status(400).json({ success: false, error: "That match does not belong to this tournament" });
			}
		} catch (error) {
			logger.warn("Match ownership could not be validated:", error);
			return res.status(503).json({ success: false, error: "Challengermode is unavailable, so this schedule was not saved. Try again when the connection is restored." });
		}

		// Check if schedule for this match already exists
		const existing = await MatchSchedule.findOne({
			where: { matchId, tournamentId }
		});

		if (existing) {
			return res.status(400).json({ success: false, error: "Schedule for this match already exists" });
		}

		const schedule = new MatchSchedule();
		schedule.matchId = String(matchId).trim().toLowerCase();
		schedule.tournamentId = tournamentId;

		// Try to get round number from Challengermode
		try {
			const config = getConfig();
			const challonge = getTournamentApi(config.challengermodeRefreshKey);
			const challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);
			const matchData = challongeMatches.find(m => m.matchId === String(matchId).trim().toLowerCase());
			if (matchData) {
				schedule.roundNumber = matchData.round;
			}
		} catch (error) {
			logger.warn("Failed to fetch round from Challengermode:", error);
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

router.post("/api/tournaments/:id/schedules/preview", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		if (!req.body.csv) return res.status(400).json({ success: false, error: "Missing CSV data" });
		if (!await validateTournament(tournamentId)) return res.status(404).json({ success: false, error: "Tournament not found" });
		const preview = await previewSchedules(tournamentId, req.body.csv);
		if ("error" in preview) return res.status(400).json({ success: false, error: preview.error });
		res.json({ success: true, data: preview });
	} catch (error) {
		logger.error("Failed to preview schedules:", error);
		res.status(500).json({ success: false, error: "Failed to preview schedules" });
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

		const lines = parseCSV(csv);

		if (lines.length < 2) {
			return res.status(400).json({ success: false, error: "CSV must have at least a header and one data row" });
		}

		// Parse header
		const headers = lines[0].map(h => h.toLowerCase());
		const matchIdIdx = headers.findIndex(h => h.includes("match") && h.includes("id"));
		const scheduledTimeIdx = headers.findIndex(h => h.includes("scheduled") || h.includes("time") || h.includes("date"));
		const timezoneIdx = headers.findIndex(h => h.includes("timezone") || h.includes("tz") || h.includes("zone"));

		if (matchIdIdx === -1 || scheduledTimeIdx === -1) {
			return res.status(400).json({
				success: false,
				error: "CSV header must contain 'match_id' and 'scheduled_time' columns"
			});
		}

		const mode = req.body.mode === "all-or-nothing" ? "all-or-nothing" : "partial";
		let knownMatches: Set<string> | undefined;
		if (getConfig().challengermodeRefreshKey) {
			try {
				knownMatches = new Set((await getTournamentApi(getConfig().challengermodeRefreshKey).getMatches(tournament.challongeTournamentId)).map(match => match.matchId));
			} catch {
				return res.status(503).json({ success: false, error: "Could not validate tournament matches. Retry when Challengermode is available." });
			}
		}
		const preview = await previewSchedules(tournamentId, csv, knownMatches);
		if ("error" in preview) return res.status(400).json({ success: false, error: preview.error });
		if (mode === "all-or-nothing" && preview.rejected > 0) {
			return res.status(400).json({ success: false, error: "Import rejected because one or more rows are invalid", data: preview });
		}
		const acceptedRows = new Set(preview.rows.filter(row => row.status !== "rejected").map(row => row.row));
		let successCount = 0;
		let updatedCount = 0;
		const errors: string[] = preview.rows.filter(row => row.status === "rejected").map(row => `Row ${row.row}: ${row.reason}`);

		// Fetch Challengermode matches to get round numbers (do this once for all rows)
		let challongeMatchMap = new Map<string, number>();
		try {
			const config = getConfig();
			const challonge = getTournamentApi(config.challengermodeRefreshKey);
			const challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);
			challongeMatchMap = new Map(challongeMatches.map(m => [m.matchId, m.round]));
		} catch (error) {
			logger.warn("Failed to fetch Challengermode matches for round numbers:", error);
			// Continue without round numbers - they're optional
		}

		const applyRows = async (manager: EntityManager): Promise<void> => {
		// Process each row
		for (let i = 1; i < lines.length; i++) {
			const columns = lines[i];
			const matchIdStr = columns[matchIdIdx];
			const scheduledTimeStr = columns[scheduledTimeIdx];
			const timezoneStr = timezoneIdx !== -1 ? columns[timezoneIdx] : undefined;

			if (!acceptedRows.has(i + 1)) continue;

			const matchId = matchIdStr.trim().toLowerCase();
			if (!UUID_PATTERN.test(matchId)) {
				errors.push(`Row ${i + 1}: Invalid match_id "${matchIdStr}"`);
				continue;
			}

			try {
				const scheduledDate = parseDateTime(scheduledTimeStr, timezoneStr);

				// Check if schedule already exists
				const existing = await manager.findOne(MatchSchedule, {
					where: { matchId, tournamentId }
				});

				if (existing) {
					// Update existing
					existing.scheduledTime = scheduledDate;
					// Set round number from Challengermode if not already set
					if (!existing.roundNumber && challongeMatchMap.has(matchId)) {
						existing.roundNumber = challongeMatchMap.get(matchId)!;
					}
					await manager.save(existing);
					updatedCount++;
				} else {
					// Create new
					const schedule = new MatchSchedule();
					schedule.matchId = matchId;
					schedule.tournamentId = tournamentId;
					schedule.scheduledTime = scheduledDate;
					schedule.roundNumber = challongeMatchMap.get(matchId);
					schedule.notified = false;
					await manager.save(schedule);
					successCount++;
				}
			} catch (err) {
				if (mode === "all-or-nothing") throw err;
				const errorMsg = err instanceof Error ? err.message : String(err);
				errors.push(`Row ${i + 1}: ${errorMsg}`);
			}
		}

		};
		if (mode === "all-or-nothing") await MatchSchedule.getRepository().manager.transaction(applyRows);
		else await applyRows(MatchSchedule.getRepository().manager);

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
			return formatCSVRow([s.matchId, formatCSVDate(s.scheduledTime), "UTC", s.roundNumber ?? "", ""]);
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
			'00000000-0000-0000-0000-000000000001,2026-03-13 18:00:00,IST,1,"Team Alpha vs Team Beta"',
			'00000000-0000-0000-0000-000000000002,2026-03-13 19:00:00,IST,1,"Team Gamma vs Team Delta"',
			'00000000-0000-0000-0000-000000000003,2026-03-14 14:00:00,IST,2,"Team Alpha vs Team Gamma"',
			'00000000-0000-0000-0000-000000000004,2026-03-14 15:00:00,IST,2,"Team Beta vs Team Delta"'
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
