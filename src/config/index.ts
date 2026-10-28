import dotenv from "dotenv";
import fs from "fs";

// Check if running in Electron with JSON config
let useJsonConfig = false;

// Check for config.json path passed via environment
const configPath = process.env.MLBB_CONFIG_PATH;
if (configPath) {
	try {
		if (fs.existsSync(configPath)) {
			const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
			// Secrets may already be supplied by the desktop process from OS-backed
			// storage. A missing value in the file is fine when the environment
			// already has one; never overwrite an existing secret with empty text.
			const assign = (key: string, value: unknown, fallback = ""): void => {
				if (typeof value === "string" && value.trim()) process.env[key] = value;
				else if (process.env[key] === undefined && fallback) process.env[key] = fallback;
			};
			assign("DISCORD_TOKEN", config.discord?.token);
			assign("CHALLENGERMODE_REFRESH_KEY", config.challengermode?.refreshKey);
			assign("DOT_DEFAULT_PREFIX", config.bot?.defaultPrefix);
			assign("DOT_DEFAULT_TO_ROLE", config.bot?.defaultToRole);
			assign("DOT_PARTICIPANT_ROLE", config.bot?.participantRole, "Participant");
			if (config.database?.type === "postgresql") {
				process.env.SQLITE_DB = "";
				assign("POSTGRESQL_URL", config.database.url);
			} else if (config.database) {
				assign("SQLITE_DB", config.database.path, "./data/dot.db");
				if (!process.env.POSTGRESQL_URL) process.env.POSTGRESQL_URL = "";
			}
			if (config.web?.port !== undefined) process.env.WEB_PORT = String(config.web.port);
			assign("WEB_PASSWORD", config.web?.password);
			assign("DOT_LOGGER_WEBHOOK", config.logging?.webhook);
			process.env.NODE_ENV = 'production';
			useJsonConfig = true;
		}
	} catch (error) {
		console.error('Error loading JSON config:', error);
	}
}

// Fallback to dotenv if not using JSON config
if (!useJsonConfig) {
	dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
}

function assertEnv(envvar: string): string {
	const value = process.env[envvar];
	if (value === undefined || !value.trim()) {
		throw new Error(`Missing environment variable ${envvar}`);
	}
	return value;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getConfig() {
	const webPort = Number(process.env.WEB_PORT || "3000");
	if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) throw new Error("WEB_PORT must be an integer between 1 and 65535");
	return {
		challengermodeRefreshKey: process.env.CHALLENGERMODE_REFRESH_KEY || "",
		defaultPrefix: assertEnv("DOT_DEFAULT_PREFIX"),
		defaultTORole: assertEnv("DOT_DEFAULT_TO_ROLE"),
		participantRole: process.env.DOT_PARTICIPANT_ROLE || "Participant",
		discordToken: assertEnv("DISCORD_TOKEN"),
		postgresqlUrl: process.env.POSTGRESQL_URL || "",
		sqliteDb: process.env.SQLITE_DB || "",
		webPort,
		webPassword: process.env.WEB_PASSWORD || ""
	};
}

export const helpMessage = `🏆 **MLBB Tournament Bot** 🏆

Your friendly tournament management bot for Discord!

**📋 Tournament Commands:**
• \`!add <url> <name>\` - Add a tournament via Challengermode URL (TO only)
• \`!info [id]\` - Show tournament details (id optional if only one tournament)
• \`!list\` - List all ongoing tournaments
• \`!status [id] [new_status]\` - View or change tournament status (id optional if only one tournament)
• \`!sync [id]\` - Sync tournament info with Challengermode (id optional if only one tournament)
• \`!update [id] name description\` - Update local tournament info (id optional if only one tournament)

**👥 Host Management:**
• \`!addhost [id] @user\` - Add a tournament host (id optional if only one tournament)
• \`!removehost [id] @user\` - Remove a tournament host (id optional if only one tournament)

**📝 Registration & Setup:**
• \`!check-in\` - Auto-verify yourself or open an onboarding ticket
• \`!email <email>\` - Request email verification
• \`!verify <code>\` - Verify your email address
• \`!enroll [id] <CSV>\` - Enroll players via CSV attachment (id optional if only one tournament)
• \`!verify-player [id] <@user> <email>\` - Manually verify a player by email (TO only)
• \`!set-participant-role <id> <@role>\` - Set participant role for a tournament (TO only)
• \`!drop-player <email> [id]\` - Drop an enrolled player by email (TO only, id optional if only one tournament)
• \`!update-player <email> <field:value> [id]\` - Update enrolled player info (TO only, id optional if only one tournament)

**🎮 Match Management:**
• \`!matches [id] [download]\` - List all matches with round numbers and match IDs, or download schedule as CSV (id/download optional)
• \`!round [id] channel round\` - Start a round with match threads (id optional if only one tournament)
• \`!schedule [id] <CSV>\` - Import match schedule via CSV attachment (TO only, id optional if only one tournament)
• Manage scores and team registration on Challengermode, then use \`!sync\` to refresh the bot.

**🔧 Utility:**
• \`!coin\` / \`!toss\` - Flip a coin
• \`!close\` - Close an onboarding ticket channel (TO only)

**💡 Tip:** The \`id\` parameter is optional when there's only one tournament in the server!

**Need help?** Contact a Tournament Organizer!`;
