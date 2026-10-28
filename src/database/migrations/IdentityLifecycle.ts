import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Introduces the verification challenge record and splits identity
 * verification from Discord access provisioning on enrolled players.
 *
 * Existing rows keep their meaning: `verified` was only ever set after
 * successful role assignment, so backfilling `identityVerified` from it is
 * safe, and no historical row has a pending grant.
 */
export class IdentityLifecycle1793110000000 implements MigrationInterface {
	name = "IdentityLifecycle1793110000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		const isPostgres = queryRunner.connection.options.type === "postgres";
		const datetimeType = isPostgres ? "timestamptz" : "datetime";

		// A fresh installation has no tables yet; entities create the full schema.
		const table = await queryRunner.getTable("enrolled_player");
		if (table) {
			const addColumn = async (name: string, definition: string): Promise<void> => {
				if (table.findColumnByName(name)) return;
				await queryRunner.query(`ALTER TABLE "enrolled_player" ADD COLUMN ${definition}`);
			};
			await addColumn("identityVerified", `"identityVerified" boolean NOT NULL DEFAULT false`);
			await addColumn("identityVerifiedAt", `"identityVerifiedAt" ${datetimeType} NULL`);
			await addColumn("accessPending", `"accessPending" boolean NOT NULL DEFAULT false`);
			await addColumn("identityVerifiedBy", `"identityVerifiedBy" varchar(32) NULL`);
			const tournament = await queryRunner.getTable("challonge_tournament");
			if (tournament && !tournament.findColumnByName("participantRoleId")) {
				await queryRunner.query(`ALTER TABLE "challonge_tournament" ADD COLUMN "participantRoleId" varchar(20) NULL`);
			}
			if (tournament && !tournament.findColumnByName("lastSyncAttempt")) {
				await queryRunner.query(`ALTER TABLE "challonge_tournament" ADD COLUMN "lastSyncAttempt" ${datetimeType} NULL`);
				await queryRunner.query(`ALTER TABLE "challonge_tournament" ADD COLUMN "lastSyncSuccess" ${datetimeType} NULL`);
				await queryRunner.query(`ALTER TABLE "challonge_tournament" ADD COLUMN "syncSource" varchar(32) NULL`);
			}

			await queryRunner.query(`UPDATE "enrolled_player" SET "identityVerified" = "verified" WHERE "verified" = true`);
			await queryRunner.query(
				`UPDATE "enrolled_player" SET "identityVerifiedAt" = CURRENT_TIMESTAMP WHERE "identityVerified" = true AND "identityVerifiedAt" IS NULL`
			);
		}

		const enrolled = await queryRunner.getTable("enrolled_player");
		if (enrolled) {
			await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_enrolled_player_discord" ON "enrolled_player" ("discordId", "tournamentId")`);
			await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_enrolled_player_tournament" ON "enrolled_player" ("tournamentId", "verified")`);
		}
		const schedules = await queryRunner.getTable("match_schedule");
		if (schedules) {
			await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_match_schedule_tournament" ON "match_schedule" ("tournamentId", "scheduledTime")`);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {		const table = await queryRunner.getTable("enrolled_player");
		if (table) {
			for (const column of ["identityVerified", "identityVerifiedAt", "accessPending", "identityVerifiedBy"]) {
				if (table.findColumnByName(column)) {
					await queryRunner.query(`ALTER TABLE "enrolled_player" DROP COLUMN "${column}"`);
				}
			}
		}
	}
}
