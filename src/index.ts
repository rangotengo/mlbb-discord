import { ActivityType, Client, GatewayIntentBits, Partials } from "discord.js";
import { getConfig } from "./config"; // Must be imported first among first-party modules
import { initializeDatabase } from "./database/postgres";
import { registerEvents } from "./events";
import { HostRoleProvider } from "./role/host";
import { OrganiserRoleProvider } from "./role/organiser";
import { ParticipantRoleProvider } from "./role/participant";
import { TimeWizard } from "./timer";
import { send } from "./util/discord";
import { getLogger } from "./util/logger";
import { getTournamentApi } from "./website/challengermode";
import { createWebServer, setBotClient } from "./web/server";

const logger = getLogger("index");

(async () => {
	const config = getConfig();
	const database = await initializeDatabase(config.postgresqlUrl);

	// Start web server
	await createWebServer();

	const tournamentApi = getTournamentApi(config.challengermodeRefreshKey);

	const bot = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.GuildMessageReactions,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.DirectMessageReactions,
			GatewayIntentBits.MessageContent
		],
		partials: [Partials.Channel, Partials.Message, Partials.Reaction]
	});
	const organiserRole = new OrganiserRoleProvider(config.defaultTORole, 0x3498db);
	const participantRole = new ParticipantRoleProvider(bot, 0xe67e22);
	const hostRole = new HostRoleProvider(bot, 0xe74c3c);
	const timeWizard = new TimeWizard({
		sendMessage: async (...args) => (await send(bot, ...args)).id,
		editMessage: async (channelId, messageId, newMessage) => {
			const channel = await bot.channels.fetch(channelId);
			if (channel?.isTextBased()) {
				await channel.messages.edit(messageId, newMessage);
			} else {
				throw new Error(`${channelId} is not a text channel`);
			}
		}
	});
	registerEvents(bot, config.defaultPrefix, {
		organiserRole,
		participantRole,
		hostRole,
		database,
		tournamentApi,
		scores: new Map(),
		timeWizard
	});

	bot.on("clientReady", async () => {
		logger.notify(`Logged in as ${bot.user?.tag} - ${bot.user?.id}`);
		bot.user?.setActivity("🕯️ Keeping the lights on", { type: ActivityType.Custom });
		// Set bot client for web server
		setBotClient(bot);
	});
	bot.once("clientReady", async () => {
		await timeWizard.load();
	});
	bot.login().catch(logger.error);
	process.once("SIGTERM", () => {
		bot.destroy();
		logger.notify("Bot destroyed upon receiving SIGTERM. Exiting process.");
		process.exit(0);
	});
})();
