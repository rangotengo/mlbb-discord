import { Mutex } from "async-mutex";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../database/orm/MatchSchedule";
import { TournamentFormat, TournamentStatus } from "../database/interface";
import { UserError } from "./errors";
import { extractTournamentId, tournamentUrl, WebsiteWrapperChallengermode } from "../website/challengermode";

/**
 * Result of adding a tournament.
 */
export type AddTournamentResult =
	| { success: false; error: string }
	| { success: true; challongeId: string; customName: string; url: string; userId: string };

export { extractTournamentId } from "../website/challengermode";

/**
 * Adds a tournament to the bot from a Challengermode URL.
 *
 * @param url - The Challengermode tournament URL
 * @param customName - The custom tournament ID for the bot
 * @param guildId - The Discord server ID
 * @param userId - The Discord user ID of the host
 * @returns The result of the operation
 */
export async function addTournament(
	url: string,
	customName: string,
	guildId: string,
	userId: string
): Promise<AddTournamentResult> {
	// Validate and extract Challengermode ID
	let challongeId: string;
	try {
		challongeId = extractTournamentId(url);
	} catch (e) {
		return {
			success: false,
			error: `Invalid Challengermode URL: "${url}". Expected format: https://www.challengermode.com/s/your-space/tournaments/<uuid>`
		};
	}

	customName = customName.trim();
	if (!customName || customName.length > 50) {
		return { success: false, error: "Choose a tournament name between 1 and 50 characters." };
	}

	// tournamentId is the global primary key. Never save over another server's record.
	const existing = await ChallongeTournament.findOne({
		where: { tournamentId: customName }
	});
	if (existing) {
		return {
			success: false,
			error: `A tournament with the name "${customName}" is already in use. Please choose a different name.`
		};
	}

	// Create the tournament
	const tournament = new ChallongeTournament();
	tournament.tournamentId = customName; // Bot's internal ID (custom name)
	tournament.challongeTournamentId = challongeId; // Actual Challengermode ID for API calls
	tournament.name = customName; // Will be updated when synced with Challengermode
	tournament.description = `Tournament added from Challengermode: ${url}`;
	tournament.owningDiscordServer = guildId;
	tournament.hosts = [userId];
	tournament.format = TournamentFormat.SWISS;
	tournament.status = TournamentStatus.PREPARING;
	tournament.participantLimit = 0;
	tournament.publicChannels = [];
	tournament.privateChannels = [];
	tournament.autoPushScores = false;

	try {
		// INSERT also protects against simultaneous registrations of the same primary key.
		await ChallongeTournament.insert(tournament);
	} catch (error) {
		if (await ChallongeTournament.existsBy({ tournamentId: customName })) {
			return { success: false, error: "That tournament name is already in use. Please choose a different name." };
		}
		throw error;
	}

	return {
		success: true,
		challongeId,
		customName,
		url: tournamentUrl(challongeId),
		userId
	};
}

/**
 * Resolves a tournament ID from the provided arguments or automatically selects
 * the single tournament if only one exists in the server.
 *
 * @param providedId - The tournament ID provided by the user (may be undefined)
 * @param guildId - The Discord server ID
 * @returns The resolved tournament ID
 * @throws UserError if no ID provided and multiple tournaments exist, or if no tournaments exist
 */
export async function resolveTournamentId(providedId: string | undefined, guildId: string | null): Promise<string> {
	// If ID is explicitly provided, use it
	if (providedId) {
		return providedId;
	}

	// No guild ID means we can't auto-resolve
	if (!guildId) {
		throw new UserError("Tournament ID is required when not in a server.");
	}

	// Find all tournaments in this server
	const tournaments = await ChallongeTournament.find({
		where: { owningDiscordServer: guildId }
	});

	// No tournaments found
	if (tournaments.length === 0) {
		throw new UserError("No tournaments found in this server.");
	}

	// Single tournament - auto-resolve
	if (tournaments.length === 1) {
		return tournaments[0].tournamentId;
	}

	// Multiple tournaments - require user to specify
	const tournamentList = tournaments
		.map(t => `• \`${t.tournamentId}\` - **${t.name}**`)
		.join("\n");

	throw new UserError(
		`Multiple tournaments exist in this server. Please specify the tournament ID:\n${tournamentList}`
	);
}

/**
 * Result of syncing a tournament with Challengermode.
 */
export type SyncTournamentResult =
	| { success: false; error: string }
	| {
		success: true;
		matchedPlayers: number;
		addedSchedules: number;
		updatedSchedules: number;
		skippedSchedules: number;
		name: string;
		status?: TournamentStatus;
		format?: TournamentFormat;
		participantLimit: number;
	};

/**
 * Syncs a tournament with Challengermode, including matching players and creating match schedules.
 * This is a shared utility used by both the webapp and Discord bot.
 *
 * @param tournament - The tournament entity to sync
 * @param challonge - The Challengermode API wrapper instance
 * @returns The result of the sync operation
 */
// SQL.js uses one connection; serialise write transactions across tournaments too.
const syncWrites = new Mutex();

export async function syncTournament(
	tournament: ChallongeTournament,
	api: Pick<WebsiteWrapperChallengermode, "getTournament" | "getMatches">
): Promise<SyncTournamentResult> {
	try {
		// Keep network calls outside the transaction. A failed read changes no local state.
		const data = await api.getTournament(tournament.challongeTournamentId);
		const matches = await api.getMatches(tournament.challongeTournamentId);
		return await syncWrites.runExclusive(async () => ChallongeTournament.getRepository().manager.transaction(async manager => {
			const current = await manager.findOneByOrFail(ChallongeTournament, { tournamentId: tournament.tournamentId });
			const enrolledPlayers = await manager.findBy(EnrolledPlayer, { tournamentId: current.tournamentId });
			let matchedPlayers = 0;
			for (const enrolled of enrolledPlayers) {
				const candidates = data.players.filter(p => p.name.trim().toLowerCase() === enrolled.team.trim().toLowerCase());
				// Duplicate names must never assign a player to an arbitrary lineup.
				const player = candidates.length === 1 ? candidates[0] : candidates.find(p => p.challongeId === enrolled.challongeId);
				if (player && enrolled.challongeId !== player.challongeId) {
					enrolled.challongeId = player.challongeId;
					await manager.save(enrolled);
					matchedPlayers++;
				}
			}

			const unscheduled = new Date("2099-12-31T23:59:59Z");
			const existing = await manager.findBy(MatchSchedule, { tournamentId: current.tournamentId });
			const schedules = new Map(existing.map(schedule => [schedule.matchId, schedule]));
			const seen = new Set<string>();
			let addedSchedules = 0;
			let updatedSchedules = 0;
			for (const match of matches) {
				if (seen.has(match.matchId)) throw new Error("Duplicate fixture in tournament data. Please sync again.");
				seen.add(match.matchId);
				const sourceTime = match.scheduledTime ? new Date(match.scheduledTime) : unscheduled;
				if (!Number.isFinite(sourceTime.getTime())) throw new Error("Invalid fixture time. Please sync again.");
				const schedule = schedules.get(match.matchId);
				if (!schedule) {
					await manager.save(MatchSchedule, manager.create(MatchSchedule, {
						matchId: match.matchId, tournamentId: current.tournamentId, scheduledTime: sourceTime,
						roundNumber: match.round, notified: false, threadId: null
					}));
					addedSchedules++;
				} else {
					let changed = schedule.roundNumber !== match.round;
					schedule.roundNumber = match.round;
					if (schedule.scheduledTime.getTime() === unscheduled.getTime() && match.scheduledTime) {
						schedule.scheduledTime = sourceTime;
						changed = true;
					}
					if (changed) {
						await manager.save(schedule);
						updatedSchedules++;
					}
				}
			}
			const states = { pending: TournamentStatus.PREPARING, underway: TournamentStatus.IPR, complete: TournamentStatus.COMPLETE };
			const status = data.state ? states[data.state] : undefined;
			const format = data.format as TournamentFormat | undefined;
			const participantLimit = data.signupCap ?? 0;
			current.lastSyncAttempt = new Date();
			current.lastSyncSuccess = new Date();
			current.syncSource = "challengermode";
			current.name = data.name;
			current.description = data.desc;
			if (status) current.status = status;
			if (format) current.format = format;
			current.participantLimit = participantLimit;
			await manager.save(current);
			return {
				success: true as const, matchedPlayers, addedSchedules, updatedSchedules,
				skippedSchedules: matches.length - addedSchedules - updatedSchedules,
				name: current.name, status, format, participantLimit
			};
		}));
	} catch (error) {
		await ChallongeTournament.update({ tournamentId: tournament.tournamentId }, { lastSyncAttempt: new Date(), syncSource: "challengermode" }).catch(() => undefined);
		return { success: false, error: error instanceof Error ? error.message : "Unknown error during sync" };
	}
}
