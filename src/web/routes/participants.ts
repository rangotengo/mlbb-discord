import { Router, Request, Response } from "express";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { parseParticipantImport, TEAM_IMPORT_HEADERS } from "../../util/participantImport";
import { getLogger } from "../../util/logger";
import { In } from "typeorm";

const router = Router();
const logger = getLogger("web:participants");

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
		if (discordUsername !== undefined) participant.discordUsername = discordUsername;
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

// API: Import participants from CSV
router.post("/api/tournaments/:id/participants/import", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const { csv, registerToChallonge } = req.body;

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

		let parsed: ReturnType<typeof parseParticipantImport>;
		try {
			parsed = parseParticipantImport(csv);
		} catch (error) {
			return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Invalid participant data" });
		}

		let addedCount = 0;
		let updatedCount = 0;
		const errors: string[] = [...parsed.errors];

		// Expand each team row into individual player records.
		for (const { email, name, team, discordUsername, discordId, source } of parsed.players) {

			try {
				const normalizedEmail = email.trim().toLowerCase();
				let participant = await EnrolledPlayer.createQueryBuilder("player")
					.where("player.tournamentId = :tournamentId", { tournamentId })
					.andWhere("LOWER(player.email) = LOWER(:email)", { email: normalizedEmail })
					.getOne();

				const isNew = !participant;
				if (!participant) {
					participant = new EnrolledPlayer();
					participant.tournamentId = tournamentId;
				}
				// Always normalize email on every import (fixes previously stored mixed-case/whitespace emails)
				participant.email = normalizedEmail;

				participant.name = name;
				participant.team = team;
				participant.discordUsername = discordUsername;

				// Save imported identity; sync-roles verifies membership and assigns roles.
				if (discordId) {
					participant.discordId = discordId;
				} else {
					participant.verified = participant.verified || false;
				}

				await participant.save();
				if (isNew) addedCount++; else updatedCount++;
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				errors.push(`${source}: ${errorMsg}`);
			}
		}

		res.json({
			success: true,
			data: {
				added: addedCount,
				updated: updatedCount,
				errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
				totalErrors: errors.length
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

		const example = ["Team Alpha", ...Array.from({ length: 6 }, (_, i) =>
			[`player${i + 1}@example.com`, `player${i + 1}`, `Player ${i + 1}`]).flat()];
		const csvContent = [TEAM_IMPORT_HEADERS.join(','), example.join(',')].join('\n');

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
