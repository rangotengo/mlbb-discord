import { MigrationInterface, QueryRunner, Table, TableOptions } from "typeorm";
import sqliteSchema from "./schema-sqlite.json";
import postgresSchema from "./schema-postgres.json";

/** Frozen schema snapshot: create missing tables without synchronising user data. */
export class CompleteSchema1793120000000 implements MigrationInterface {
	name = "CompleteSchema1793120000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		const schema = queryRunner.connection.options.type === "postgres" ? postgresSchema : sqliteSchema;
		for (const definition of schema) {
			if (!await queryRunner.hasTable(definition.name)) {
				await queryRunner.createTable(new Table(definition as TableOptions), true);
			}
		}
	}

	public async down(): Promise<void> {
		throw new Error("Restore a pre-upgrade backup to downgrade without deleting participant data.");
	}
}
