import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../database/orm/MatchSchedule";
import { TournamentFormat, TournamentPhase, TournamentStatus } from "../database/interface";
import { UserError } from "./errors";
import { WebsiteWrapperChallonge } from "../website/challonge";

/**
 * Result of adding a tournament.
 */
export type AddTournamentResult =
	| { success: false; error: string }
	| {
			success: true;
			phase: TournamentPhase;
			challongeId?: string;
			customName: string;
			url?: string;
			userId: string;
	  };

/**
 * Extracts the Challonge tournament ID from a URL.
 *
 * @param url - The Challonge tournament URL
 * @returns The Challonge tournament ID
 * @throws Error if the URL format is invalid
 */
export function extractChallongeId(url: string): string {
	// Support various URL formats: https://challonge.com/xyz, http://challonge.com/xyz, challonge.com/xyz
	const match = url.match(/challonge\.com\/([^/?]+)/);
	if (!match) {
		throw new Error("Invalid Challonge URL format");
	}
	return match[1];
}

/**
 * Adds a tournament to the bot from a Challonge URL.
 *
 * @param url - The Challonge tournament URL
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
	// Validate and extract Challonge ID
	let challongeId: string;
	try {
		challongeId = extractChallongeId(url);
	} catch (e) {
		return {
			success: false,
			error: `Invalid Challonge URL: "${url}". Expected format: https://challonge.com/xyz`
		};
	}

	// Check if tournament with this custom name already exists
	const existing = await ChallongeTournament.findOne({
		where: { tournamentId: customName, owningDiscordServer: guildId }
	});
	if (existing) {
		return {
			success: false,
			error: `A tournament with the name "${customName}" already exists in this server.`
		};
	}

	// Create the tournament
	const tournament = new ChallongeTournament();
	tournament.tournamentId = customName; // Bot's internal ID (custom name)
	tournament.challongeTournamentId = challongeId; // Actual Challonge ID for API calls
	tournament.name = customName; // Will be updated when synced with Challonge
	tournament.description = `Tournament added from Challonge: ${url}`;
	tournament.owningDiscordServer = guildId;
	tournament.hosts = [userId];
	tournament.format = TournamentFormat.SWISS;
	tournament.status = TournamentStatus.PREPARING;
	tournament.phase = TournamentPhase.LINKED;
	tournament.checkedInTeams = [];
	tournament.participantLimit = 0;
	tournament.publicChannels = [];
	tournament.privateChannels = [];
	tournament.autoPushScores = true;

	await tournament.save();

	return {
		success: true,
		phase: TournamentPhase.LINKED,
		challongeId,
		customName,
		url,
		userId
	};
}

const PRE_CHECKIN_WORD = /^(pre-?check-?in|precheckin)$/i;

/**
 * A name that mentions pre-check-in creates a local tournament with no Challonge link.
 * Example: !add pre-checkin spring cup
 */
export function isPreCheckinName(name: string): boolean {
	return name.split(/\s+/).some(word => PRE_CHECKIN_WORD.test(word));
}

export function displayNameWithoutPhase(name: string): string {
	const stripped = name
		.split(/\s+/)
		.filter(word => !PRE_CHECKIN_WORD.test(word))
		.join(" ")
		.trim();
	return stripped || name.trim();
}

/**
 * Creates a tournament that collects team attendance before a Challonge bracket exists.
 */
export async function addPreCheckinTournament(
	name: string,
	guildId: string,
	userId: string
): Promise<AddTournamentResult> {
	const customName = name.trim();
	if (!customName) {
		return { success: false, error: "A tournament name is required." };
	}

	const existing = await ChallongeTournament.findOne({
		where: { tournamentId: customName, owningDiscordServer: guildId }
	});
	if (existing) {
		return {
			success: false,
			error: `A tournament with the name "${customName}" already exists in this server.`
		};
	}

	const tournament = new ChallongeTournament();
	tournament.tournamentId = customName;
	tournament.name = displayNameWithoutPhase(customName);
	tournament.description = "Pre-check-in tournament. The Challonge bracket is created from teams that check in.";
	tournament.owningDiscordServer = guildId;
	tournament.hosts = [userId];
	tournament.format = TournamentFormat.SWISS;
	tournament.status = TournamentStatus.PREPARING;
	tournament.phase = TournamentPhase.PRE_CHECKIN;
	tournament.checkedInTeams = [];
	tournament.participantLimit = 0;
	tournament.publicChannels = [];
	tournament.privateChannels = [];
	tournament.autoPushScores = true;
	await tournament.save();

	return { success: true, phase: TournamentPhase.PRE_CHECKIN, customName, userId };
}

export type CheckinActionResult =
	| { ok: false; error: string }
	| { ok: true; tournament: ChallongeTournament; teams: string[]; already: boolean };

function enrolledTeams(players: EnrolledPlayer[]): string[] {
	return [...new Set(players.map(player => player.team).filter(team => team.length > 0))].sort((a, b) =>
		a.localeCompare(b)
	);
}

function findTeam(teams: string[], requested: string): string | undefined {
	const needle = requested.trim().toLowerCase();
	return teams.find(team => team.toLowerCase() === needle);
}

/**
 * Opens team attendance. Enrolled teams are the only teams that can check in.
 */
export async function openPreCheckin(tournament: ChallongeTournament): Promise<CheckinActionResult> {
	if (tournament.phase === TournamentPhase.LINKED || tournament.phase === TournamentPhase.BRACKET_CREATED) {
		return { ok: false, error: `**${tournament.name}** is not a pre-check-in tournament.` };
	}
	if (tournament.phase === TournamentPhase.CHECKIN_OPEN) {
		return { ok: true, tournament, teams: tournament.checkedInTeams, already: true };
	}
	const players = await EnrolledPlayer.find({ where: { tournamentId: tournament.tournamentId } });
	if (enrolledTeams(players).length === 0) {
		return { ok: false, error: "Enroll teams before opening check-in." };
	}
	tournament.phase = TournamentPhase.CHECKIN_OPEN;
	tournament.checkedInTeams = [];
	await tournament.save();
	return { ok: true, tournament, teams: [], already: false };
}

/**
 * Records one enrolled team as present. Running it again for the same team changes nothing.
 */
export async function checkInTeam(
	tournament: ChallongeTournament,
	teamName: string
): Promise<CheckinActionResult> {
	if (tournament.phase !== TournamentPhase.CHECKIN_OPEN) {
		return { ok: false, error: `Check-in is not open for **${tournament.name}**.` };
	}
	const players = await EnrolledPlayer.find({ where: { tournamentId: tournament.tournamentId } });
	const team = findTeam(enrolledTeams(players), teamName);
	if (!team) {
		return { ok: false, error: `No enrolled team named "${teamName.trim()}".` };
	}
	if (tournament.checkedInTeams.some(checked => checked.toLowerCase() === team.toLowerCase())) {
		return { ok: true, tournament, teams: tournament.checkedInTeams, already: true };
	}
	tournament.checkedInTeams = [...tournament.checkedInTeams, team].sort((a, b) => a.localeCompare(b));
	await tournament.save();
	return { ok: true, tournament, teams: tournament.checkedInTeams, already: false };
}

/**
 * Closes attendance and creates the Challonge bracket from checked-in teams only.
 * A retry after the bracket exists does not create a second tournament.
 */
export async function createBracketFromCheckin(
	tournament: ChallongeTournament,
	challonge: WebsiteWrapperChallonge
): Promise<CheckinActionResult & { url?: string; created?: number }> {
	if (tournament.phase === TournamentPhase.BRACKET_CREATED && tournament.challongeTournamentId) {
		return {
			ok: true,
			tournament,
			teams: tournament.checkedInTeams,
			already: true,
			url: `https://challonge.com/${tournament.challongeTournamentId}`
		};
	}
	if (tournament.phase !== TournamentPhase.CHECKIN_OPEN && tournament.phase !== TournamentPhase.PRE_CHECKIN) {
		return { ok: false, error: `**${tournament.name}** is not waiting on pre-check-in.` };
	}
	const teams = tournament.checkedInTeams;
	if (teams.length < 2) {
		return { ok: false, error: `Need at least 2 checked-in teams. Currently ${teams.length}.` };
	}

	let challongeId = tournament.challongeTournamentId;
	if (!challongeId) {
		const format = tournament.format === TournamentFormat.FREE_FOR_ALL ? TournamentFormat.SWISS : tournament.format;
		challongeId = await challonge.createTournament(tournament.name, tournament.description, format);
		tournament.challongeTournamentId = challongeId;
		await tournament.save();
	}
	const present = new Set(
		(await EnrolledPlayer.find({ where: { tournamentId: tournament.tournamentId } }))
			.filter(player => player.challongeId)
			.map(player => player.team.toLowerCase())
	);
	const missing = teams.filter(team => !present.has(team.toLowerCase()));
	const added = missing.length ? await challonge.bulkAddParticipants(challongeId, missing) : new Map<string, number>();
	const players = await EnrolledPlayer.find({ where: { tournamentId: tournament.tournamentId } });
	for (const player of players) {
		const challongePlayerId = added.get(player.team);
		if (challongePlayerId && !player.challongeId) {
			player.challongeId = challongePlayerId;
			await player.save();
		}
	}

	tournament.phase = TournamentPhase.BRACKET_CREATED;
	await tournament.save();
	return {
		ok: true,
		tournament,
		teams,
		already: false,
		url: `https://challonge.com/${challongeId}`,
		created: added.size
	};
}

/**
 * Resolves a tournament ID from the provided arguments or automatically selects
 * the single current tournament. A finished tournament does not count while another is still running.
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

	// A finished tournament should not force the player to name the one that is still running.
	const ongoing = tournaments.filter(t => t.status !== TournamentStatus.COMPLETE);
	const candidates = ongoing.length ? ongoing : tournaments;

	if (candidates.length === 1) {
		return candidates[0].tournamentId;
	}

	const tournamentList = candidates
		.map(t => `• \`${t.tournamentId}\` - **${t.name}**`)
		.join("\n");

	throw new UserError(
		`Multiple ${ongoing.length ? "ongoing " : ""}tournaments exist in this server. Please specify the tournament ID:\n${tournamentList}`
	);
}

/**
 * Result of syncing a tournament with Challonge.
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
 * Syncs a tournament with Challonge, including matching players and creating match schedules.
 * This is a shared utility used by both the webapp and Discord bot.
 *
 * @param tournament - The tournament entity to sync
 * @param challonge - The Challonge API wrapper instance
 * @returns The result of the sync operation
 */
export async function syncTournamentWithChallonge(
	tournament: ChallongeTournament,
	challonge: WebsiteWrapperChallonge
): Promise<SyncTournamentResult> {
	try {
		// Query Challonge API for tournament data
		const tournamentData = await challonge.getTournament(tournament.getChallongeIdForApi());

		// Match enrolled players to Challonge participants by team name and store challongeId
		const enrolledPlayers = await EnrolledPlayer.find({
			where: { tournamentId: tournament.tournamentId }
		});

		let matchedCount = 0;
		for (const enrolled of enrolledPlayers) {
			// Find matching Challonge participant by team name (case-insensitive)
			const challongePlayer = tournamentData.players.find(
				p => p.name.toLowerCase() === enrolled.team.toLowerCase()
			);

			if (challongePlayer && !enrolled.challongeId) {
				enrolled.challongeId = challongePlayer.challongeId;
				await enrolled.save();
				matchedCount++;
			}
		}

		// Sentinel date for unscheduled matches (TypeORM requires non-null Date)
		const UNSCHEDULED_MATCH_DATE = new Date("2099-12-31T23:59:59Z");

		// Fetch matches from Challonge and create schedule entries
		const challongeMatches = await challonge.getMatches(tournament.getChallongeIdForApi());

		// Get existing schedules and create a map for easy lookup
		const existingSchedules = await MatchSchedule.find({
			where: { tournamentId: tournament.tournamentId }
		});
		const existingScheduleMap = new Map<number, MatchSchedule>();
		for (const schedule of existingSchedules) {
			existingScheduleMap.set(schedule.matchId, schedule);
		}

		// Helper to check if a scheduled time is the sentinel date (not manually set)
		const isUnscheduledTime = (date: Date): boolean => {
			return date.getFullYear() === 2099 && date.getMonth() === 11 && date.getDate() === 31;
		};

		const schedulesToInsert: MatchSchedule[] = [];
		const schedulesToUpdate: MatchSchedule[] = [];
		let updatedCount = 0;

		// Process each Challonge match
		for (const match of challongeMatches) {
			const existingSchedule = existingScheduleMap.get(match.matchId);

			if (!existingSchedule) {
				// Create new schedule
				const schedule = new MatchSchedule();
				schedule.matchId = match.matchId;
				schedule.tournamentId = tournament.tournamentId;
				schedule.scheduledTime = UNSCHEDULED_MATCH_DATE;
				schedule.roundNumber = match.round;
				schedule.notified = false;
				schedule.threadId = null;
				schedulesToInsert.push(schedule);
			} else {
				// Update existing schedule only if fields are missing or time is unscheduled
				let needsUpdate = false;

				// Update round number if missing
				if (existingSchedule.roundNumber === null || existingSchedule.roundNumber === undefined) {
					existingSchedule.roundNumber = match.round;
					needsUpdate = true;
				}

				// Update scheduled time only if it's currently the sentinel date (not manually set)
				if (isUnscheduledTime(existingSchedule.scheduledTime)) {
					// Keep it as sentinel date - it's already correct
					// This ensures we don't overwrite manually set times
				}

				if (needsUpdate) {
					schedulesToUpdate.push(existingSchedule);
					updatedCount++;
				}
			}
		}

		// Bulk insert new schedules
		if (schedulesToInsert.length > 0) {
			await MatchSchedule.save(schedulesToInsert);
		}

		// Save updated schedules
		if (schedulesToUpdate.length > 0) {
			await MatchSchedule.save(schedulesToUpdate);
		}

		const addedSchedules = schedulesToInsert.length;
		const skippedSchedules = challongeMatches.length - addedSchedules - updatedCount;

		// Map Challonge state to TournamentStatus
		let status: TournamentStatus | undefined;
		if (tournamentData.state) {
			switch (tournamentData.state) {
				case "pending":
					status = TournamentStatus.PREPARING;
					break;
				case "underway":
					status = TournamentStatus.IPR;
					break;
				case "complete":
					status = TournamentStatus.COMPLETE;
					break;
			}
		}

		// Map Challonge tournament type to TournamentFormat
		let format: TournamentFormat | undefined;
		if (tournamentData.format) {
			// Challonge formats match our enum values exactly
			format = tournamentData.format as TournamentFormat;
		}

		// Challonge returns null for signup_cap when there's no limit
		// We use 0 to indicate no limit in our database
		const participantLimit = tournamentData.signupCap ?? 0;

		// Update tournament in database
		tournament.name = tournamentData.name;
		tournament.description = tournamentData.desc;
		if (status) tournament.status = status;
		if (format) tournament.format = format;
		tournament.participantLimit = participantLimit;
		await tournament.save();

		return {
			success: true,
			matchedPlayers: matchedCount,
			addedSchedules,
			updatedSchedules: updatedCount,
			skippedSchedules,
			name: tournament.name,
			status,
			format,
			participantLimit
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error during sync"
		};
	}
}
