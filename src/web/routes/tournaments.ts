import { getConnection } from "typeorm";
import { editTournament, TournamentEditError } from "../../util/editTournament";
import { getRuntimeSupport } from "../../util/runtimeSupport";
import { Router, Request, Response } from "express";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../../database/orm/MatchSchedule";
import {
	addPreCheckinTournament,
	addTournament,
	checkInAllTeams,
	checkInTeam,
	createBracketFromCheckin,
	isPreCheckinName,
	linkExistingBracket,
	openPreCheckin,
	syncTournamentWithChallonge
} from "../../util/tournament";
import { getLogger } from "../../util/logger";
import { getBotClient } from "../server";
import { getConfig } from "../../config";
import { WebsiteWrapperChallonge } from "../../website/challonge";

const router = Router();
const logger = getLogger("web:tournaments");

/**
 * Helper to safely get the Discord client or null
 */
function tryGetBotClient() {
	try {
		return getBotClient();
	} catch (e) {
		return null;
	}
}


// Helper to safely get string from params
function getIdParam(params: any): string {
	const id = params.id;
	return Array.isArray(id) ? id[0] : id;
}

// API: Get all tournaments
router.get("/api/tournaments", async (req: Request, res: Response) => {
	try {
		const tournaments = await ChallongeTournament.find();

		// Get verification counts for each tournament (count teams, not players)
		const tournamentData = await Promise.all(
			tournaments.map(async (t: ChallongeTournament) => {
				// Get all players for this tournament
				const players = await EnrolledPlayer.find({
					where: { tournamentId: t.tournamentId }
				});

				// Group by team and determine verification status
				const teamMap = new Map<string, boolean>();
				for (const player of players) {
					const existing = teamMap.get(player.team);
					// Team is verified if at least 1 player is verified
					if (existing === undefined || !existing) {
						teamMap.set(player.team, player.verified);
					}
				}

				// Count verified and unverified teams
				let verifiedCount = 0;
				let unverifiedCount = 0;
				for (const [, isVerified] of teamMap) {
					if (isVerified) {
						verifiedCount++;
					} else {
						unverifiedCount++;
					}
				}

				return {
					id: t.tournamentId,
					challongeId: t.challongeTournamentId,
					name: t.name,
					description: t.description,
					status: t.status,
					format: t.format,
					server: t.owningDiscordServer,
					hosts: t.hosts,
					participantCount: 0,
					verifiedCount,
					unverifiedCount,
					checkInDisabled: t.checkInDisabled,
					phase: t.phase,
					checkedInCount: t.checkedInTeams?.length || 0,
					hasBracket: t.hasChallongeBracket(),
				};
			})
		);

		res.json({
			success: true,
			data: tournamentData
		});
	} catch (error) {
		logger.error("Failed to fetch tournaments:", error);
		res.status(500).json({ success: false, error: "Failed to fetch tournaments" });
	}
});

// API: Get single tournament with details
router.get("/api/tournaments/:id", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);
		const tournament = await ChallongeTournament.findOne({
			where: { tournamentId: id }
		});

		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Get enrolled players count
		const enrolledCount = await EnrolledPlayer.count({
			where: { tournamentId: id }
		});

		// Get team verification counts (team is verified if at least 1 player is verified)
		const players = await EnrolledPlayer.find({
			where: { tournamentId: id }
		});

		const teamMap = new Map<string, boolean>();
		for (const player of players) {
			const existing = teamMap.get(player.team);
			// Team is verified if at least 1 player is verified
			if (existing === undefined || !existing) {
				teamMap.set(player.team, player.verified);
			}
		}

		let verifiedCount = 0;
		let unverifiedCount = 0;
		for (const [, isVerified] of teamMap) {
			if (isVerified) {
				verifiedCount++;
			} else {
				unverifiedCount++;
			}
		}

		// Get scheduled matches count
		const scheduledCount = await MatchSchedule.count({
			where: { tournamentId: id }
		});

		res.json({
			success: true,
			data: {
				id: tournament.tournamentId,
				challongeId: tournament.challongeTournamentId,
				name: tournament.name,
				description: tournament.description,
				status: tournament.status,
				format: tournament.format,
				server: tournament.owningDiscordServer,
				hosts: tournament.hosts,
				participantRoleName: tournament.participantRoleName,
				participantLimit: tournament.participantLimit,
				enrolledCount,
				verifiedCount,
				unverifiedCount,
				scheduledCount,
				checkInDisabled: tournament.checkInDisabled,
				checkInChannelId: tournament.checkInChannelId,
				phase: tournament.phase,
				checkedInTeams: tournament.checkedInTeams || [],
				hasBracket: tournament.hasChallongeBracket(),
			}
		});
	} catch (error) {
		logger.error("Failed to fetch tournament:", error);
		res.status(500).json({ success: false, error: "Failed to fetch tournament" });
	}
});

// API: Create tournament
router.post("/api/tournaments", async (req: Request, res: Response) => {
	try {
		const { url, name, server } = req.body;
		const preCheckin = !url || isPreCheckinName(String(name || ""));

		if (!name || !server || (!preCheckin && !url)) {
			return res.status(400).json({
				success: false,
				error: "Missing required fields: name, server, and a Challonge url unless this is a pre-check-in tournament"
			});
		}

		const userId = "web-admin";

		const result = preCheckin
			? await addPreCheckinTournament(String(name), String(server), userId)
			: await addTournament(url, name, server, userId);

		if (!result.success) {
			return res.status(400).json({ success: false, error: result.error });
		}

		res.json({
			success: true,
			data: {
				id: result.customName,
				challongeId: result.challongeId,
				url: result.url,
				phase: result.phase,
			}
		});
	} catch (error) {
		logger.error("Failed to create tournament:", error);
		res.status(500).json({ success: false, error: "Failed to create tournament" });
	}
});

// API: Update tournament
router.put("/api/tournaments/:id", async (req: Request, res: Response) => {
	const renamedRoles: { role: import("discord.js").Role; oldName: string }[] = [];
	try {
		const id = getIdParam(req.params);
		const updated = await getConnection().transaction(async manager => {
			const original = await manager.findOne(ChallongeTournament, { where: { tournamentId: id } });
			const result = await editTournament(manager, id, req.body);
			if (result.tournamentId !== id && original) {
				const client = tryGetBotClient();
				if (!client) throw new TournamentEditError("Bot is not ready. Try renaming again shortly.", 503);
				const guild = await client.guilds.fetch(result.owningDiscordServer);
				const roles = await guild.roles.fetch();
				const suffixes = original.participantRoleName ? ["admin"] : ["player", "admin"];
				for (const suffix of suffixes) {
					const oldName = `${id}-${suffix}`, newName = `${result.tournamentId}-${suffix}`;
					const role = roles.find(r => r.name === oldName);
					if (!role) continue;
					if (roles.some(r => r.name === newName && r.id !== role.id)) {
						throw new TournamentEditError(`A Discord role named ${newName} already exists`, 409);
					}
					await role.setName(newName, "Tournament ID changed in dashboard");
					renamedRoles.push({ role, oldName });
				}
			}
			return result;
		});
		if (updated.tournamentId !== id) {
			const support = getRuntimeSupport();
			support?.participantRole.forget(id);
			support?.participantRole.forget(updated.tournamentId);
			support?.hostRole.forget(id);
			support?.hostRole.forget(updated.tournamentId);
			support?.timeWizard.renameTournament(id, updated.tournamentId);
			const scores = support?.scores.get(id);
			if (scores && support) {
				support.scores.delete(id);
				support.scores.set(updated.tournamentId, scores);
			}
		}
		res.json({ success: true, data: { id: updated.tournamentId, name: updated.name } });
	} catch (error) {
		for (const { role, oldName } of renamedRoles.reverse()) {
			await role.setName(oldName, "Rollback failed tournament rename").catch(logger.error);
		}
		logger.error("Failed to update tournament:", error);
		res.status(error instanceof TournamentEditError ? error.status : 500).json({
			success: false, error: error instanceof TournamentEditError ? error.message : "Failed to update tournament. Check the bot's role permissions."
		});
	}
});

// API: Delete tournament
router.delete("/api/tournaments/:id", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);

		const tournament = await ChallongeTournament.findOne({
			where: { tournamentId: id }
		});

		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		await tournament.remove();

		res.json({ success: true });
	} catch (error) {
		logger.error("Failed to delete tournament:", error);
		res.status(500).json({ success: false, error: "Failed to delete tournament" });
	}
});

// API: Toggle check-in for all tournaments
router.post("/api/tournaments/toggle-all-checkin", async (req: Request, res: Response) => {
	try {
		const { disabled } = req.body;
		if (typeof disabled !== "boolean") {
			return res.status(400).json({ success: false, error: "Missing required field: disabled (boolean)" });
		}
		const tournaments = await ChallongeTournament.find();
		for (const t of tournaments) {
			t.checkInDisabled = disabled;
			await t.save();
		}
		res.json({ success: true, disabled, count: tournaments.length });
	} catch (error) {
		logger.error("Failed to toggle all check-ins:", error);
		res.status(500).json({ success: false, error: "Failed to toggle all check-ins" });
	}
});

// API: Toggle check-in for a specific tournament
router.post("/api/tournaments/:id/toggle-checkin", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: id } });
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}
		tournament.checkInDisabled = !tournament.checkInDisabled;
		await tournament.save();
		res.json({ success: true, checkInDisabled: tournament.checkInDisabled });
	} catch (error) {
		logger.error("Failed to toggle check-in:", error);
		res.status(500).json({ success: false, error: "Failed to toggle check-in" });
	}
});

function challongeClient(): WebsiteWrapperChallonge {
	const config = getConfig();
	return new WebsiteWrapperChallonge(config.challongeUsername, config.challongeToken);
}

router.post("/api/tournaments/:id/precheckin/open", async (req: Request, res: Response) => {
	try {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: getIdParam(req.params) } });
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const result = await openPreCheckin(tournament);
		if (!result.ok) return res.status(400).json({ success: false, error: result.error });
		res.json({ success: true, phase: tournament.phase, already: result.already, teams: result.teams });
	} catch (error) {
		logger.error("Failed to open pre-check-in:", error);
		res.status(500).json({ success: false, error: "Failed to open pre-check-in" });
	}
});

router.post("/api/tournaments/:id/precheckin/teams", async (req: Request, res: Response) => {
	try {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: getIdParam(req.params) } });
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const team = String(req.body?.team || "");
		const result = await checkInTeam(tournament, team);
		if (!result.ok) return res.status(400).json({ success: false, error: result.error });
		res.json({ success: true, already: result.already, teams: result.teams });
	} catch (error) {
		logger.error("Failed to check in team:", error);
		res.status(500).json({ success: false, error: "Failed to check in team" });
	}
});

router.post("/api/tournaments/:id/precheckin/teams/all", async (req: Request, res: Response) => {
	try {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: getIdParam(req.params) } });
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const result = await checkInAllTeams(tournament);
		if (!result.ok) return res.status(400).json({ success: false, error: result.error });
		res.json({ success: true, already: result.already, teams: result.teams });
	} catch (error) {
		logger.error("Failed to check in all teams:", error);
		res.status(500).json({ success: false, error: "Failed to check in teams" });
	}
});

router.get("/api/tournaments/:id/precheckin/export", async (req: Request, res: Response) => {
	try {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: getIdParam(req.params) } });
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const players = await EnrolledPlayer.find({ where: { tournamentId: tournament.tournamentId, verified: true } });
		const teams = [...new Set(players.map(player => player.team).filter(team => team.length > 0))].sort((a, b) => a.localeCompare(b));
		const csv = ["Team Name", ...teams.map(team => `"${team.replace(/"/g, '""')}"`)].join("\n");
		res.setHeader("Content-Type", "text/csv; charset=utf-8");
		res.setHeader("Content-Disposition", `attachment; filename="${tournament.tournamentId}-checked-in-teams.csv"`);
		res.send(csv);
	} catch (error) {
		logger.error("Failed to export checked-in teams:", error);
		res.status(500).json({ success: false, error: "Failed to export checked-in teams" });
	}
});

router.post("/api/tournaments/:id/precheckin/link", async (req: Request, res: Response) => {
	try {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: getIdParam(req.params) } });
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const result = await linkExistingBracket(tournament, String(req.body?.url || ""), challongeClient());
		if (!result.ok) return res.status(400).json({ success: false, error: result.error });
		res.json({
			success: true,
			already: result.already,
			challongeId: result.challongeId,
			url: result.url,
			phase: tournament.phase
		});
	} catch (error) {
		logger.error("Failed to link existing bracket:", error);
		res.status(500).json({ success: false, error: "Failed to link Challonge bracket" });
	}
});

router.post("/api/tournaments/:id/precheckin/close", async (req: Request, res: Response) => {
	try {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId: getIdParam(req.params) } });
		if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
		const result = await createBracketFromCheckin(tournament, challongeClient());
		if (!result.ok) return res.status(400).json({ success: false, error: result.error });
		res.json({
			success: true,
			already: result.already,
			url: result.url,
			phase: tournament.phase,
			teams: result.teams
		});
	} catch (error) {
		logger.error("Failed to create bracket from check-in:", error);
		res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed to create bracket" });
	}
});

// API: Sync tournament with Challonge
router.post("/api/tournaments/:id/sync", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);

		const tournament = await ChallongeTournament.findOne({
			where: { tournamentId: id }
		});

		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}
		if (!tournament.hasChallongeBracket()) {
			return res.status(400).json({
				success: false,
				error: "This tournament has no Challonge bracket yet. Create it from the checked-in teams first."
			});
		}

		// Create challonge service instance
		const config = getConfig();
		const challonge = new WebsiteWrapperChallonge(config.challongeUsername, config.challongeToken);

		// Use shared sync utility
		const result = await syncTournamentWithChallonge(tournament, challonge);

		if (!result.success) {
			return res.status(500).json({ success: false, error: result.error });
		}

		logger.info(`Tournament "${result.name}" synced successfully via web API`);

		res.json({
			success: true,
			data: {
				id: tournament.tournamentId,
				name: result.name,
				status: result.status,
				format: result.format,
				participantLimit: result.participantLimit,
				matchedPlayers: result.matchedPlayers,
				addedSchedules: result.addedSchedules,
				skippedSchedules: result.skippedSchedules
			}
		});
	} catch (error) {
		logger.error("Failed to sync tournament:", error);
		res.status(500).json({ success: false, error: "Failed to sync tournament" });
	}
});

// API: Get list of servers (guilds) the bot is in
router.get("/api/servers", (req: Request, res: Response) => {
	try {
		const client = tryGetBotClient();
		if (!client) {
			return res.status(503).json({ 
				success: false, 
				error: "Bot client not ready. Please try again in a moment." 
			});
		}

		const guilds = client.guilds.cache.map(guild => ({
			id: guild.id,
			name: guild.name,
			memberCount: guild.memberCount,
			icon: guild.iconURL()
		}));

		res.json({
			success: true,
			data: guilds
		});
	} catch (error) {
		logger.error("Failed to fetch servers:", error);
		res.status(500).json({ success: false, error: "Failed to fetch servers" });
	}
});


// Page: Tournament list
router.get("/tournaments", (req: Request, res: Response) => {
	res.render("tournaments/list", {
		title: "Tournaments",
		path: "/tournaments",
	});
});

// Page: Tournament detail
router.get("/tournaments/:id", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);
		const tournament = await ChallongeTournament.findOne({
			where: { tournamentId: id }
		});

		if (!tournament) {
			return res.status(404).render("error", {
				title: "Tournament Not Found",
				message: `The tournament "${id}" could not be found.`,
			});
		}

		res.render("tournaments/detail", {
			title: tournament.name,
			path: "/tournaments",
			tournamentId: tournament.tournamentId,
		});
	} catch (error) {
		logger.error("Failed to load tournament page:", error);
		res.status(500).render("error", {
			title: "Error",
			message: "Failed to load tournament page.",
		});
	}
});

export default router;
