import { Guild, ThreadChannel } from "discord.js";
import { MatchSchedule } from "../database/orm/MatchSchedule";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { Not, IsNull } from "typeorm";
import { WebsitePlayer, WebsiteWrapperChallengermode } from "../website/challengermode";
import { getLogger } from "./logger";

const logger = getLogger("matchThreads");

/**
 * Adds a newly verified user to existing match threads for their matches.
 * This is necessary because private threads don't show previous messages to users
 * who join after the thread was created.
 *
 * @param guild - The Discord guild
 * @param player - The newly verified enrolled player
 * @param challongeService - The Challengermode service for fetching match data
 * @returns Number of threads the user was added to
 */
export async function addUserToMatchThreads(
	guild: Guild,
	player: EnrolledPlayer,
	challongeService: WebsiteWrapperChallengermode
): Promise<number> {
	if (!player.discordId || !player.verified) {
		logger.warn(`Cannot add to threads: player ${player.name} has no verified Discord identity`);
		return 0;
	}

	try {
		const member = await guild.members.fetch(player.discordId).catch(() => null);
		if (!member) {
			logger.warn(`Cannot add to threads: member ${player.discordId} not found in guild`);
			return 0;
		}

		// Find the tournament to get Challengermode info
		const tournament = await ChallongeTournament.findOne({
			where: { tournamentId: player.tournamentId }
		});

		if (!tournament || tournament.owningDiscordServer !== guild.id) {
			logger.warn(`Cannot add to threads: tournament ${player.tournamentId} not found`);
			return 0;
		}

		// If no round is active, don't add user to any threads
		if (tournament.activeRound === null || tournament.activeRound === undefined) {
			logger.info(`No active round for tournament ${player.tournamentId}, skipping thread add for ${player.name}`);
			return 0;
		}

		// Get all match schedules for this tournament's active round that have threads
		const schedules = await MatchSchedule.find({
			where: {
				tournamentId: player.tournamentId,
				roundNumber: tournament.activeRound,
				threadId: Not(IsNull())
			}
		});

		if (schedules.length === 0) {
			logger.info(`No match schedules with threads found for tournament ${player.tournamentId} round ${tournament.activeRound}`);
			return 0;
		}

		// Get matches from Challengermode to find which matches involve this player
		const allMatches = await challongeService.getMatches(tournament.challongeTournamentId, false);
		const allPlayers = await challongeService.getPlayers(tournament.challongeTournamentId);

		// Find the player's Challengermode ID - prefer stored challongeId, fallback to name matching
		let playerChallonge: WebsitePlayer | undefined;

		// First try to match by stored challongeId (most reliable)
		if (player.challongeId) {
			playerChallonge = allPlayers.find(p => p.challongeId === player.challongeId);
			if (playerChallonge) {
				logger.verbose(`Found player ${player.name} by stored challongeId: ${player.challongeId}`);
			}
		}

		// Fallback to name/team matching if no challongeId or not found
		if (!playerChallonge) {
			const name = (player.team || player.name || "").trim().toLowerCase();
			const candidates = allPlayers.filter(p => p.name.trim().toLowerCase() === name);
			playerChallonge = candidates.length === 1 ? candidates[0] : undefined;
			if (playerChallonge) {
				logger.verbose(`Found player ${player.name} by name/team matching`);
			}
		}

		if (!playerChallonge) {
			logger.warn(`Could not find player ${player.name} (team: ${player.team}, challongeId: ${player.challongeId}) in Challengermode participants. Available names: ${allPlayers.map(p => p.name).join(", ")}`);
			return 0;
		}

		// Find all match IDs where this player participates
		const playerMatchIds = allMatches
			.filter(m => m.player1 === playerChallonge.challongeId || m.player2 === playerChallonge.challongeId)
			.map(m => m.matchId);

		// Find schedules with threads for these matches
		const relevantSchedules = schedules.filter(s => playerMatchIds.includes(s.matchId));

		logger.info(`Found ${relevantSchedules.length} relevant threads for player ${player.name} (matchIds: ${playerMatchIds.join(",")})`);

		let addedCount = 0;
		for (const schedule of relevantSchedules) {
			if (!schedule.threadId) continue;

			try {
				// Fetch the thread
				const thread = await guild.channels.fetch(schedule.threadId).catch(() => null);
				if (!thread || !(thread instanceof ThreadChannel)) {
					logger.warn(`Thread ${schedule.threadId} not found or not a thread`);
					continue;
				}

				// Fetch thread members to ensure cache is populated
				await thread.members.fetch();

				// Check if user is already a member of the thread
				if (thread.members.cache.has(member.id)) {
					logger.verbose(`User ${member.id} already in thread ${thread.name}`);
					continue;
				}

				// Add the user to the thread
				await thread.members.add(member.id, `User ${player.name} verified after thread creation`);

				addedCount++;

				// Send a mention message so the user gets notified
				await thread.send(`👋 <@${member.id}> has been verified for **${player.team || player.name}** and added to this match thread (Round ${tournament.activeRound}).`);

				logger.info(`Added ${player.name} to thread ${thread.name}`);

			} catch (err) {
				logger.error(`Failed to add ${player.name} to thread ${schedule.threadId}:`, err);
			}
		}

		return addedCount;

	} catch (err) {
		logger.error(`Error in addUserToMatchThreads for ${player.name}:`, err);
		return 0;
	}
}
