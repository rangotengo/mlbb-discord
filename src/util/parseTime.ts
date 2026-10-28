import { UserError } from "./errors";

/**
 * Parses a duration string in "hh:mm" or "mm" format and returns minutes.
 *
 * @param timeStr - Duration string like "1:30" (90 min) or "45" (45 min)
 * @returns Duration in minutes
 * @throws {UserError} If format is invalid
 */
export function parseTime(timeStr: string): number {
	const trimmed = timeStr.trim();

	// Try "hh:mm" format first
	const colonMatch = trimmed.match(/^(\d+):(\d+)$/);
	if (colonMatch) {
		const hours = parseInt(colonMatch[1], 10);
		const minutes = parseInt(colonMatch[2], 10);

		if (!Number.isSafeInteger(hours * 60 + minutes) || minutes >= 60) {
			throw new UserError(`Invalid time format: ${timeStr}. Minutes must be 0-59.`);
		}

		return hours * 60 + minutes;
	}

	// Try "mm" format (just minutes)
	const minutesOnly = parseInt(trimmed, 10);
	if (/^\d+$/.test(trimmed) && Number.isSafeInteger(minutesOnly) && minutesOnly >= 0) {
		return minutesOnly;
	}

	throw new UserError(`Invalid time format: ${timeStr}. Use "hh:mm" or "mm".`);
}
