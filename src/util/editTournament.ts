import { EntityManager } from "typeorm";
import { ChallongeTournament, EnrolledPlayer, Participant, MatchSchedule, Countdown } from "../database/orm";
import { UserError } from "./errors";

export class TournamentEditError extends UserError {
	constructor(message: string, public readonly status: number = 400) { super(message); }
}

export async function editTournament(
	manager: EntityManager, oldId: string, changes: Record<string, unknown>
): Promise<ChallongeTournament> {
	const tournament = await manager.findOne(ChallongeTournament, { where: { tournamentId: oldId } });
	if (!tournament) throw new TournamentEditError("Tournament not found", 404);
	const newId = changes.tournamentId === undefined ? oldId : changes.tournamentId;
	if (typeof newId !== "string" || !newId.trim() || newId.trim().length > 50 || /[/\\?#\u0000-\u001f]/.test(newId)) {
		throw new TournamentEditError("Tournament ID must contain 1–50 characters without /, \\, ?, #, or control characters");
	}
	const id = newId.trim();
	if (changes.name !== undefined) {
		if (typeof changes.name !== "string" || !changes.name.trim()) throw new TournamentEditError("Tournament name cannot be empty");
		tournament.name = changes.name.trim();
		tournament.displayNameOverride = tournament.name;
	}
	if (changes.description !== undefined) {
		if (typeof changes.description !== "string") throw new TournamentEditError("Description must be text");
		tournament.description = changes.description;
	}
	if (changes.participantRoleName !== undefined) {
		if (typeof changes.participantRoleName !== "string") throw new TournamentEditError("Participant role must be text");
		tournament.participantRoleName = changes.participantRoleName;
	}
	if (changes.checkInChannelId !== undefined) {
		const value = changes.checkInChannelId;
		if (typeof value !== "string" || !/^\d{17,20}$/.test(value) || BigInt(value) > 18446744073709551615n) {
			throw new TournamentEditError("Enter a valid Discord check-in channel ID");
		}
		tournament.checkInChannelId = value;
	}
	if (changes.status !== undefined) {
		if (!["preparing", "in progress", "complete"].includes(changes.status as string)) throw new TournamentEditError("Invalid tournament status");
		tournament.status = changes.status as ChallongeTournament["status"];
	}
	if (id === oldId) return manager.save(tournament);
	if (await manager.findOne(ChallongeTournament, { where: { tournamentId: id } })) {
		throw new TournamentEditError("That tournament ID is already in use", 409);
	}
	// Insert the new parent before moving foreign keys, then remove only the old parent.
	// All operations run in the caller's transaction, so failures leave the original intact.
	tournament.tournamentId = id;
	await manager.insert(ChallongeTournament, tournament);
	for (const entity of [EnrolledPlayer, Participant, MatchSchedule, Countdown]) {
		await manager.update(entity, { tournamentId: oldId }, { tournamentId: id });
	}
	await manager.delete(ChallongeTournament, { tournamentId: oldId });
	return tournament;
}
