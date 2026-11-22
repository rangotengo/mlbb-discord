import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddCheckInChannel1793491200000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.addColumn("challonge_tournament", new TableColumn({
			name: "checkInChannelId", type: "varchar", length: "20", default: "'1566425054168744057'"
		}));
	}
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.dropColumn("challonge_tournament", "checkInChannelId");
	}
}
