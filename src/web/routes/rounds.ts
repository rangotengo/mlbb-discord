import { resolveTeamMembers } from "../../util/teams";
import { getBotClient } from "../server";
import { getIdParam } from "../params";
import { Router, Request, Response } from "express";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../../database/orm/MatchSchedule";
import { getLogger } from "../../util/logger";
import { getConfig } from "../../config";
import { getTournamentApi } from "../../website/challengermode";
import { Client, ChannelType, ThreadAutoArchiveDuration } from "discord.js";
import { OrganiserRoleProvider } from "../../role/organiser";
import { HostRoleProvider } from "../../role/host";

const router = Router();
const logger = getLogger("web:rounds");

// Helper to safely get the Discord client or null
function tryGetBotClient(): Client | null {
	try {
		return getBotClient();
	} catch (e) {
		return null;
	}
}


// Helper to validate tournament exists
async function validateTournament(tournamentId: string): Promise<ChallongeTournament | null> {
	return ChallongeTournament.findOne({
		where: { tournamentId }
	});
}

// API: Preview matches for a round
router.get("/api/tournaments/:id/rounds/:round/preview", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const roundNumber = parseInt(getIdParam(req.params, 'round'), 10);

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Get all schedules for this tournament
		const schedules = await MatchSchedule.find({
			where: { tournamentId }
		});

		// Filter schedules by round number
		const roundSchedules = schedules.filter(s => s.roundNumber === roundNumber);

		if (roundSchedules.length === 0) {
			return res.status(404).json({
				success: false,
				error: `No schedules found for round ${roundNumber}`
			});
		}

		// Get enrolled players for lookups
		const enrolledPlayers = await EnrolledPlayer.find({
			where: { tournamentId, verified: true }
		});

		// Build preview data
		const matches = roundSchedules.map(s => {
			const scheduledTime = s.scheduledTime && s.scheduledTime.getFullYear() < 2090
				? s.scheduledTime.toISOString()
				: null;

			return {
				matchId: s.matchId,
				scheduledTime,
				threadId: s.threadId,
				notified: s.notified,
				hasEnrolled: enrolledPlayers.length > 0,
				enrolledCount: enrolledPlayers.length
			};
		});

		res.json({
			success: true,
			data: {
				round: roundNumber,
				matchCount: matches.length,
				enrolledCount: enrolledPlayers.length,
				matches,
				warning: enrolledPlayers.length === 0 ? "No verified players enrolled yet" : undefined
			}
		});
	} catch (error) {
		logger.error("Failed to preview round:", error);
		res.status(500).json({ success: false, error: "Failed to preview round" });
	}
});

// API: Start a round (create Discord threads)
router.post("/api/tournaments/:id/rounds/:round/start", async (req: Request, res: Response) => {
	try {
		const tournamentId = getIdParam(req.params);
		const roundNumber = parseInt(getIdParam(req.params, 'round'), 10);
		const { channelId } = req.body;

		if (!channelId) {
			return res.status(400).json({
				success: false,
				error: "Missing required field: channelId"
			});
		}

		const tournament = await validateTournament(tournamentId);
		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Get Discord client
		const client = tryGetBotClient();
		if (!client) {
			return res.status(503).json({
				success: false,
				error: "Bot client not ready. Please try again in a moment."
			});
		}

		// Get the guild and channel
		const guild = await client.guilds.fetch(tournament.owningDiscordServer).catch(() => null);
		if (!guild) {
			return res.status(404).json({ success: false, error: "Discord server not found" });
		}

		const targetChannel = await guild.channels.fetch(channelId).catch(() => null);
		if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
			return res.status(400).json({ success: false, error: "Invalid text channel" });
		}

		// Get enrolled players
		const enrolledPlayers = await EnrolledPlayer.find({
			where: { tournamentId, verified: true }
		});



		// Get schedules for this round
		const schedules = await MatchSchedule.find({
			where: { tournamentId }
		});

		// Filter by round number
		const roundSchedules = schedules.filter(s => s.roundNumber === roundNumber);

		if (roundSchedules.length === 0) {
			return res.status(400).json({
				success: false,
				error: `No schedules found for round ${roundNumber}`
			});
		}

		// Get Challengermode data for player names
		const config = getConfig();
		const challonge = getTournamentApi(config.challengermodeRefreshKey);
		const players = await challonge.getPlayers(tournament.challongeTournamentId);
		const challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);

		// Create player map for lookups
		const playerMap = new Map<string, typeof players[0]>();
		for (const player of players) {
			playerMap.set(player.challongeId, player);
		}

		// Validate that all matches have scheduled times configured
		const missingSchedules: string[] = [];
		for (const schedule of roundSchedules) {
			if (!schedule.scheduledTime || schedule.scheduledTime.getFullYear() > 2090) {
				const matchData = challongeMatches.find(m => m.matchId === schedule.matchId);
				if (matchData) {
					const p1 = matchData.player1 ? playerMap.get(matchData.player1)?.name : null;
					const p2 = matchData.player2 ? playerMap.get(matchData.player2)?.name : null;
					missingSchedules.push(`- Match ${schedule.matchId}: **${p1 || "Unknown"}** vs **${p2 || "Unknown"}**`);
				} else {
					missingSchedules.push(`- Match ${schedule.matchId}: TBD vs TBD`);
				}
			}
		}

		if (missingSchedules.length > 0) {
			return res.status(400).json({
				success: false,
				error: `⚠️ **Schedules Not Set**\n\nThe following matches in Round ${roundNumber} do not have a scheduled time. Please update them in the web dashboard first:\n\n${missingSchedules.join("\n")}`
			});
		}

		// Validate that all matches have determined teams (not TBD)
		const undeterminedTeams: string[] = [];
		for (const schedule of roundSchedules) {
			const matchData = challongeMatches.find(m => m.matchId === schedule.matchId);
			if (!matchData || !matchData.player1 || !matchData.player2) {
				undeterminedTeams.push(`- Match ${schedule.matchId}: TBD vs TBD`);
			} else {
				const p1 = playerMap.get(matchData.player1)?.name;
				const p2 = playerMap.get(matchData.player2)?.name;
				if (!p1 || !p2) {
					undeterminedTeams.push(`- Match ${schedule.matchId}: **${p1 || "TBD"}** vs **${p2 || "TBD"}**`);
				}
			}
		}

		if (undeterminedTeams.length > 0) {
			return res.status(400).json({
				success: false,
				error: `⚠️ **Teams Not Determined**\n\nThe following matches in Round ${roundNumber} have undetermined opponents. Please update the bracket in Challengermode first:\n\n${undeterminedTeams.join("\n")}`
			});
		}

		// Get admin role IDs for mentions
		const organiserRoleProvider = new OrganiserRoleProvider(config.defaultTORole, 0x3498db);
		const hostRoleProvider = new HostRoleProvider(client, 0xe74c3c);
		let toRoleId: string | null = null;
		let hostRoleId: string | null = null;

		try {
			toRoleId = await organiserRoleProvider.get(guild);
		} catch (error) {
			logger.warn("Failed to get TO role:", error);
		}

		try {
			hostRoleId = await hostRoleProvider.get({ id: tournamentId, server: guild.id });
		} catch (error) {
			logger.warn("Failed to get host role:", error);
		}

		let createdCount = 0;
		const errors: string[] = [];

		for (const schedule of roundSchedules) {
			try {
				// Get match data from Challengermode for player names
				const matchData = challongeMatches.find(m => m.matchId === schedule.matchId);
				const p1Challonge = (matchData?.player1) ? playerMap.get(matchData.player1) : null;
				const p2Challonge = (matchData?.player2) ? playerMap.get(matchData.player2) : null;

				// Use player names for thread name (validated above so should always have names)
				const p1Name = p1Challonge?.name ?? "Unknown";
				const p2Name = p2Challonge?.name ?? "Unknown";
				const threadName = `${p1Name} vs ${p2Name}`;

				const thread = await targetChannel.threads.create({
					name: threadName,
					type: ChannelType.PrivateThread,
					autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
					reason: `Round ${roundNumber} match generated by web admin`
				});

				// Get mentions for any enrolled players
				const getMentions = (playersArray: EnrolledPlayer[]): string => {
					const mentions = playersArray.map(p => p.discordId ? `<@${p.discordId}>` : null).filter(Boolean);
					return mentions.length > 0 ? mentions.join(" ") : "";
				};

				// Get player mentions for this match (use team name to find enrolled players)
				const p1Mentions = getMentions(resolveTeamMembers(enrolledPlayers, p1Challonge));
				const p2Mentions = getMentions(resolveTeamMembers(enrolledPlayers, p2Challonge));

				// Format scheduled time
				let scheduledTimeText = "";
				if (schedule.scheduledTime && schedule.scheduledTime.getFullYear() < 2090) {
					const unixTimestamp = Math.floor(schedule.scheduledTime.getTime() / 1000);
					scheduledTimeText = `\n\n⏰ **Scheduled Time:** <t:${unixTimestamp}:F>`;
				}

				// Build role mentions
				const roleMentions = [];
				if (toRoleId) roleMentions.push(`<@&${toRoleId}>`);
				if (hostRoleId) roleMentions.push(`<@&${hostRoleId}>`);
				const roleMentionsText = roleMentions.length > 0 ? `\n${roleMentions.join(" ")}` : "";

				// Build player mentions text
				const playerMentionsText = (p1Mentions || p2Mentions) ? `\n\n${p1Mentions} ${p2Mentions}` : "";

				// Send thread message
				await thread.send(
					`🏆 **Round ${roundNumber} Match** 🏆\n\n` +
					`**${p1Name}**${p1Mentions ? ` ${p1Mentions}` : ""}\n` +
					`**VS**\n` +
					`**${p2Name}**${p2Mentions ? ` ${p2Mentions}` : ""}` +
					`${scheduledTimeText}` +
					`${roleMentionsText}` +
					`${playerMentionsText}\n\nGood luck!`
				);

				// Save thread ID and channel ID to schedule
				schedule.threadId = thread.id;
				schedule.channelId = thread.parentId;
				await schedule.save();

				createdCount++;

			} catch (e) {
				logger.error(`Error creating thread for match ${schedule.matchId}:`, e);
				errors.push(`Match ${schedule.matchId}: ${e instanceof Error ? e.message : 'Unknown error'}`);
			}
		}

		// Set this round as the active round for the tournament
		tournament.activeRound = roundNumber;
		await tournament.save();
		logger.info(`Set active round to ${roundNumber} for tournament ${tournamentId}`);

		res.json({
			success: true,
			data: {
				tournamentId,
				roundNumber,
				channelId,
				createdCount,
				totalCount: roundSchedules.length,
				errors: errors.length > 0 ? errors : undefined
			}
		});
	} catch (error) {
		logger.error("Failed to start round:", error);
		res.status(500).json({ success: false, error: "Failed to start round" });
	}
});

// API: Get available round numbers from schedules
router.get("/api/tournaments/:id/rounds", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);
		const tournament = await validateTournament(id);

		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		// Get unique round numbers from schedules
		const schedules = await MatchSchedule.find({
			where: { tournamentId: id }
		});

		if (schedules.length === 0) {
			return res.status(400).json({
				success: false,
				error: "No schedules found. Please import schedules first."
			});
		}

		// Build set of round numbers, using Challengermode data as fallback
		const roundSet = new Set<number>();

		// First, add any round numbers from database
		for (const schedule of schedules) {
			if (schedule.roundNumber != null) {
				roundSet.add(schedule.roundNumber);
			}
		}

		// If no rounds found in database, try fetching from Challengermode
		if (roundSet.size === 0) {
			try {
				const config = getConfig();
				const challonge = getTournamentApi(config.challengermodeRefreshKey);
				const challongeMatches = await challonge.getMatches(tournament.challongeTournamentId);

				// Get round numbers for matches that have schedules
				const scheduledMatchIds = new Set(schedules.map(s => s.matchId));
				for (const match of challongeMatches) {
					if (scheduledMatchIds.has(match.matchId)) {
						roundSet.add(match.round);
					}
				}
			} catch (error) {
				logger.warn("Failed to fetch rounds from Challengermode:", error);
			}
		}

		// Convert to sorted array
		const uniqueRounds = [...roundSet].sort((a, b) => a - b);

		if (uniqueRounds.length === 0) {
			return res.status(400).json({
				success: false,
				error: "No round numbers found. Please sync with Challengermode first."
			});
		}

		res.json({ success: true, data: uniqueRounds });
	} catch (error) {
		logger.error("Failed to fetch rounds:", error);
		res.status(500).json({ success: false, error: "Failed to fetch rounds" });
	}
});

// API: Get Discord channels for a tournament's server
router.get("/api/tournaments/:id/channels", async (req: Request, res: Response) => {
	try {
		const id = getIdParam(req.params);
		const tournament = await validateTournament(id);

		if (!tournament) {
			return res.status(404).json({ success: false, error: "Tournament not found" });
		}

		const client = tryGetBotClient();
		if (!client) {
			return res.status(503).json({
				success: false,
				error: "Bot client not ready. Please try again in a moment."
			});
		}

		const guild = await client.guilds.fetch(tournament.owningDiscordServer).catch(() => null);
		if (!guild) {
			return res.status(404).json({ success: false, error: "Discord server not found" });
		}

		const channels = guild.channels.cache
			.filter(ch => ch !== null && ch.type === ChannelType.GuildText)
			.map((ch) => ({
				id: ch.id,
				name: ch.name,
				type: ch.name
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		res.json({ success: true, data: channels });
	} catch (error) {
		logger.error("Failed to fetch channels:", error);
		res.status(500).json({ success: false, error: "Failed to fetch channels" });
	}
});

export default router;
