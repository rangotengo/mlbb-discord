import { BaseEntity, Column, Entity, OneToMany, PrimaryColumn } from "typeorm";
import { TournamentFormat, TournamentPhase, TournamentStatus } from "../interface";
import { Countdown } from "./Countdown";
import { EnumColumn, JsonArrayColumn } from "./decorators";
import { Participant } from "./Participant";
import { EnrolledPlayer } from "./EnrolledPlayer";

/**
 * The main entity for all information related to one tournament.
 */
@Entity()
export class ChallongeTournament extends BaseEntity {
	/// Bot's internal tournament identifier (custom name provided by user)
	@PrimaryColumn()
	tournamentId!: string;

	/// The actual Challonge tournament ID/slug (extracted from Challonge URL).
	/// Empty until a pre-check-in tournament creates its bracket.
	@Column({ nullable: true })
	challongeTournamentId?: string;

	/// User-provided short name.
	@Column()
	name!: string;

	/// Optional dashboard name, preserved when syncing from Challonge.
	@Column({ nullable: true })
	displayNameOverride?: string;

	/// User-provided description of arbitrary length.
	@Column("text")
	description!: string;

	/// Discord server snowflake. A uint64 is at most 20 digits in decimal.
	@Column({ length: 20 })
	owningDiscordServer!: string;

	/// Formats supported by Challonge, named the same way.
	@EnumColumn(TournamentFormat, "SWISS")
	format!: TournamentFormat;

	/// An array of Discord user snowflakes. Whenever hosts are queried, the rest
	/// of the tournament information is wanted anyway. Should be distinct.
	@JsonArrayColumn()
	hosts!: string[];

	/// An array of Discord channel snowflakes. Should be distinct.
	@JsonArrayColumn()
	publicChannels!: string[];

	/// An array of Discord channel snowflakes. Should be distinct.
	@JsonArrayColumn()
	privateChannels!: string[];

	/// Simple state progression in the listed order above.
	@EnumColumn(TournamentStatus, "PREPARING")
	status!: TournamentStatus;

	/// Optional maximum capacity of this tournament. 0 indicates no limit. Negatives invalid.
	@Column({ default: 0 })
	participantLimit!: number;

	@Column({ default: true })
	autoPushScores!: boolean;

	@Column({ nullable: true })
	scoreReviewChannelId?: string;

	/// Optional participant role name for this tournament. If not set, defaults to "Participant"
	@Column({ nullable: true, length: 100 })
	participantRoleName?: string;

	/// The currently active round for this tournament. Null means no round is active.
	/// Used to determine which match threads newly verified users should be added to.
	@Column({ nullable: true })
	activeRound?: number;

	@Column({ default: "1566425054168744057", length: 20 })
	checkInChannelId!: string;

	/// When true, all check-in and verification commands (!check-in, !email, !verify) are blocked.
	@Column({ default: false })
	checkInDisabled!: boolean;

	/// Linked tournaments already exist on Challonge.
	/// Pre-check-in tournaments collect team attendance before the bracket exists.
	@EnumColumn(TournamentPhase, "LINKED")
	phase!: TournamentPhase;

	/// Team names that confirmed attendance while phase is checkin-open.
	/// Distinct from EnrolledPlayer.verified, which is Discord identity verification.
	@JsonArrayColumn()
	checkedInTeams!: string[];

	/// The ORM relationship for all participants, pending and confirmed.
	@OneToMany(() => Participant, participant => participant.tournament, { cascade: true, onDelete: "CASCADE" })
	participants!: Participant[];

	/// The ORM relationship for confirmed participants.
	@OneToMany(() => Participant, participant => participant.tournament, { cascade: true, onDelete: "CASCADE" })
	confirmed!: Participant[];

	countdowns!: Countdown[];

	@OneToMany(() => EnrolledPlayer, ep => ep.tournament, { cascade: true, onDelete: "CASCADE" })
	enrolledPlayers!: EnrolledPlayer[];

	/**
	 * Gets the actual Challonge tournament ID for API calls.
	 *
	 * @returns The Challonge tournament ID to use for API queries
	 */
	getChallongeIdForApi(): string {
		if (!this.challongeTournamentId) {
			throw new Error(`Tournament "${this.tournamentId}" has no Challonge bracket yet.`);
		}
		return this.challongeTournamentId;
	}

	hasChallongeBracket(): boolean {
		return !!this.challongeTournamentId;
	}
}
