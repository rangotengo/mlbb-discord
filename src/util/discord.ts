import { Client, GuildMember, Message, TextChannel, User } from "discord.js";
import { getConfig } from "../config";
import { UserError } from "./errors";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function send(bot: Client, channelId: string, ...args: Parameters<TextChannel["send"]>) {
	const channel = await bot.channels.fetch(channelId);
	if (channel?.isSendable()) {
		return await channel.send(...args);
	}
	throw new Error(`${channelId} is not a text channel`);
}

export async function dm(bot: Client, userId: string, ...args: Parameters<TextChannel["send"]>): Promise<void> {
	const user = await bot.users.fetch(userId);
	await user.send(...args);
}

/**
 * Retrieves user information by the REST API if not cached.
 */
export async function username(bot: Client, userId: string): Promise<string | null> {
	try {
		const user = await bot.users.fetch(userId);
		return user.tag;
	} catch {
		return null;
	}
}

// returns full user object with d.js due to additional complexity of msg.mentions
export function firstMentionOrFail(msg: Message): User {
	const user = msg.mentions.users.first();
	if (!user) {
		throw new UserError(`Message does not mention a user!\n\`${msg.content}\``);
	}
	return user;
}

export function parseUserMention(who: string): string | null {
	return /^<@!?([0-9]{17,20})>$/.exec(who)?.[1] ?? null;
}

/**
 * Checks if a guild member has the Tournament Organizer role.
 *
 * @param member - The guild member to check
 * @returns true if the member has the TO role
 */
export function isTournamentOrganizer(member: GuildMember | null | undefined): boolean {
	if (!member) return false;
	const toRole = getConfig().defaultTORole;
	return member.roles.cache.some(r => r.name === toRole);
}

/**
 * Checks if a guild member is authorized to manage a tournament.
 * Returns true if the member has either:
 * - The main Tournament Organizer role
 * - The tournament-specific admin role ({tournamentId}-admin)
 *
 * @param member - The guild member to check
 * @param tournamentId - The tournament ID to check the admin role for
 * @returns true if the member is authorized to manage the tournament
 */
export function isTournamentHost(member: GuildMember | null | undefined, tournamentId: string): boolean {
	if (!member) return false;
	// Check for main TO role
	if (isTournamentOrganizer(member)) return true;
	// Check for tournament-specific admin role
	const adminRoleName = `${tournamentId}-admin`;
	return member.roles.cache.some(r => r.name === adminRoleName);
}

