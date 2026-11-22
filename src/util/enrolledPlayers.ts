import { TournamentStatus } from "../database/interface";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { parseDiscordId } from "./discordId";

type TournamentGate = {
	status: TournamentStatus;
	checkInDisabled: boolean;
};

/**
 * A player is stored once per tournament, but the same person can be enrolled in several.
 * Prefer tournaments that are still running. A finished tournament only remains actionable
 * when the player has no current tournament left to act on.
 */
export function selectActionableEnrollments<T extends { tournamentId: string }>(
	players: T[],
	tournaments: ReadonlyMap<string, TournamentGate>
): { actionable: T[]; closed: boolean } {
	const accepting = players.filter(player => {
		const tournament = tournaments.get(player.tournamentId);
		return !!tournament && !tournament.checkInDisabled;
	});
	if (!accepting.length) return { actionable: [], closed: players.length > 0 };
	const current = accepting.filter(player => tournaments.get(player.tournamentId)!.status !== TournamentStatus.COMPLETE);
	return { actionable: current.length ? current : accepting, closed: false };
}

export function enrollmentMatchesDiscord(player: EnrolledPlayer, discordId: string, names: string[]): boolean {
	const storedId = player.discordId || parseDiscordId(player.discordUsername);
	if (storedId) return storedId === discordId;
	return !!player.discordUsername && names.includes(player.discordUsername.toLowerCase());
}

/** Other roster rows for the same email belong to the same player, even before that row stores a Discord id. */
export function expandEnrollmentsByEmail(matched: EnrolledPlayer[], all: EnrolledPlayer[]): EnrolledPlayer[] {
	if (!matched.length) return [];
	const emails = new Set(matched.map(player => player.email.toLowerCase()));
	const seen = new Set(matched.map(player => player.id));
	return [
		...matched,
		...all.filter(player => !seen.has(player.id) && emails.has(player.email.toLowerCase()))
	];
}

export function formatTournamentList(names: string[]): string {
	const unique = [...new Set(names)];
	if (unique.length <= 1) return `**${unique[0] || "the tournament"}**`;
	if (unique.length === 2) return `**${unique[0]}** and **${unique[1]}**`;
	return `${unique.slice(0, -1).map(name => `**${name}**`).join(", ")}, and **${unique[unique.length - 1]}**`;
}

/**
 * Find this player's row in a tournament. A Discord account already verified on another
 * tournament counts for a later enrollment that uses the same email.
 */
export async function findLinkedEnrollment(
	discordId: string,
	tournamentId: string,
	discordUsername?: string
): Promise<{ player: EnrolledPlayer | null; newlyLinked: boolean }> {
	const direct = await EnrolledPlayer.findOne({
		where: { discordId, tournamentId },
		relations: ["tournament"]
	});
	if (direct?.verified) return { player: direct, newlyLinked: false };

	const known = await EnrolledPlayer.find({ where: { discordId } });
	const verifiedEmails = new Set(known.filter(player => player.verified).map(player => player.email.toLowerCase()));
	if (!verifiedEmails.size) return { player: direct, newlyLinked: false };

	let enrollment = direct;
	if (!enrollment) {
		const rows = await EnrolledPlayer.find({ where: { tournamentId }, relations: ["tournament"] });
		enrollment = rows.find(row => !row.verified && !row.discordId && verifiedEmails.has(row.email.toLowerCase())) || null;
	}
	if (!enrollment || enrollment.verified || !verifiedEmails.has(enrollment.email.toLowerCase())) {
		return { player: enrollment, newlyLinked: false };
	}

	const source = known.find(player => player.verified && player.email.toLowerCase() === enrollment!.email.toLowerCase());
	enrollment.verified = true;
	enrollment.discordId = discordId;
	enrollment.otp = null;
	enrollment.discordUsername = discordUsername || enrollment.discordUsername || source?.discordUsername;
	if (!enrollment.tournament) {
		const tournament = await ChallongeTournament.findOne({ where: { tournamentId } });
		if (tournament) enrollment.tournament = tournament;
	}
	await enrollment.save();
	return { player: enrollment, newlyLinked: true };
}
