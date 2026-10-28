import { BaseEntity, Column, Entity, OneToMany, PrimaryColumn } from "typeorm";
import { TournamentFormat, TournamentStatus } from "../interface";
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

	/// The actual Challengermode tournament ID/slug (extracted from Challengermode URL)
	/// This is used to query the Challengermode API
	@Column()
	challongeTournamentId!: string;

	/// User-provided short name.
	@Column()
	name!: string;

	/// User-provided description of arbitrary length.
	@Column("text")
	description!: string;

	/// Discord server snowflake. A uint64 is at most 20 digits in decimal.
	@Column({ length: 20 })
	owningDiscordServer!: string;

	/// Formats supported by Challengermode, named the same way.
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

	/// Stable Discord role snowflake. Name remains a display fallback after renames.
	@Column({ type: "varchar", length: 20, nullable: true })
	participantRoleId?: string | null;

	/// The currently active round for this tournament. Null means no round is active.
	/// Used to determine which match threads newly verified users should be added to.
	@Column({ nullable: true })
	activeRound?: number;

	/// When true, all check-in and verification commands (!check-in, !email, !verify) are blocked.
	@Column({ default: false })
	checkInDisabled!: boolean;

	@Column({ type: process.env.SQLITE_DB ? "datetime" : "timestamptz", nullable: true })
	lastSyncAttempt?: Date | null;

	@Column({ type: process.env.SQLITE_DB ? "datetime" : "timestamptz", nullable: true })
	lastSyncSuccess?: Date | null;

	@Column({ type: "varchar", length: 32, nullable: true })
	syncSource?: string | null;

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
	 * Gets the actual Challengermode tournament ID for API calls.
	 *
	 * @returns The Challengermode tournament ID to use for API queries
	 */
	getChallongeIdForApi(): string {
		return this.challongeTournamentId;
	}
}
