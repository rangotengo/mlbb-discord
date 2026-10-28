import { MigrationInterface, QueryRunner } from "typeorm";

/** Preserve legacy numeric IDs as text while allowing Challengermode UUIDs. */
export class ChallengermodeIdentifiers1793100000000 implements MigrationInterface {
	name = "ChallengermodeIdentifiers1793100000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		for (const [tableName, columnName] of [["enrolled_player", "challongeId"], ["match_schedule", "matchId"]]) {
			const table = await queryRunner.getTable(tableName);
			const column = table?.findColumnByName(columnName);
			// A fresh installation has no tables yet; schema creation follows migrations.
			if (!column || column.type === "varchar" || column.type === "character varying") continue;
			if (queryRunner.connection.options.type === "postgres") {
				// TypeORM changeColumn drops and recreates a PostgreSQL column on type changes.
				await queryRunner.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" TYPE varchar(64) USING "${columnName}"::text`);
			} else {
				const replacement = column.clone();
				replacement.type = "varchar";
				replacement.length = "64";
				await queryRunner.changeColumn(tableName, column, replacement);
			}
		}
	}

	public async down(): Promise<void> {
		throw new Error("UUID identifiers cannot be converted back to integers. Restore a pre-migration backup to downgrade.");
	}
}
