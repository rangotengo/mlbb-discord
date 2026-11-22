import { Client, Message } from "discord.js";
import { getConfig, helpMessage } from "../config";
import { Command, CommandDefinition, CommandSupport } from "../Command";
import { getLogger } from "../util/logger";
import { isAllowedChannel, isConfiguredCheckInChannel } from "../util/channelScope";

const logger = getLogger("messageCreate");

export function makeHandler(
	bot: Client,
	prefix: string,
	commands: Record<string, CommandDefinition>,
	support: CommandSupport
): (msg: Message) => Promise<void> {
	const handlers: Record<string, Command> = {};
	for (const name in commands) {
		const def = commands[name];
		// Register by definition.name to support hyphenated commands (e.g. verify-player)
		handlers[def.name] = new Command(def);
	}
	return async function messageCreate(msg: Message): Promise<void> {
		if (!msg.inGuild() || (!isAllowedChannel(msg.channel) && !await isConfiguredCheckInChannel(msg.channel))) return;
		// Ignore messages from all bots and replies
		if (msg.author.bot || msg.reference) {
			return;
		}
		if (bot.user && msg.mentions.has(bot.user, { ignoreEveryone: true, ignoreRoles: true })) {
			await msg.reply(helpMessage).catch(logger.error);
			return;
		}
		const activePrefix = getConfig().defaultPrefix || prefix;
		if (msg.content.startsWith(activePrefix)) {
			const terms = msg.content.split(" ");
			const cmdName = terms[0].slice(activePrefix.length).toLowerCase();
			// Split by spaces, trim each argument
			const args = terms.slice(1).map(s => s.trim()).filter(s => s.length > 0);
			await handlers[cmdName]?.run(msg, args, support);
		}
	};
}
