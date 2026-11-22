import { Attachment } from "discord.js";
import { getLogger } from "./logger";
import { UserError } from "./errors";

const logger = getLogger("util:csv");

/**
 * Downloads and validates a CSV attachment from a Discord message.
 *
 * @param attachment - The attachment to download and validate
 * @param minRows - Minimum number of rows required (including header). Default: 2
 * @returns The CSV text content
 * @throws {UserError} If attachment is missing, not a CSV, or has insufficient rows
 */
export async function downloadAndValidateCSV(
	attachment: Attachment | null | undefined,
	minRows: number = 2
): Promise<string> {
	if (!attachment) {
		throw new UserError("Please attach a CSV file.");
	}

	if (!/\.(csv|tsv)$/i.test(attachment.name || "")) {
		throw new UserError("The attached file must be a CSV or TSV.");
	}

	let csvText: string;
	try {
		const res = await fetch(attachment.url);
		csvText = await res.text();
	} catch (err) {
		logger.error("Failed to download CSV attachment:", err);
		throw new UserError("Failed to download the CSV file.");
	}

	const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
	if (lines.length < minRows) {
		throw new UserError(`The CSV file must contain at least ${minRows} rows (including header).`);
	}

	return csvText;
}

/**
 * Parses a single CSV row, handling quoted values.
 *
 * @param row - The CSV row to parse
 * @returns Array of column values
 */
export function parseCSVRow(row: string): string[] {
	// Strip Windows-style carriage returns before parsing
	row = row.replace(/\r/g, "");
	const values: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < row.length; i++) {
		const char = row[i];
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			values.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	values.push(current.trim());
	return values;
}
