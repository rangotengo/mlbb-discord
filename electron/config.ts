import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { loadSecrets, saveSecrets, secretPresence, StoredSecrets } from './secrets';

/**
 * Desktop configuration (guides 6 and 7).
 *
 * config.json holds only non-secret settings. Credentials live in the OS-backed
 * secret store (`secrets.ts`). Older config files that still contain secrets
 * are migrated on the next save: the secrets are moved into the store and the
 * file is rewritten without them. `src/config/index.ts` still reads secrets
 * from JSON when present, so an unmigrated file keeps working until then.
 */

export const CONFIG_VERSION = 2;
export const APP_SCHEMA_VERSION = 1;

export interface EmailSettings {
	configured: boolean;
	sender?: string;
	tokenUri?: string;
}

export interface BotConfig {
	version: string;
	schemaVersion: number;
	discord: { token: string };
	challengermode: { refreshKey: string };
	bot: {
		defaultPrefix: string;
		defaultToRole: string;
		participantRole?: string;
	};
	database: {
		type: 'sqlite' | 'postgresql';
		path?: string;
		url?: string;
	};
	web: {
		port: number;
		autoIncrement: boolean;
		password?: string;
		/** Explicit opt-in. Default is a loopback listener. */
		allowNetwork?: boolean;
	};
	logging: {
		webhook?: string;
		level: string;
	};
	email?: EmailSettings;
	/** Non-secret wizard progress. Secrets are never stored here. */
	setup?: SetupProgress;
}

export interface SetupProgress {
	step: SetupStepId;
	completed: SetupStepId[];
	updatedAt: string;
}

export type SetupStepId =
	| 'discord'
	| 'server'
	| 'challengermode'
	| 'email'
	| 'storage'
	| 'dashboard'
	| 'review';

export interface BotStatus {
	running: boolean;
	connectedServers: number;
	port: number;
	pid?: number;
}

/** What the renderer is allowed to see. Secret values are replaced with flags. */
export interface PublicConfig {
	version: string;
	schemaVersion: number;
	discord: { tokenConfigured: boolean };
	challengermode: { refreshKeyConfigured: boolean };
	bot: BotConfig['bot'];
	database: BotConfig['database'];
	web: {
		port: number;
		autoIncrement: boolean;
		passwordConfigured: boolean;
		allowNetwork: boolean;
	};
	logging: { level: string; webhookConfigured: boolean };
	email: { configured: boolean; sender?: string };
	setup?: SetupProgress;
	secretStorage: { secure: boolean; warning?: string };
	restartRequired: string[];
}

const CONFIG_FILE = 'config.json';
const RESTART_FIELDS = [
	'discord.token',
	'challengermode.refreshKey',
	'bot.defaultPrefix',
	'bot.defaultToRole',
	'bot.participantRole',
	'database.type',
	'database.path',
	'database.url',
	'web.port',
	'web.allowNetwork',
	'web.password',
	'logging.webhook'
];

export function getConfigPath(): string {
	return path.join(app.getPath('userData'), CONFIG_FILE);
}

export function defaultConfig(): BotConfig {
	return {
		version: app.getVersion?.() || '0.1.0',
		schemaVersion: APP_SCHEMA_VERSION,
		discord: { token: '' },
		challengermode: { refreshKey: '' },
		bot: {
			defaultPrefix: '!',
			defaultToRole: 'Organizer',
			participantRole: 'Participant'
		},
		database: { type: 'sqlite', path: path.join(app.getPath('userData'), 'data', 'dot.db') },
		web: { port: 3000, autoIncrement: true, allowNetwork: false },
		logging: { level: 'info' },
		email: { configured: false },
		setup: { step: 'discord', completed: [], updatedAt: new Date().toISOString() }
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function atomicWrite(file: string, contents: string, mode = 0o600): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, contents, { mode });
	try {
		fs.chmodSync(temp, mode);
	} catch {
		// Windows ignores POSIX modes.
	}
	fs.renameSync(temp, file);
}

/**
 * Merges an on-disk document with the secret store.
 * Legacy files that still embed secrets are accepted and flagged for migration.
 */
export function materialiseConfig(raw: unknown, secrets?: StoredSecrets): BotConfig {
	const resolved = secrets ?? loadSecrets();
	const base = defaultConfig();
	if (!isRecord(raw)) return applySecrets(base, resolved);

	const discord = isRecord(raw.discord) ? raw.discord : {};
	const challengermode = isRecord(raw.challengermode) ? raw.challengermode : {};
	const bot = isRecord(raw.bot) ? raw.bot : {};
	const database = isRecord(raw.database) ? raw.database : {};
	const web = isRecord(raw.web) ? raw.web : {};
	const logging = isRecord(raw.logging) ? raw.logging : {};
	const email = isRecord(raw.email) ? raw.email : {};
	const setup = isRecord(raw.setup) ? raw.setup : undefined;

	const config: BotConfig = {
		version: typeof raw.version === 'string' ? raw.version : base.version,
		schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : APP_SCHEMA_VERSION,
		discord: { token: stringOr(discord.token, '') },
		challengermode: { refreshKey: stringOr(challengermode.refreshKey, '') },
		bot: {
			defaultPrefix: stringOr(bot.defaultPrefix, base.bot.defaultPrefix),
			defaultToRole: stringOr(bot.defaultToRole, base.bot.defaultToRole),
			participantRole: stringOr(bot.participantRole, base.bot.participantRole)
		},
		database: {
			type: database.type === 'postgresql' ? 'postgresql' : 'sqlite',
			path: typeof database.path === 'string' ? database.path : base.database.path,
			url: typeof database.url === 'string' ? database.url : undefined
		},
		web: {
			port: integerOr(web.port, base.web.port),
			autoIncrement: web.autoIncrement !== false,
			password: typeof web.password === 'string' ? web.password : undefined,
			allowNetwork: web.allowNetwork === true
		},
		logging: {
			level: stringOr(logging.level, 'info'),
			webhook: typeof logging.webhook === 'string' && logging.webhook ? logging.webhook : undefined
		},
		email: {
			configured: email.configured === true || secretPresenceFrom(resolved, 'googleClientId'),
			sender: typeof email.sender === 'string' ? email.sender : undefined,
			tokenUri: typeof email.tokenUri === 'string' ? email.tokenUri : undefined
		}
	};

	if (setup && typeof setup.step === 'string' && Array.isArray(setup.completed)) {
		config.setup = {
			step: setup.step as SetupStepId,
			completed: setup.completed.filter((step): step is SetupStepId => typeof step === 'string'),
			updatedAt: typeof setup.updatedAt === 'string' ? setup.updatedAt : new Date().toISOString()
		};
	}

	return applySecrets(config, resolved);
}

function stringOr(value: unknown, fallback: string | undefined): string {
	return typeof value === 'string' && value.length > 0 ? value : (fallback ?? '');
}

function integerOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function secretPresenceFrom(secrets: StoredSecrets, key: keyof StoredSecrets): boolean {
	return typeof secrets[key] === 'string' && secrets[key]!.length > 0;
}

function applySecrets(config: BotConfig, secrets: StoredSecrets): BotConfig {
	if (secrets.discordToken) config.discord.token = secrets.discordToken;
	if (secrets.challengermodeRefreshKey) config.challengermode.refreshKey = secrets.challengermodeRefreshKey;
	if (secrets.webPassword) config.web.password = secrets.webPassword;
	if (secrets.databaseUrl) config.database.url = secrets.databaseUrl;
	if (secretPresenceFrom(secrets, 'googleClientId') && secretPresenceFrom(secrets, 'googleClientSecret') && secretPresenceFrom(secrets, 'googleRefreshToken')) {
		config.email = { ...(config.email ?? { configured: true }), configured: true, tokenUri: secrets.googleTokenUri || config.email?.tokenUri };
	}
	return config;
}

export function loadConfig(): BotConfig | null {
	try {
		const raw = readJson(getConfigPath());
		if (raw === null) return null;
		return materialiseConfig(raw);
	} catch (error) {
		console.error('Error loading config:', error instanceof Error ? error.message : 'unreadable');
		return null;
	}
}

/** Persists non-secret settings and moves any supplied secrets into the store. */
export function saveConfig(config: BotConfig): { restartRequired: string[]; migratedSecrets: boolean } {
	const previous = loadPublicConfig();
	const secrets: StoredSecrets = {};
	// Undefined keeps the stored secret. An empty string is an explicit clear.
	if (config.discord.token !== undefined) secrets.discordToken = config.discord.token;
	if (config.challengermode.refreshKey !== undefined) secrets.challengermodeRefreshKey = config.challengermode.refreshKey;
	if (config.web.password !== undefined) secrets.webPassword = config.web.password;
	if (config.email?.tokenUri !== undefined) secrets.googleTokenUri = config.email.tokenUri;
	if (config.database.type === 'postgresql') secrets.databaseUrl = config.database.url ?? '';
	saveSecrets(secrets);

	const fileConfig = toFileConfig(config);
	const hadEmbeddedSecrets = embeddedSecrets(readJson(getConfigPath()));
	atomicWrite(getConfigPath(), JSON.stringify(fileConfig, null, 2));
	return { restartRequired: diffRestart(previous, toPublic(config)), migratedSecrets: hadEmbeddedSecrets };
}

function embeddedSecrets(raw: unknown): boolean {
	if (!isRecord(raw)) return false;
	const discord = isRecord(raw.discord) ? raw.discord : {};
	const cm = isRecord(raw.challengermode) ? raw.challengermode : {};
	const web = isRecord(raw.web) ? raw.web : {};
	return Boolean(discord.token || cm.refreshKey || web.password);
}

export function saveEmailSecrets(update: Pick<StoredSecrets, 'googleClientId' | 'googleClientSecret' | 'googleRefreshToken' | 'googleTokenUri'>): void {
	saveSecrets(update);
}

/** File shape: secrets are omitted, presence flags are not written (they are derived). */
export function toFileConfig(config: BotConfig): Record<string, unknown> {
	return {
		version: config.version,
		schemaVersion: config.schemaVersion,
		discord: {},
		challengermode: {},
		bot: {
			defaultPrefix: config.bot.defaultPrefix,
			defaultToRole: config.bot.defaultToRole,
			participantRole: config.bot.participantRole || 'Participant'
		},
		database: {
			type: config.database.type,
			path: config.database.type === 'sqlite' ? config.database.path : undefined,
			url: undefined
		},
		web: {
			port: config.web.port,
			autoIncrement: config.web.autoIncrement,
			allowNetwork: config.web.allowNetwork === true
		},
		logging: {
			level: config.logging.level,
			webhook: config.logging.webhook || undefined
		},
		email: {
			configured: config.email?.configured === true,
			sender: config.email?.sender,
			tokenUri: config.email?.tokenUri
		},
		setup: config.setup
	};
}

export function toPublic(config: BotConfig, storage?: { secure: boolean; warning?: string }): PublicConfig {
	const presence = secretPresence();
	return {
		version: config.version,
		schemaVersion: config.schemaVersion,
		discord: { tokenConfigured: presence.discordToken || Boolean(config.discord.token) },
		challengermode: { refreshKeyConfigured: presence.challengermodeRefreshKey || Boolean(config.challengermode.refreshKey) },
		bot: { ...config.bot },
		database: {
			type: config.database.type,
			path: config.database.path,
			url: config.database.type === 'postgresql' ? maskUrl(config.database.url) : undefined
		},
		web: {
			port: config.web.port,
			autoIncrement: config.web.autoIncrement,
			passwordConfigured: presence.webPassword || Boolean(config.web.password),
			allowNetwork: config.web.allowNetwork === true
		},
		logging: {
			level: config.logging.level,
			webhookConfigured: Boolean(config.logging.webhook)
		},
		email: {
			configured: presence.googleClientId && presence.googleClientSecret && presence.googleRefreshToken,
			sender: config.email?.sender
		},
		setup: config.setup,
		secretStorage: storage ?? { secure: true },
		restartRequired: []
	};
}

function maskUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		const parsed = new URL(url);
		if (parsed.password) parsed.password = '***';
		if (parsed.username) parsed.username = '***';
		return parsed.toString();
	} catch {
		return 'configured';
	}
}

export function loadPublicConfig(): PublicConfig | null {
	const config = loadConfig();
	return config ? toPublic(config) : null;
}

function diffRestart(previous: PublicConfig | null, next: PublicConfig): string[] {
	if (!previous) return [];
	const changed: string[] = [];
	const pairs: [string, unknown, unknown][] = [
		['bot.defaultPrefix', previous.bot.defaultPrefix, next.bot.defaultPrefix],
		['bot.defaultToRole', previous.bot.defaultToRole, next.bot.defaultToRole],
		['bot.participantRole', previous.bot.participantRole, next.bot.participantRole],
		['database.type', previous.database.type, next.database.type],
		['database.path', previous.database.path, next.database.path],
		['web.port', previous.web.port, next.web.port],
		['web.allowNetwork', previous.web.allowNetwork, next.web.allowNetwork],
		['web.password', previous.web.passwordConfigured, next.web.passwordConfigured],
		['logging.level', previous.logging.level, next.logging.level]
	];
	for (const [field, before, after] of pairs) {
		if (before !== after) changed.push(field);
	}
	return changed.filter(field => RESTART_FIELDS.includes(field) || field.startsWith('bot.') || field.startsWith('database.') || field.startsWith('web.'));
}

export function configToEnv(config: BotConfig, extras: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const secrets = loadSecrets();
	const env: NodeJS.ProcessEnv = {
		DISCORD_TOKEN: secrets.discordToken || config.discord.token,
		CHALLENGERMODE_REFRESH_KEY: secrets.challengermodeRefreshKey || config.challengermode.refreshKey || '',
		DOT_DEFAULT_PREFIX: config.bot.defaultPrefix,
		DOT_DEFAULT_TO_ROLE: config.bot.defaultToRole,
		DOT_PARTICIPANT_ROLE: config.bot.participantRole || 'Participant',
		SQLITE_DB: config.database.type === 'postgresql' ? '' : config.database.path || './data/dot.db',
		POSTGRESQL_URL: config.database.type === 'postgresql' ? (secrets.databaseUrl || config.database.url || '') : '',
		WEB_PORT: config.web.port.toString(),
		WEB_PASSWORD: secrets.webPassword || config.web.password || '',
		WEB_BIND: config.web.allowNetwork ? '0.0.0.0' : '127.0.0.1',
		DOT_LOGGER_WEBHOOK: config.logging.webhook || '',
		DEBUG: process.env.DEBUG || 'dot:*',
		NODE_ENV: 'production',
		...extras
	};

	if (secrets.googleClientId && secrets.googleClientSecret && secrets.googleRefreshToken) {
		env.GOOGLE_CLIENT_ID = secrets.googleClientId;
		env.GOOGLE_CLIENT_SECRET = secrets.googleClientSecret;
		env.GOOGLE_REFRESH_TOKEN = secrets.googleRefreshToken;
		env.GOOGLE_TOKEN_URI = secrets.googleTokenUri || config.email?.tokenUri || 'https://oauth2.googleapis.com/token';
	}
	return env;
}

export function configForValidation(config: BotConfig): BotConfig {
	const secrets = loadSecrets();
	return applySecrets({ ...config, discord: { ...config.discord }, challengermode: { ...config.challengermode }, web: { ...config.web } }, secrets);
}
