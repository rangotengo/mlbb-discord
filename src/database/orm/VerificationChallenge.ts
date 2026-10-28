import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * One in-flight email verification challenge. Codes are stored as keyed
 * digests; raw codes exist only in the outbound email.
 *
 * Bound to the Discord account, guild, and email so a challenge issued in one
 * ticket cannot be replayed for a different enrolment or server. Creating a
 * new challenge for the same subject invalidates its predecessor.
 */
@Entity()
@Index(["discordId", "guildId", "email"], { unique: true })
export class VerificationChallenge extends BaseEntity {
	@PrimaryGeneratedColumn()
	id!: number;

	/// Discord user snowflake the challenge was issued to.
	@Column({ length: 20 })
	discordId!: string;

	/// Discord guild snowflake the ticket belongs to.
	@Column({ length: 20 })
	guildId!: string;

	/// Lowercased email address the code was sent to.
	@Column()
	email!: string;

	/// Keyed digest of the six-digit code.
	@Column({ length: 64 })
	digest!: string;

	@Column()
	expiresAt!: Date;

	/// Earliest time a resend is permitted.
	@Column()
	resendEligibleAt!: Date;

	@Column({ default: 0 })
	attempts!: number;

	@Column({ default: 0 })
	sends!: number;

	/// Delivery attempts (provider accepted or not) for abuse throttling.
	@Column({ default: 0 })
	deliveryAttempts!: number;

	@Column({ default: false })
	consumed!: boolean;
}
