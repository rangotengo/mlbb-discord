import { setRuntimeSupport } from "../util/runtimeSupport";
import { Client, RESTEvents } from "discord.js";
import { CommandSupport } from "../Command";
import * as commands from "../commands";
import { serializeServer } from "../util";
import { getLogger } from "../util/logger";
import * as guildCreate from "./guildCreate";
import * as interaction from "./interaction";
import * as messageCreate from "./messageCreate";

const logger = getLogger("events");

export function registerEvents(bot: Client, prefix: string, support: CommandSupport): void {
	setRuntimeSupport(support);
	bot.rest.on(RESTEvents.Debug, info => logger.verbose(RESTEvents.Debug, info));
	bot.rest.on(RESTEvents.RateLimited, rateLimitInfo => logger.warn(RESTEvents.RateLimited, rateLimitInfo));
	bot.on("warn", logger.warn);
	bot.on("error", logger.error);
	bot.on("shardReady", shard => logger.notify(`Shard ${shard} ready`));
	bot.on("shardReconnecting", shard => logger.info(`Shard ${shard} reconnecting`));
	bot.on("shardResume", (shard, replayed) => logger.info(`Shard ${shard} resumed: ${replayed} events replayed`));
	bot.on("shardDisconnect", (event, shard) => logger.notify(`Shard ${shard} disconnected (${event.code})`));
	bot.on("shardError", (error, shard) => logger.error(`Shard ${shard} error:`, error));
	bot.on("guildDelete", guild => logger.notify(`Guild delete: ${serializeServer(guild)}`));
	bot.on("guildCreate", guildCreate.makeHandler(support.organiserRole));
	// Member-join verification and onboarding tickets are disabled for this project.
	bot.on("interactionCreate", interaction.makeHandler(support));
	bot.on("messageCreate", messageCreate.makeHandler(bot, prefix, commands, support));
}
