/**
 * Days in each month (non-leap year).
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Checks if a year is a leap year.
 */
function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Gets the maximum valid day for a given month and year.
 */
function getMaxDay(year: number, month: number): number {
	if (month === 2 && isLeapYear(year)) {
		return 29;
	}
	return DAYS_IN_MONTH[month - 1];
}

/**
 * Validates time values are within valid ranges.
 */
function validateTime(hours: number, minutes: number, seconds: number): void {
	if (hours < 0 || hours > 23) {
		throw new Error(`Invalid hours: ${hours}. Hours must be between 0 and 23`);
	}
	if (minutes < 0 || minutes > 59) {
		throw new Error(`Invalid minutes: ${minutes}. Minutes must be between 0 and 59`);
	}
	if (seconds < 0 || seconds > 59) {
		throw new Error(`Invalid seconds: ${seconds}. Seconds must be between 0 and 59`);
	}
}

/**
 * Parses a date/time string with optional timezone.
 * Supported date formats:
 * - YYYY-MM-DD HH:MM:SS
 * - YYYY-MM-DD HH:MM
 * - YYYY-MM-DDTHH:MM (ISO 8601, from datetime-local input)
 * - YYYY-MM-DDTHH:MM:SS (ISO 8601 with seconds)
 * - MM/DD/YYYY HH:MM
 * - DD/MM/YYYY HH:MM
 * Supported timezone formats:
 * - Abbreviations: EST, PST, GMT, CET, IST, etc.
 * - UTC offsets: +05:30, -08:00, +00:00 (valid range: ±14:00, minutes 00-59)
 * - Default: UTC if no timezone specified
 */
export function parseDateTime(dateTimeStr: string, timezone?: string): Date {
	// Remove any extra whitespace
	const cleanDateTime = dateTimeStr.trim();
	// Simplified timezone cleaning: remove UTC prefix, leading colon, and all colons
	const cleanTz = timezone ? timezone.trim().toUpperCase().replace(/^UTC/, "").replace(/^:/, "").replace(/:/g, "") : "";

	// Try ISO 8601 format first (YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS)
	const isoTMatchWithSeconds = cleanDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
	const isoTMatchWithoutSeconds = cleanDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
	const isoTMatch = isoTMatchWithSeconds || isoTMatchWithoutSeconds;

	if (isoTMatch) {
		const [, year, month, day, hours, minutes] = isoTMatch.map(Number);
		const seconds = isoTMatchWithSeconds ? Number(isoTMatch[6]) : 0;
		validateTime(hours, minutes, seconds);
		validateDate(year, month, day);
		const date = utcDate(year, month, day, hours, minutes, seconds);
		return applyTimezone(date, cleanTz, timezone);
	}

	// Try ISO format with space (YYYY-MM-DD HH:MM:SS or YYYY-MM-DD HH:MM)
	const isoSpaceMatchWithSeconds = cleanDateTime.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
	const isoSpaceMatchWithoutSeconds = cleanDateTime.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
	const isoSpaceMatch = isoSpaceMatchWithSeconds || isoSpaceMatchWithoutSeconds;

	if (isoSpaceMatch) {
		const [, year, month, day, hours, minutes] = isoSpaceMatch.map(Number);
		const seconds = isoSpaceMatchWithSeconds ? Number(isoSpaceMatch[6]) : 0;
		validateTime(hours, minutes, seconds);
		validateDate(year, month, day);
		const date = utcDate(year, month, day, hours, minutes, seconds);
		return applyTimezone(date, cleanTz, timezone);
	}

	// Try slash formats (MM/DD/YYYY or DD/MM/YYYY)
	const slashMatchWithSeconds = cleanDateTime.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
	const slashMatchWithoutSeconds = cleanDateTime.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
	const slashMatch = slashMatchWithSeconds || slashMatchWithoutSeconds;

	if (!slashMatch) {
		throw new Error(`Invalid date format: ${dateTimeStr}. Use YYYY-MM-DD HH:MM:SS, MM/DD/YYYY HH:MM, or DD/MM/YYYY HH:MM`);
	}

	const [, part1, part2, year, hours, minutes] = slashMatch.map(Number);
	const seconds = slashMatchWithSeconds ? Number(slashMatch[6]) : 0;

	// Validate time values
	validateTime(hours, minutes, seconds);

	// Determine if it's MM/DD/YYYY or DD/MM/YYYY using a heuristic
	// Try MM/DD/YYYY first (more common globally)
	let month: number, day: number;
	if (part1 > 12) {
		// First number can't be a month, so it must be DD/MM/YYYY format
		day = part1;
		month = part2;
	} else if (part2 > 12) {
		// Second number can't be a month, so it must be MM/DD/YYYY format
		month = part1;
		day = part2;
	} else {
		// Both are <= 12, ambiguous - default to MM/DD/YYYY (more common)
		month = part1;
		day = part2;
	}

	// Validate date
	validateDate(year, month, day);

	// Create date in UTC first
	const date = utcDate(year, month, day, hours, minutes, seconds);
	return applyTimezone(date, cleanTz, timezone);
}

/**
 * Validates that a date is valid (year, month, day combination).
 */
function validateDate(year: number, month: number, day: number): void {
	if (month < 1 || month > 12) {
		throw new Error(`Invalid month: ${month}. Month must be between 1 and 12`);
	}
	if (day < 1) {
		throw new Error(`Invalid day: ${day}. Day must be at least 1`);
	}
	const maxDay = getMaxDay(year, month);
	if (day > maxDay) {
		throw new Error(`Invalid day: ${day} for month ${month}. Day must be between 1 and ${maxDay}`);
	}
}

/**
 * Validates that a timezone offset is within valid range (±14:00).
 */
function validateTimezoneOffset(offsetHours: number, offsetMinutes: number): void {
	if (offsetMinutes < 0 || offsetMinutes > 59) {
		throw new Error(`Invalid timezone offset minutes: ${offsetMinutes}. Minutes must be between 0 and 59`);
	}
	const totalOffsetHours = offsetHours + offsetMinutes / 60;
	if (Math.abs(totalOffsetHours) > 14) {
		throw new Error(`Invalid timezone offset: ${offsetHours >= 0 ? '+' : ''}${offsetHours}:${offsetMinutes.toString().padStart(2, '0')}. Offset must be between -14:00 and +14:00`);
	}
}

/**
 * Applies timezone offset to a date.
 */
function applyTimezone(date: Date, cleanTz: string, originalTimezone?: string): Date {
	// Apply timezone offset if provided
	if (cleanTz && cleanTz !== "Z") {
		// Parse timezone offset (e.g., +05:30, -08:00)
		const offsetMatch = cleanTz.match(/^([+-])(\d{2}):?(\d{2})$/);
		if (offsetMatch) {
			const sign = offsetMatch[1] === "+" ? 1 : -1;
			const offsetHours = parseInt(offsetMatch[2], 10);
			const offsetMinutes = parseInt(offsetMatch[3], 10);
			// Validate offset range
			validateTimezoneOffset(offsetHours, offsetMinutes);
			const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;
			// Adjust by reversing the offset (to get UTC from local)
			date.setTime(date.getTime() - offsetMs);
			return date;
		}

		// Handle timezone abbreviations
		const timezoneOffsets: Record<string, number> = {
			// US timezones
			EST: -5, EDT: -4,
			CST: -6, CDT: -5,
			MST: -7, MDT: -6,
			PST: -8, PDT: -7,
			AKST: -9, AKDT: -8,
			HAST: -10, HADT: -9,
			// European timezones
			GMT: 0, BST: 1,
			CET: 1, CEST: 2,
			EET: 2, EEST: 3,
			// Other common timezones
			IST: 5.5, // India (Note: Irish Standard Time also uses IST but +1, India takes precedence)
			JST: 9, // Japan
			AEST: 10, AEDT: 11, // Australia
			NZST: 12, NZDT: 13, // New Zealand
			SGT: 8, // Singapore
			HKT: 8, // Hong Kong
			CHST: 8, // China Standard Time (using CHST to avoid conflict with US CST)
			KST: 9, // Korea
		};

		const offset = timezoneOffsets[cleanTz];
		if (offset !== undefined) {
			// Adjust by reversing the offset (to get UTC from local)
			const offsetMs = -(offset * 60 * 60 * 1000);
			date.setTime(date.getTime() + offsetMs);
			return date;
		}

		// Resolve the wall-clock time using offsets around the target date. Sampling both
		// sides of a DST transition avoids assuming the offset at midnight is still valid.
		let formatter: Intl.DateTimeFormat;
		try {
			formatter = new Intl.DateTimeFormat("en-GB", {
				timeZone: originalTimezone?.trim(), year: "numeric", month: "2-digit", day: "2-digit",
				hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
			});
		} catch {
			throw new Error(`Unknown timezone: ${originalTimezone}. Use EST, +05:30, Asia/Kathmandu, or leave empty for UTC`);
		}
		const wallTime = (instant: number): number => {
			const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
			return utcDate(+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute, +parts.second).getTime();
		};
		const target = date.getTime();
		const offsets = new Set([-2, -1, 0, 1, 2].map(days => {
			const sample = target + days * 86_400_000;
			return wallTime(sample) - sample;
		}));
		const candidates = [...offsets].map(offset => target - offset).filter(instant => wallTime(instant) === target);
		if (candidates.length !== 1) {
			throw new Error(`Local time is ${candidates.length ? "ambiguous" : "nonexistent"} in ${originalTimezone}. Supply an explicit UTC offset.`);
		}
		return new Date(candidates[0]);
	}

	return date;
}

function utcDate(year: number, month: number, day: number, hours: number, minutes: number, seconds: number): Date {
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(hours, minutes, seconds, 0);
	return date;
}
