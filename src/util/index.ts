// Adapted from https://github.com/DawnbrandBots/bastion-bot/blob/master/src/utils.ts
import { AutocompleteInteraction, CommandInteraction, Guild } from "discord.js";
import { UserError } from "./errors";

export function serializeServer(server: Guild): string {
	const createdAt = new Date(server.createdAt).toISOString();
	return `${server.name} (${server.id}) [${server.memberCount}] ${createdAt} by <@${server.ownerId}>`;
}

export function serialiseInteraction(
	interaction: CommandInteraction | AutocompleteInteraction,
	extras?: Record<string, unknown>
): string {
	return JSON.stringify({
		channel: interaction.channelId,
		message: interaction.id,
		guild: interaction.guildId,
		author: interaction.user.id,
		id: interaction.commandId,
		command: interaction.commandName,
		...extras
	});
}

export function splitText(text: string, maxLength = 2000): string[] {
	if (!Number.isSafeInteger(maxLength) || maxLength <= 0) throw new RangeError("maxLength must be a positive integer");
	if (text.length <= maxLength) return [text];
	const parts = [];
	let remaining = text;
	while (remaining.length > maxLength) {
		let splitAt = remaining.lastIndexOf('\n', maxLength);
		if (splitAt <= 0) splitAt = maxLength;
		parts.push(remaining.substring(0, splitAt));
		remaining = remaining.substring(splitAt).trimStart();
	}
	if (remaining.length > 0) parts.push(remaining);
	return parts;
}

export { parseDateTime } from "./parseDateTime";
export { parseTime } from "./parseTime";
export { downloadAndValidateCSV, parseCSVRow, parseCSV, formatCSVRow, formatCSVDate } from "./csv";
export { isTournamentOrganizer, isTournamentHost, parseUserMention } from "./discord";
export { getParticipantRoleName, assignParticipantRole } from "./roles";
export * from "./constants";
export { addUserToMatchThreads } from "./matchThreads";

/**
 * Parses a score string in format "#-#" (e.g., "2-1") and returns the two numbers.
 *
 * @param score - Score string like "2-1"
 * @returns Tuple of [score1, score2]
 * @throws {UserError} If format is invalid
 */
export function parseScore(score: string): [number, number] {
	if (!/^\d+-\d+$/.test(score.trim())) {
		throw new UserError("Must provide score in format `#-#` e.g. `2-1`.");
	}
	const scores = score.trim().split("-").map(Number);
	if (scores.some(s => !Number.isSafeInteger(s))) {
		throw new UserError("Scores must be safe non-negative integers.");
	}
	return [scores[0], scores[1]];
}

/**
 * Shared utility to format a scheduled time consistently across Web and Discord.
 * Dates past year 2090 are considered "Not set".
 * 
 * @param scheduledTime A string or Date object representing the time
 * @param options Options to control the format
 * @returns Formatted date string or a "Not set" string placeholder
 */
export function formatScheduledTime(
	scheduledTime: string | Date | null | undefined,
	options: { html?: boolean } = {}
): string {
	if (!scheduledTime) {
		return options.html ? '<span style="color:var(--text-secondary)">Not set</span>' : 'Not set';
	}

	const dateObj = new Date(scheduledTime);
	
	if (isNaN(dateObj.getTime())) {
		return options.html ? '<span style="color:var(--text-secondary)">Not set</span>' : 'Not set';
	}

	if (dateObj.getFullYear() > 2090) {
		return options.html ? '<span style="color:var(--text-secondary)">Not set</span>' : 'Not set';
	}

	return dateObj.toLocaleString(undefined, {
		weekday: 'short', month: 'short', day: 'numeric',
		hour: '2-digit', minute: '2-digit'
	});
}

