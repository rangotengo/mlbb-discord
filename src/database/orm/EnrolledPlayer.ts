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
	otp?: number | null;

	@Column({ default: 0 })
	emailSent!: number;

	@Column({ default: false })
	verified!: boolean;

	@Column({ nullable: true })
	discordId?: string;

	@Column({ nullable: true, type: "int" })
	challongeId?: number;

	@ManyToOne(() => ChallongeTournament, t => t.enrolledPlayers, { onDelete: "CASCADE" })
	@JoinColumn({ name: "tournamentId" })
	tournament!: ChallongeTournament;
}
