import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ChallongeTournament } from "./ChallongeTournament";

@Entity()
export class EnrolledPlayer extends BaseEntity {
	@PrimaryGeneratedColumn()
	id!: number;

	@Column()
	tournamentId!: string;

	@Column()
	email!: string;

	@Column({ nullable: true })
	name?: string;

	@Column()
	team!: string;

	@Column({ nullable: true })
	discordUsername?: string;

	@Column({ nullable: true, type: "int" })
	otp?: number;

	@Column({ default: 0 })
	emailSent!: number;

	@Column({ default: false })
	verified!: boolean;

	/**
	 * Identity verification (this Discord account proved ownership of the
	 * enrolment email, or an organiser explicitly linked it) is recorded
	 * separately from Discord access provisioning so a failed role assignment
	 * can be retried without repeating verification.
	 */
	@Column({ default: false })
	identityVerified!: boolean;

	/// Set when identity was established; null while unverified.
	@Column({ type: process.env.SQLITE_DB ? "datetime" : "timestamptz", nullable: true })
	identityVerifiedAt?: Date | null;

	/// Pending participant-role grant to retry when Discord access fails.
	@Column({ default: false })
	accessPending!: boolean;

	/// Who established the identity link: "email" or an organiser snowflake.
	@Column({ type: "varchar", length: 32, nullable: true })
	identityVerifiedBy?: string | null;

	@Column({ nullable: true })
	discordId?: string;

	// Legacy column name; stores the Challengermode lineup UUID.
	@Column({ nullable: true, type: "varchar", length: 64 })
	challongeId?: string;

	@ManyToOne(() => ChallongeTournament, t => t.enrolledPlayers, { onDelete: "CASCADE" })
	@JoinColumn({ name: "tournamentId" })
	tournament!: ChallongeTournament;
}
