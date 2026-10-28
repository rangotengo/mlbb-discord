import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';

/**
 * OS-backed secret storage for the desktop app (guide 6.3).
 *
 * Secrets (Discord token, Challengermode refresh key, web password, email
 * credentials) never go into config.json. They are stored through Electron's
 * safeStorage API (Electron 35), which uses:
 *   - macOS: Keychain
 *   - Windows: DPAPI
 *   - Linux: libsecret (Secret Service), falling back to a basic_text scheme
 *     when no secret service is available.
 *
 * When safeStorage is unavailable, `secretStoreStatus().secure` is false and
 * secrets are kept in a `secrets.json` file with mode 0600 inside the user
 * data directory. The setup wizard surfaces that fallback so organisers know
 * the machine login is the only protection.
 */

const SECRET_FILE = 'secrets.json';
const PLAINTEXT_WARNING =
	'OS secure storage is unavailable on this system, so credentials are stored in a '
	+ 'protected file in the application data folder instead of the operating system key store. '
	+ 'Protect this computer\'s login.';

export interface StoredSecrets {
	discordToken?: string;
	challengermodeRefreshKey?: string;
	webPassword?: string;
	googleClientId?: string;
	googleClientSecret?: string;
	googleRefreshToken?: string;
	googleTokenUri?: string;
	databaseUrl?: string;
}

export interface SecretStoreStatus {
	/** True when the OS-backed mechanism is in use. */
	secure: boolean;
	/** True when a secret file exists and holds at least one value. */
	configured: boolean;
	/** Human-readable explanation when secure storage is unavailable. */
	warning?: string;
	/** Which mechanism produced the stored data. */
	backend: 'safeStorage' | 'file';
}

const SECRET_KEYS: (keyof StoredSecrets)[] = [
	'discordToken',
	'challengermodeRefreshKey',
	'webPassword',
	'googleClientId',
	'googleClientSecret',
	'googleRefreshToken',
	'googleTokenUri',
	'databaseUrl'
];

let availability: boolean | null = null;

export function secretsFilePath(): string {
	return path.join(app.getPath('userData'), SECRET_FILE);
}

function isAvailable(): boolean {
	if (availability === null) {
		try {
			availability = safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text');
		} catch {
			availability = false;
		}
	}
	return availability;
}

interface RawStore {
	encrypted: boolean;
	values: Record<string, string>;
}

function readRaw(): RawStore | null {
	const file = secretsFilePath();
	if (!fs.existsSync(file)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { encrypted?: boolean; values?: Record<string, string> };
		if (!parsed || typeof parsed !== 'object' || typeof parsed.values !== 'object' || parsed.values === null) return null;
		return { encrypted: parsed.encrypted === true, values: parsed.values };
	} catch {
		return null;
	}
}

function writeRaw(encrypted: boolean, values: Record<string, string>): void {
	const file = secretsFilePath();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	// Atomic write (guide 6.4): write beside the target, then rename.
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify({ encrypted, values }, null, 2), { mode: 0o600 });
	try {
		fs.chmodSync(temp, 0o600);
	} catch {
		// Windows may not honour POSIX modes; DPAPI is the real protection there.
	}
	fs.renameSync(temp, file);
}

function encryptValue(plain: string): string {
	return isAvailable() ? safeStorage.encryptString(plain).toString('base64') : plain;
}

function decryptValue(stored: string): string | null {
	if (!isAvailable()) return null;
	try {
		return safeStorage.decryptString(Buffer.from(stored, 'base64'));
	} catch {
		return null;
	}
}

export function secretStoreStatus(): SecretStoreStatus {
	const encryptedStore = isAvailable();
	const raw = readRaw();
	const configured = raw !== null && Object.keys(raw.values).length > 0;
	return {
		secure: encryptedStore,
		configured,
		warning: encryptedStore ? undefined : PLAINTEXT_WARNING,
		backend: encryptedStore ? 'safeStorage' : 'file'
	};
}

/** Loads secrets for the main process only. Never send the result to the renderer. */
export function loadSecrets(): StoredSecrets {
	const raw = readRaw();
	if (!raw) return {};
	const result: StoredSecrets = {};
	for (const key of SECRET_KEYS) {
		const value = raw.values[key];
		if (typeof value !== 'string' || !value) continue;
		const decrypted = raw.encrypted ? decryptValue(value) : value;
		if (decrypted !== null && decrypted.length > 0) result[key] = decrypted;
	}
	return result;
}

/**
 * Saves the provided secrets. `undefined` preserves the stored value; an empty
 * string clears it. A value that can no longer be decrypted is reported so the
 * wizard can ask the organiser to re-enter it.
 */
export function saveSecrets(update: StoredSecrets): { recoveryRequired: (keyof StoredSecrets)[] } {
	const raw = readRaw();
	const current: Record<string, string> = {};
	const recoveryRequired: (keyof StoredSecrets)[] = [];
	// Decode every retained value before changing storage modes; never mix
	// plaintext and ciphertext under one file-wide encrypted flag.
	for (const key of SECRET_KEYS) {
		let value = update[key];
		if (value === undefined && raw?.values[key]) {
			const decoded = raw.encrypted ? decryptValue(raw.values[key]) : raw.values[key];
			if (decoded === null) {
				throw new Error('Stored credentials cannot be decrypted. Restore access to the OS key store before saving settings.');
			}
			value = decoded;
		}
		if (value) current[key] = encryptValue(value);
	}

	if (Object.keys(current).length > 0) {
		writeRaw(isAvailable(), current);
	} else {
		const file = secretsFilePath();
		if (fs.existsSync(file)) fs.rmSync(file);
	}
	return { recoveryRequired };
}

export function clearSecrets(): void {
	const file = secretsFilePath();
	if (fs.existsSync(file)) fs.rmSync(file);
}

/** Which secret fields currently hold a value, without revealing the values. */
export function secretPresence(): Record<keyof StoredSecrets, boolean> {
	const secrets = loadSecrets();
	const presence = {} as Record<keyof StoredSecrets, boolean>;
	for (const key of SECRET_KEYS) presence[key] = typeof secrets[key] === 'string' && secrets[key]!.length > 0;
	return presence;
}
