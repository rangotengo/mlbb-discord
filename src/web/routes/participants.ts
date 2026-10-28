import { EntityManager } from "typeorm";
import { getIdParam } from "../params";
import { Router, Request, Response } from "express";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { parseCSV } from "../../util";
import { getLogger } from "../../util/logger";
import { previewParticipants } from "../../services/importPreview";

const router = Router();
const logger = getLogger("web:participants");


// Helper to validate tournament exists
async function validateTournament(tournamentId: string): Promise<ChallongeTournament | null> {
	return ChallongeTournament.findOne({
		where: { tournamentId }
	});
}

// API: Get all participants for a tournament
router.get("/api/tournaments/:id/participants", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		const participants = await EnrolledPlayer.find({
			where: { tournamentId }
		});

		res.json({
			success: true,
			data: participants.map(p => ({
				id: p.id,
				email: p.email,
				name: p.name,
				team: p.team,
				discordUsername: p.discordUsername,
				discordId: p.discordId,
				verified: p.verified,
				challongeId: p.challongeId,
			}))
		});
	} catch (error) {
		logger.error("Failed to fetch participants:", error);
		res.status(500).json({ success: false, error: "Failed to fetch participants" });
	}
});

// API: Create a participant
router.post("/api/tournaments/:id/participants", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const { email, name, team, discordUsername } = req.body;

		if (!email || !name || !team) {
			return res.status(400).json({
				success: false,
				error: "Missing required fields: email, name, team"
			});
		}

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Check if participant with this email already exists (case-insensitive)
		const normalizedEmail = email.trim().toLowerCase();
		const existing = await EnrolledPlayer.createQueryBuilder("player")
			.where("player.tournamentId = :tournamentId", { tournamentId })
			.andWhere("LOWER(player.email) = LOWER(:email)", { email: normalizedEmail })
			.getOne();

		if (existing) {
			return res.status(400).json({ success: false, error: "Participant with this email already exists" });
		}

		const participant = new EnrolledPlayer();
		participant.tournamentId = tournamentId;
		participant.email = normalizedEmail;
		participant.name = name;
		participant.team = team;
		participant.discordUsername = discordUsername || null;
		participant.verified = false;
		participant.emailSent = 0;

		await participant.save();

		res.json({
			success: true,
			data: {
				id: participant.id,
				email: participant.email,
				name: participant.name,
				team: participant.team,
			}
		});
	} catch (error) {
		logger.error("Failed to create participant:", error);
		res.status(500).json({ success: false, error: "Failed to create participant" });
	}
});

// API: Update a participant
router.put("/api/tournaments/:id/participants/:participantId", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const participantId = parseInt(getIdParam(req.params, 'participantId'), 10);

		const participant = await EnrolledPlayer.findOne({
			where: { id: participantId, tournamentId }
		});

		if (!participant) {
			return res.status(404).json({ success: false, error: "Participant not found" });
		}

		const { name, team, discordUsername, verified } = req.body;

		if (name !== undefined) participant.name = name;
		if (team !== undefined) participant.team = team;
		if (discordUsername !== undefined) if (discordUsername) participant.discordUsername = discordUsername;
		if (verified !== undefined) participant.verified = verified;

		await participant.save();

		res.json({ success: true, data: { id: participant.id } });
	} catch (error) {
		logger.error("Failed to update participant:", error);
		res.status(500).json({ success: false, error: "Failed to update participant" });
	}
});

// API: Delete a participant
router.delete("/api/tournaments/:id/participants/:participantId", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const participantId = parseInt(getIdParam(req.params, 'participantId'), 10);

		const participant = await EnrolledPlayer.findOne({
			where: { id: participantId, tournamentId }
		});

		if (!participant) {
			return res.status(404).json({ success: false, error: "Participant not found" });
		}

		await EnrolledPlayer.delete({ id: participantId, tournamentId });

		res.json({ success: true });
	} catch (error) {
		logger.error("Failed to delete participant:", error);
		res.status(500).json({ success: false, error: "Failed to delete participant" });
	}
});

router.post("/api/tournaments/:id/participants/preview", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		if (!req.body.csv) return res.status(400).json({ success: false, error: "Missing CSV data" });
		if (!await validateTournament(tournamentId)) return res.status(404).json({ success: false, error: "Tournament not found" });
		const preview = await previewParticipants(tournamentId, req.body.csv);
		if ("error" in preview) return res.status(400).json({ success: false, error: preview.error });
		res.json({ success: true, data: preview });
	} catch (error) {
		logger.error("Failed to preview participants:", error);
		res.status(500).json({ success: false, error: "Failed to preview participants" });
	}
});

router.get("/api/tournaments/:id/participants/corrections", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		if (!await validateTournament(tournamentId)) return res.status(404).json({ success: false, error: "Tournament not found" });
		const preview = await previewParticipants(tournamentId, String(req.query.csv || ""));
		if ("error" in preview) return res.status(400).json({ success: false, error: preview.error });
		const rejected = preview.rows.filter(row => row.status === "rejected");
		const csv = ["row,reason,email,name,team", ...rejected.map(row =>
			[row.row, row.reason || "", row.values.email, row.values.name, row.values.team].map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")
		)].join("\n");
		res.setHeader("Content-Type", "text/csv; charset=utf-8");
		res.send(csv);
	} catch (error) {
		logger.error("Failed to build participant corrections:", error);
		res.status(500).json({ success: false, error: "Failed to build corrections" });
	}
});

// API: Import participants from CSV
router.post("/api/tournaments/:id/participants/import", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const { csv, registerToChallonge } = req.body;
		if (registerToChallonge) {
			return res.status(400).json({ success: false, error: "Register teams on Challengermode, then sync the tournament. CSV import only enrolls players in this bot." });
		}

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
		const emailIdx = headers.findIndex(h => h.includes("email"));
		const nameIdx = headers.findIndex(h => ["name", "player name", "playername", "player_name"].includes(h));
		const teamIdx = headers.findIndex(h => h.includes("team"));
		const discordUsernameIdx = headers.findIndex(h => h === "discord username" || h === "discordusername" || h === "discord");
		const discordIdIdx = headers.findIndex(h => h === "discord id" || h === "discordid");

		if (emailIdx === -1 || nameIdx === -1 || teamIdx === -1) {
			return res.status(400).json({
				success: false,
				error: "CSV header must contain 'email', 'name', and 'team' columns"
			});
		}

		const mode = req.body.mode === "all-or-nothing" ? "all-or-nothing" : "partial";
		const preview = await previewParticipants(tournamentId, csv);
		if ("error" in preview) return res.status(400).json({ success: false, error: preview.error });
		if (mode === "all-or-nothing" && preview.rejected > 0) {
			return res.status(400).json({ success: false, error: "Import rejected because one or more rows are invalid", data: preview });
		}
		const acceptedRows = new Set(preview.rows.filter(row => row.status !== "rejected").map(row => row.row));
		let addedCount = 0;
		let updatedCount = 0;
		const errors: string[] = preview.rows.filter(row => row.status === "rejected").map(row => `Row ${row.row}: ${row.reason}`);

		const applyRows = async (manager: EntityManager): Promise<void> => {
		// Process each row
		for (let i = 1; i < lines.length; i++) {
			const columns = lines[i];
			const email = columns[emailIdx];
			const name = columns[nameIdx];
			const team = columns[teamIdx];
			const discordUsername = discordUsernameIdx !== -1 ? columns[discordUsernameIdx] : undefined;
			const discordId = discordIdIdx !== -1 ? columns[discordIdIdx]?.trim() : undefined;

			if (!acceptedRows.has(i + 1)) continue;

			try {
				const normalizedEmail = email.trim().toLowerCase();
				let participant = await manager.createQueryBuilder(EnrolledPlayer, "player")
					.where("player.tournamentId = :tournamentId", { tournamentId })
					.andWhere("LOWER(player.email) = LOWER(:email)", { email: normalizedEmail })
					.getOne();

				if (!participant) {
					participant = new EnrolledPlayer();
					participant.tournamentId = tournamentId;
					addedCount++;
				} else {
					updatedCount++;
				}
				// Always normalize email on every import (fixes previously stored mixed-case/whitespace emails)
				participant.email = normalizedEmail;

				participant.name = name;
				participant.team = team;
				if (discordUsername) participant.discordUsername = discordUsername;

				// Imported IDs are hints, not proof of account ownership.
				if (discordId) {
					participant.discordId = discordId;
				} else {
					participant.verified = participant.verified || false;
				}

				await manager.save(participant);
			} catch (err) {
				if (mode === "all-or-nothing") throw err;
				const errorMsg = err instanceof Error ? err.message : String(err);
				errors.push(`Row ${i + 1}: ${errorMsg}`);
			}
		}

		};
		if (mode === "all-or-nothing") await EnrolledPlayer.getRepository().manager.transaction(applyRows);
		else await applyRows(EnrolledPlayer.getRepository().manager);

		res.json({
			success: true,
			data: {
				added: addedCount,
				updated: updatedCount,
				unchanged: preview.unchanged,
				errors: errors.length > 0 ? errors : undefined,
				totalErrors: errors.length,
				rows: preview.rows
			}
		});
	} catch (error) {
		logger.error("Failed to import participants:", error);
		res.status(500).json({ success: false, error: "Failed to import participants" });
	}
});

// API: Download participant template as CSV
router.get("/api/tournaments/:id/participants/download-template", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Create blank CSV with examples
		const headers = 'email,name,team,discord username,discord id';
		const exampleRows = [
			'captain1@example.com,John Doe,Team Alpha,johndoe,123456789',
			'captain2@example.com,Jane Smith,Team Beta,janesmith,',
			'captain3@example.com,Bob Wilson,Team Gamma,,'
		];
		const csvContent = [headers, ...exampleRows].join('\n');

		// Set headers for download
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', 'attachment; filename="participants-template.csv"');
		res.send(csvContent);
	} catch (error) {
		logger.error("Failed to download participant template:", error);
		res.status(500).json({ success: false, error: "Failed to download template" });
	}
});

export default router;
