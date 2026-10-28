import { IsNull, Not } from "typeorm";
import { EnrolledPlayer } from "./orm";
import {
	AssertStatusError,
	TournamentNotFoundError,
	UnauthorisedHostError,
	UnauthorisedPlayerError,
	UserError
} from "../util/errors";
import {
	DatabasePlayer,
	DatabaseTournament,
	SynchroniseTournament,
	TournamentStatus
} from "./interface";
import { ChallongeTournament, initializeConnection } from "./orm";

export class DatabaseWrapperPostgres {
	private wrap(tournament: ChallongeTournament): DatabaseTournament {
		return {
			id: tournament.tournamentId,
			challongeTournamentId: tournament.challongeTournamentId,
			name: tournament.name,
			description: tournament.description,
			format: tournament.format,
			status: tournament.status,
			hosts: tournament.hosts.slice(),
			players: [],
			limit: tournament.participantLimit,
			publicChannels: tournament.publicChannels.slice(),
			privateChannels: tournament.privateChannels.slice(),
			server: tournament.owningDiscordServer,
			byes: [],
			findPlayer: (id: string): DatabasePlayer => {
				throw new UnauthorisedPlayerError(id, tournament.tournamentId);
			}
		};
	}

	// This wrapper is only needed because the exception class is part of the call signature
	private async findTournament(tournamentId: string, relations: string[] = []): Promise<ChallongeTournament> {
		try {
			return await ChallongeTournament.findOneOrFail({ where: { tournamentId }, relations });
		} catch (err) {
			throw new TournamentNotFoundError(tournamentId);
		}
	}

	public async authenticateHost(
		tournamentId: string,
		hostId: string,
		serverId: string | null,
		assertStatus?: TournamentStatus,
		isAuthorized?: boolean
	): Promise<DatabaseTournament> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.owningDiscordServer !== serverId) {
			throw new TournamentNotFoundError(tournamentId);
		}
		if (!isAuthorized) {
			throw new UnauthorisedHostError(hostId, tournamentId);
		}
		if (assertStatus && tournament.status !== assertStatus) {
			throw new AssertStatusError(tournamentId, assertStatus, tournament.status);
		}
		return this.wrap(tournament);
	}

	async getTournament(tournamentId: string, assertStatus?: TournamentStatus): Promise<DatabaseTournament> {
		const tournament = await this.findTournament(tournamentId);
		if (assertStatus && tournament.status !== assertStatus) {
			throw new AssertStatusError(tournamentId, assertStatus, tournament.status);
		}
		return this.wrap(tournament);
	}

	async updateTournament(tournamentId: string, name: string, desc: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.status !== TournamentStatus.PREPARING) {
			throw new AssertStatusError(tournamentId, TournamentStatus.PREPARING, tournament.status);
		}
		tournament.name = name;
		tournament.description = desc;
		await tournament.save();
	}


	async addHost(tournamentId: string, newHost: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.hosts.includes(newHost)) {
			throw new UserError(`Tournament ${tournamentId} already includes user ${newHost} as a host!`);
		}
		tournament.hosts.push(newHost);
		await tournament.save();
	}

	async removeHost(tournamentId: string, newHost: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.hosts.length < 2) {
			throw new UserError(`Tournament ${tournamentId} has too few hosts to remove one!`);
		}
		if (!tournament.hosts.includes(newHost)) {
			throw new UserError(`Tournament ${tournamentId} doesn't include user ${newHost} as a host!`);
		}
		const i = tournament.hosts.indexOf(newHost);
		// i < 0 is impossible by precondition
		tournament.hosts.splice(i, 1);
		await tournament.save();
	}

	async startTournament(tournamentId: string): Promise<void> {
		await ChallongeTournament.createQueryBuilder()
			.update(ChallongeTournament)
			.set({
				status: TournamentStatus.IPR
			})
			.where("tournamentId = :tournamentId", { tournamentId })
			.execute();
	}

	async finishTournament(tournamentId: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		tournament.status = TournamentStatus.COMPLETE;
		await tournament.save();
	}

	async getActiveTournaments(server?: string): Promise<DatabaseTournament[]> {
		const owningDiscordServer = server || Not(IsNull());
		const tournaments = await ChallongeTournament.find({
			where: [
				{ owningDiscordServer, status: TournamentStatus.IPR },
				{ owningDiscordServer, status: TournamentStatus.PREPARING }
			]
		});
		return tournaments.map(t => this.wrap(t));
	}

	async getConfirmedPlayer(discordId: string, tournamentId: string): Promise<{ challongeId: string }> {
		const enrolledPlayer = await EnrolledPlayer.findOne({
			where: { discordId, tournamentId }
		});
		if (!enrolledPlayer || !enrolledPlayer.verified || !enrolledPlayer.challongeId) {
			throw new UnauthorisedPlayerError(discordId, tournamentId);
		}
		return { challongeId: enrolledPlayer.challongeId };
	}

	async synchronise(tournamentId: string, data: SynchroniseTournament): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (data.name) tournament.name = data.name;
		if (data.description !== undefined) tournament.description = data.description;
		if (data.status) tournament.status = data.status;
		if (data.format) tournament.format = data.format;
		if (data.participantLimit !== undefined) tournament.participantLimit = data.participantLimit;

		// Update enrolled players' challongeId and discordId
		for (const player of data.players) {
			const enrolledPlayer = await EnrolledPlayer.findOne({
				where: { challongeId: player.challongeId, tournamentId }
			});
			if (enrolledPlayer && player.discordId !== "DUMMY") {
				enrolledPlayer.discordId = player.discordId;
				await enrolledPlayer.save();
			}
		}

		await tournament.save();
	}

}

export async function initializeDatabase(postgresqlUrl: string): Promise<DatabaseWrapperPostgres> {
	await initializeConnection(postgresqlUrl);
	return new DatabaseWrapperPostgres();
}
