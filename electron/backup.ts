import * as fs from 'fs';
import * as path from 'path';

/**
 * Desktop pre-upgrade backups (guide 7.4 / 25).
 *
 * Copies the SQLite database, the secret-free config file, and the secrets
 * file into userData/backups before an application version change. PostgreSQL
 * is not file-copied: the manifest records that an engine-level backup is
 * required and points at the server-side backup API when that exists.
 * Restoration is a documented manual step; this module does not claim a
 * tested restore until the backup can be opened.
 */

export interface BackupManifest {
	id: string;
	createdAt: string;
	reason: 'upgrade' | 'manual';
	appVersionFrom: string;
	appVersionTo: string;
	schemaVersion: number | null;
	engine: 'sqlite' | 'postgresql';
	files: { name: string; bytes: number }[];
	notes: string[];
	restore: {
		automatic: false;
		instructions: string;
	};
}

export interface BackupRequest {
	userDataDir: string;
	appVersionFrom: string;
	appVersionTo: string;
	schemaVersion: number | null;
	engine: 'sqlite' | 'postgresql';
	sqlitePath?: string;
	configPath: string;
	secretsPath?: string;
	reason?: 'upgrade' | 'manual';
	now?: Date;
}

export interface BackupResult {
	created: boolean;
	directory?: string;
	manifest?: BackupManifest;
	reason?: string;
}

function stamp(date: Date): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

function copyIfExists(source: string | undefined, destinationDir: string, name: string): { name: string; bytes: number } | null {
	if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return null;
	const target = path.join(destinationDir, name);
	fs.copyFileSync(source, target);
	return { name, bytes: fs.statSync(target).size };
}

export function createPreUpgradeBackup(request: BackupRequest): BackupResult {
	if (request.appVersionFrom === request.appVersionTo && request.reason !== 'manual') {
		return { created: false, reason: 'Version is unchanged, so no upgrade backup was created.' };
	}

	const now = request.now ?? new Date();
	const id = `${stamp(now)}-v${safeSegment(request.appVersionFrom)}-to-v${safeSegment(request.appVersionTo)}`;
	const directory = path.join(request.userDataDir, 'backups', id);
	fs.mkdirSync(directory, { recursive: true });

	const files: { name: string; bytes: number }[] = [];
	const notes: string[] = [];

	if (request.engine === 'sqlite') {
		const copied = copyIfExists(request.sqlitePath, directory, 'dot.db');
		if (copied) files.push(copied);
		else notes.push('No SQLite database file was present to copy.');
	} else {
		notes.push('PostgreSQL data is not stored in a single file. Take an engine-level backup (pg_dump) before relying on this upgrade. Desktop copies only configuration.');
	}

	const config = copyIfExists(request.configPath, directory, 'config.json');
	if (config) files.push(config);
	else notes.push('No config.json was present to copy.');

	const secrets = copyIfExists(request.secretsPath, directory, 'secrets.json');
	if (secrets) {
		files.push(secrets);
		notes.push('secrets.json is included. It is encrypted with the OS key store when that was available at save time. A copy cannot be decrypted on a different machine or user account.');
	}

	notes.push('Configuration secrets are restored separately from the database: copy config.json and secrets.json back into the user-data folder while the app is stopped, then start the app once.');

	const manifest: BackupManifest = {
		id,
		createdAt: now.toISOString(),
		reason: request.reason ?? 'upgrade',
		appVersionFrom: request.appVersionFrom,
		appVersionTo: request.appVersionTo,
		schemaVersion: request.schemaVersion,
		engine: request.engine,
		files,
		notes,
		restore: {
			automatic: false,
			instructions: request.engine === 'sqlite'
				? 'Stop the app. Replace the current database file with dot.db from this folder. Copy config.json and secrets.json back only if you also need the previous settings. Start the previous app version if the schema is not backwards compatible.'
				: 'Stop the app. Restore the PostgreSQL database with the engine tool you used to back it up. Copy config.json and secrets.json back only if you also need the previous settings.'
		}
	};

	fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
	return { created: true, directory, manifest };
}

function safeSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

export function listBackups(userDataDir: string): BackupManifest[] {
	const root = path.join(userDataDir, 'backups');
	if (!fs.existsSync(root)) return [];
	const manifests: BackupManifest[] = [];
	for (const entry of fs.readdirSync(root)) {
		const manifestPath = path.join(root, entry, 'manifest.json');
		if (!fs.existsSync(manifestPath)) continue;
		try {
			manifests.push(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BackupManifest);
		} catch {
			// Skip unreadable manifests rather than failing the whole list.
		}
	}
	return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
