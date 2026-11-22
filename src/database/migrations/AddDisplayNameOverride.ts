import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddDisplayNameOverride1793433600000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.addColumn("challonge_tournament", new TableColumn({
			name: "displayNameOverride", type: "varchar", isNullable: true
		}));
	}
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.dropColumn("challonge_tournament", "displayNameOverride");
	}
}
