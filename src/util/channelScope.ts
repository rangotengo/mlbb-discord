import { GuildBasedChannel } from "discord.js";

export const ALLOWED_CATEGORY_ID = "1551342799276875907";

export const DEFAULT_CHECK_IN_CHANNEL_ID = "1566425054168744057";

export function getCheckInChannelId(tournament?: { checkInChannelId?: string }): string {
	return tournament?.checkInChannelId || DEFAULT_CHECK_IN_CHANNEL_ID;
}

export async function isConfiguredCheckInChannel(channel: GuildBasedChannel | null | undefined): Promise<boolean> {
	if (!channel) return false;
	const { ChallongeTournament } = require("../database/orm/ChallongeTournament") as typeof import("../database/orm/ChallongeTournament");
	const id = channel.isThread() ? channel.parentId : channel.id;
	return !!await ChallongeTournament.findOne({ where: { owningDiscordServer: channel.guild.id, checkInChannelId: id! } });
}

export function isAllowedChannel(channel: GuildBasedChannel | null | undefined): boolean {
	if (!channel) return false;
	// Threads belong to a text/forum channel, which belongs to the category.
	return channel.isThread()
		? channel.parent?.parentId === ALLOWED_CATEGORY_ID
		: channel.parentId === ALLOWED_CATEGORY_ID;
}
