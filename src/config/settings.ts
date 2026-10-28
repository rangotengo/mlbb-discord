export type RestartRequirement = "none" | "bot" | "server";

export interface EditableSetting {
	key: string;
	label: string;
	description: string;
	secret: boolean;
	restart: RestartRequirement;
}

/**
 * The only settings the dashboard may read or write. Unknown keys are rejected
 * rather than written into the environment file.
 */
export const EDITABLE_SETTINGS: EditableSetting[] = [
	{ key: "DOT_DEFAULT_PREFIX", label: "Command prefix", description: "Prefix for message commands.", secret: false, restart: "bot" },
	{ key: "DOT_DEFAULT_TO_ROLE", label: "Organiser role", description: "Discord role name that may organise tournaments.", secret: false, restart: "bot" },
	{ key: "DOT_PARTICIPANT_ROLE", label: "Participant role", description: "Default participant role name when a tournament has none.", secret: false, restart: "bot" },
	{ key: "CHALLENGERMODE_REFRESH_KEY", label: "Challengermode refresh key", description: "Application refresh key. Stored, never displayed.", secret: true, restart: "bot" },
	{ key: "WEB_PASSWORD", label: "Dashboard password", description: "Password for dashboard login. Stored, never displayed.", secret: true, restart: "server" },
	{ key: "WEB_PORT", label: "Dashboard port", description: "TCP port for the dashboard.", secret: false, restart: "server" },
	{ key: "WEB_BIND", label: "Dashboard bind address", description: "127.0.0.1 keeps the dashboard local. Any other address requires the dashboard password.", secret: false, restart: "server" },
	{ key: "SQLITE_DB", label: "SQLite database path", description: "Leave empty when using PostgreSQL.", secret: false, restart: "server" },
	{ key: "POSTGRESQL_URL", label: "PostgreSQL URL", description: "Connection URL. Stored, never displayed.", secret: true, restart: "server" },
	{ key: "DOT_LOGGER_WEBHOOK", label: "Log webhook", description: "Optional Discord webhook URL. Stored, never displayed.", secret: true, restart: "bot" },
	{ key: "EMAIL_SENDER_ADDRESS", label: "Email sender", description: "From address used for verification codes.", secret: false, restart: "none" },
	{ key: "OTP_EXPIRY_MS", label: "Code expiry", description: "Verification code lifetime in milliseconds.", secret: false, restart: "none" },
	{ key: "OTP_RESEND_COOLDOWN_MS", label: "Resend cooldown", description: "Minimum time between code requests in milliseconds.", secret: false, restart: "none" },
	{ key: "OTP_MAX_ATTEMPTS", label: "Code attempts", description: "Incorrect attempts allowed before a code is invalidated.", secret: false, restart: "none" },
	{ key: "OTP_MAX_SENDS", label: "Code requests", description: "Code requests allowed before staff assistance is required.", secret: false, restart: "none" }
];

const byKey = new Map(EDITABLE_SETTINGS.map(setting => [setting.key, setting]));

export function editableSetting(key: string): EditableSetting | undefined {
	return byKey.get(key);
}

const NUMERIC_KEYS = new Set(["WEB_PORT", "OTP_EXPIRY_MS", "OTP_RESEND_COOLDOWN_MS", "OTP_MAX_ATTEMPTS", "OTP_MAX_SENDS"]);

/** Rejects unknown keys, wrong types, and network exposure without a password. */
export function validateSettings(input: Record<string, unknown>, current: Record<string, string>): string | null {
	for (const [key, value] of Object.entries(input)) {
		const setting = byKey.get(key);
		if (!setting) return `Unknown setting ${key}`;
		if (typeof value !== "string") return `${key} must be text`;
		if (/[\r\n\0]/.test(value)) return `${key} must be a single line`;
		if (setting.secret && value === "") continue;
		if (NUMERIC_KEYS.has(key) && value !== "" && !/^\d+$/.test(value)) return `${key} must be a whole number`;
		if (key === "WEB_PORT" && value !== "") {
			const port = Number(value);
			if (!Number.isInteger(port) || port < 1 || port > 65535) return "WEB_PORT must be between 1 and 65535";
		}
		if (key === "WEB_BIND" && value !== "" && value !== "127.0.0.1" && value !== "localhost" && value !== "::1") {
			const password = typeof input.WEB_PASSWORD === "string" && input.WEB_PASSWORD !== "" ? input.WEB_PASSWORD : current.WEB_PASSWORD;
			if (!password) return "A dashboard password is required before listening beyond this computer";
		}
	}
	return null;
}
