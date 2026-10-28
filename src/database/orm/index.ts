import "reflect-metadata";
import { ChallengermodeIdentifiers1793100000000 } from "../migrations/ChallengermodeIdentifiers";
import { CompleteSchema1793120000000 } from "../migrations/CompleteSchema";
import { IdentityLifecycle1793110000000 } from "../migrations/IdentityLifecycle";
import { createConnection } from "typeorm";
import { getLogger } from "../../util/logger";
import { ChallongeTournament } from "./ChallongeTournament";
import { Countdown } from "./Countdown";
import { Participant } from "./Participant";
import { EnrolledPlayer } from "./EnrolledPlayer";
import { MatchSchedule } from "./MatchSchedule";
import { VerificationChallenge } from "./VerificationChallenge";
import { claimDatabaseFile, replaceDatabaseFile } from "../sqliteFile";
import * as fs from "fs";
import * as path from "path";

const logger = getLogger("typeorm");

const entities = [
	ChallongeTournament,
	Countdown,
	Participant,
	EnrolledPlayer,
	MatchSchedule,
	VerificationChallenge
];

const migrations = [
	ChallengermodeIdentifiers1793100000000,
	IdentityLifecycle1793110000000,
	CompleteSchema1793120000000
];

export async function initializeConnection(postgresqlUrl: string): Promise<void> {
	if (process.env.SQLITE_DB) {
		const dbPath = process.env.SQLITE_DB;
		const dbDir = path.dirname(dbPath);

		// Ensure directory exists
		if (!fs.existsSync(dbDir)) {
			fs.mkdirSync(dbDir, { recursive: true });
		}

		// Create empty database file if it doesn't exist
		if (!fs.existsSync(dbPath)) {
			fs.writeFileSync(dbPath, Buffer.from([]));
			logger.info(`Created new database file at ${dbPath}`);
		}
		claimDatabaseFile(dbPath);

		await createConnection({
			type: "sqljs",
			location: dbPath,
			autoSave: true,
			autoSaveCallback: (data: Uint8Array) => {
				try {
					replaceDatabaseFile(dbPath, data);
				} catch (error) {
					logger.error("Failed to save SQLite database:", error);
					throw error;
				}
			},
			entities,
			migrations,
			migrationsRun: true,
			logging: "all",
			logger: "debug",
			// Populated production databases are migrated, not synchronised.
			// Empty databases receive the frozen baseline schema migration.
			synchronize: process.env.NODE_ENV !== "production"
		});
		logger.info(`Connected to SQLite via sql.js TypeORM at ${dbPath}`);
	} else {
		await createConnection({
			type: "postgres",
			url: postgresqlUrl,
			entities,
			migrations,
			migrationsRun: true,
			logging: "all",
			logger: "debug",
			synchronize: process.env.NODE_ENV !== "production"
		});
		if (process.env.NODE_ENV === "production") {
			logger.warn("Production mode: synchronize is disabled. Ensure migrations are run manually to keep schema in sync.");
		}
		logger.info(`Connected to PostgreSQL via TypeORM`);
	}
}

export {
	ChallongeTournament,
	Countdown,
	Participant,
	EnrolledPlayer,
	MatchSchedule,
	VerificationChallenge
};
