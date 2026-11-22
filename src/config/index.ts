import dotenv from "dotenv";

// Check if running in Electron with JSON config
let useJsonConfig = false;

// Check for config.json path passed via environment
const configPath = process.env.MLBB_CONFIG_PATH;
if (configPath) {
	try {
		const fs = require('fs');
		if (fs.existsSync(configPath)) {
			const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
			// Set environment variables from config
			process.env.DISCORD_TOKEN = config.discord.token;
			process.env.CHALLONGE_USERNAME = config.challonge.username;
			process.env.CHALLONGE_TOKEN = config.challonge.token;
			process.env.DOT_DEFAULT_PREFIX = config.bot.defaultPrefix;
			process.env.DOT_DEFAULT_TO_ROLE = config.bot.defaultToRole;
			process.env.DOT_PARTICIPANT_ROLE = config.bot.participantRole || 'Participant';
			process.env.SQLITE_DB = config.database.path || 'C:/mlbb-data/database/dot.db';
			process.env.POSTGRESQL_URL = config.database.url || '';
			process.env.WEB_PORT = config.web.port?.toString() || '3000';
			process.env.WEB_PASSWORD = config.web.password || '';
			process.env.DOT_LOGGER_WEBHOOK = config.logging.webhook || '';
			process.env.NODE_ENV = 'production';
			useJsonConfig = true;
		}
	} catch (error) {
		console.error('Error loading JSON config:', error);
	}
}

// Fallback to dotenv if not using JSON config.
// Production persists Settings edits in the data directory, not /app/.env.
if (!useJsonConfig) {
	const fs = require("fs") as typeof import("fs");
	const path = require("path") as typeof import("path");
	const dataEnv = path.resolve(
		process.env.SQLITE_DB ? path.dirname(process.env.SQLITE_DB) : path.join(process.cwd(), "data"),
		".env"
	);
	if (fs.existsSync(dataEnv)) {
		dotenv.config({ path: dataEnv, override: true, quiet: true });
	}
	dotenv.config({ quiet: true });
}

function assertEnv(envvar: string): string {
	const value = process.env[envvar];
	if (value === undefined) {
		throw new Error(`Missing environment variable ${envvar}`);
	}
	return value;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getConfig() {
	return {
		challongeUsername: assertEnv("CHALLONGE_USERNAME"),
		challongeToken: assertEnv("CHALLONGE_TOKEN"),
		defaultPrefix: assertEnv("DOT_DEFAULT_PREFIX"),
		defaultTORole: assertEnv("DOT_DEFAULT_TO_ROLE"),
		participantRole: process.env.DOT_PARTICIPANT_ROLE || "Participant",
		discordToken: assertEnv("DISCORD_TOKEN"),
		postgresqlUrl: process.env.POSTGRESQL_URL || "",
		sqliteDb: process.env.SQLITE_DB || "",
		webPort: parseInt(process.env.WEB_PORT || "3000", 10),
		webPassword: process.env.WEB_PASSWORD || ""
	};
}

export const helpMessage = `🏆 **MLBB Tournament Bot** 🏆

Your friendly tournament management bot for Discord!

**📋 Tournament Commands:**
• \`!add <url> <name>\` - Add a tournament via Challonge URL (TO only)
• \`!add pre-checkin <name>\` - Add a tournament with no Challonge link, then check teams in before creating the bracket
• \`!precheckin open|list|close|<team>\` - Open team check-in, record a team, or create the bracket from checked-in teams
• \`!info [id]\` - Show tournament details (id optional if only one tournament)
• \`!list\` - List all ongoing tournaments
• \`!status [id] [new_status]\` - View or change tournament status (id optional if only one tournament)
• \`!sync [id]\` - Sync tournament info with Challonge (id optional if only one tournament)
• \`!update [id] name description\` - Update tournament info (id optional if only one tournament)

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
• \`!score [id] score\` - Report your match score (id optional if only one tournament)
• \`!forcescore [id] score @winner\` - Override score as TO (id optional if only one tournament)

**🔧 Utility:**
• \`!coin\` / \`!toss\` - Flip a coin
• \`!close\` - Close a private verification thread (TO only)

**💡 Tip:** The \`id\` parameter is optional when there's only one tournament in the server!

**Need help?** Contact a Tournament Organizer!`;
