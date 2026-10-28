import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ChallongeTournament } from "./ChallongeTournament";

/**
 * Represents a scheduled match time for a tournament match.
 * Used to track when matches should occur and notification status.
 */
@Entity()
export class MatchSchedule extends BaseEntity {
	/// Auto-generated primary key
	@PrimaryGeneratedColumn()
	id!: number;

	/// Challengermode match ID
	@Column({ type: "varchar", length: 64 })
	matchId!: string;

	/// Tournament identifier - foreign key to ChallongeTournament
	@Column({ length: 50 })
	tournamentId!: string;

	/// When the match is scheduled to occur
	@Column(process.env.SQLITE_DB ? "datetime" : "timestamptz")
	scheduledTime!: Date;

	/// Round number for this match (used to group matches by round)
	@Column({ nullable: true })
	roundNumber?: number;

	/// Whether notifications have been sent for this match
	@Column({ default: false })
	notified!: boolean;

	/// Discord thread ID for this match (created by !round)
	@Column({ type: "varchar", nullable: true, length: 20 })
	threadId!: string | null;

	/// Discord channel ID where the thread was created
	@Column({ type: "varchar", nullable: true, length: 20 })
	channelId!: string | null;

	/// The associated tournament
	@ManyToOne(() => ChallongeTournament, { onDelete: "CASCADE" })
	@JoinColumn({ name: "tournamentId" })
	tournament?: ChallongeTournament;
}
