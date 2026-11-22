import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPreCheckin1732230000000 implements MigrationInterface {
	name = "AddPreCheckin1732230000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE challonge_tournament ALTER COLUMN "challongeTournamentId" DROP NOT NULL`);
		await queryRunner.query(
			`ALTER TABLE challonge_tournament ADD COLUMN IF NOT EXISTS phase character varying NOT NULL DEFAULT 'linked'`
		);
		await queryRunner.query(
			`ALTER TABLE challonge_tournament ADD COLUMN IF NOT EXISTS "checkedInTeams" json NOT NULL DEFAULT '[]'`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE challonge_tournament DROP COLUMN IF EXISTS "checkedInTeams"`);
		await queryRunner.query(`ALTER TABLE challonge_tournament DROP COLUMN IF EXISTS phase`);
		await queryRunner.query(
			`ALTER TABLE challonge_tournament ALTER COLUMN "challongeTournamentId" SET NOT NULL`
		);
	}
}
