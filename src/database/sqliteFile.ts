import * as fs from "fs";
import * as path from "path";

const locks = new Set<string>();

/** Prevents two connections in this process from autosaving one SQL.js file. */
export function claimDatabaseFile(dbPath: string): () => void {
	const key = path.resolve(dbPath);
	if (locks.has(key)) {
		throw new Error(`Database file is already open: ${key}`);
	}
	locks.add(key);
	return () => locks.delete(key);
}

/**
 * Replaces a database file only after the new bytes are durable. A crash
 * during the write leaves either the previous file or a discarded temporary.
 */
export function replaceDatabaseFile(dbPath: string, data: Uint8Array): void {
	const directory = path.dirname(dbPath);
	const temporary = path.join(directory, `.${path.basename(dbPath)}.${process.pid}.tmp`);
	const handle = fs.openSync(temporary, "w");
	try {
		fs.writeSync(handle, Buffer.from(data));
		fs.fsyncSync(handle);
	} finally {
		fs.closeSync(handle);
	}
	fs.renameSync(temporary, dbPath);
}

export interface BackupManifest {
	id: string;
	file: string;
	createdAt: string;
	engine: "sqlite" | "postgres";
	schemaVersion: string;
	sizeBytes: number;
	note: string;
}

const SCHEMA_VERSION = "1793120000000";

export function createSqliteBackup(dbPath: string, backupDirectory: string): BackupManifest {
	if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
		throw new Error("There is no database file to back up.");
	}
	fs.mkdirSync(backupDirectory, { recursive: true });
	const createdAt = new Date();
	const id = createdAt.toISOString().replace(/[:.]/g, "-");
	const file = path.join(backupDirectory, `${id}.sqlite`);
	const bytes = fs.readFileSync(dbPath);
	replaceDatabaseFile(file, bytes);
	const manifest: BackupManifest = {
		id,
		file,
		createdAt: createdAt.toISOString(),
		engine: "sqlite",
		schemaVersion: SCHEMA_VERSION,
		sizeBytes: bytes.byteLength,
		note: "SQLite file copy. Configuration and secrets are not included."
	};
	fs.writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 2));
	return manifest;
}

export function listBackups(backupDirectory: string): BackupManifest[] {
	if (!fs.existsSync(backupDirectory)) return [];
	return fs.readdirSync(backupDirectory)
		.filter(name => name.endsWith(".json"))
		.map(name => JSON.parse(fs.readFileSync(path.join(backupDirectory, name), "utf-8")) as BackupManifest)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Restores only after reading the backup back successfully. The current file
 * is retained beside the restored file so a bad backup can still be reversed.
 */
export function restoreSqliteBackup(manifest: BackupManifest, dbPath: string): void {
	const bytes = fs.readFileSync(manifest.file);
	if (bytes.byteLength !== manifest.sizeBytes) {
		throw new Error("Backup size does not match its manifest. Restore was not applied.");
	}
	if (fs.existsSync(dbPath)) {
		const preserved = `${dbPath}.before-restore-${Date.now()}`;
		fs.copyFileSync(dbPath, preserved);
	}
	replaceDatabaseFile(dbPath, bytes);
	if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size !== bytes.byteLength) {
		throw new Error("Restored database could not be read back.");
	}
}
