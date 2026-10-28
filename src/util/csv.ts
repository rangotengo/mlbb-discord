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

	if (!attachment.name?.toLowerCase().endsWith(".csv")) {
		throw new UserError("The attached file must be a CSV.");
	}

	let csvText: string;
	try {
		const res = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		csvText = await res.text();
	} catch (err) {
		logger.error("Failed to download CSV attachment:", err);
		throw new UserError("Failed to download the CSV file.");
	}

	const lines = parseCSV(csvText);
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
	const rows = parseCSV(row);
	if (rows.length > 1) throw new UserError("Expected one CSV record.");
	return rows[0] ?? [""];
}

/** Parses CSV records, including escaped quotes, embedded newlines, CRLF, and a UTF-8 BOM. */
export function parseCSV(text: string): string[][] {
	const rows: string[][] = [];
	let values: string[] = [];
	let current = "";
	let quoted = false;
	let closed = false;
	const input = text.replace(/^\uFEFF/, "");
	const field = (): void => { values.push(current.trim()); current = ""; closed = false; };
	const record = (): void => {
		field();
		if (values.some(value => value !== "")) rows.push(values);
		values = [];
	};
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (quoted) {
			if (char === '"' && input[i + 1] === '"') { current += '"'; i++; }
			else if (char === '"') { quoted = false; closed = true; }
			else current += char;
		} else if (char === ',') field();
		else if (char === '\n' || char === '\r') {
			if (char === '\r' && input[i + 1] === '\n') i++;
			record();
		} else if (char === '"') {
			if (current.trim() || closed) throw new UserError("Invalid quote in CSV field.");
			current = ""; quoted = true;
		} else if (closed && !/\s/.test(char)) throw new UserError("Unexpected text after a quoted CSV field.");
		else current += char;
	}
	if (quoted) throw new UserError("Unclosed quote in CSV file.");
	if (current || values.length || closed) record();
	return rows;
}

export function formatCSVRow(values: (string | number | null | undefined)[]): string {
	return values.map(value => {
		const text = String(value ?? "");
		return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	}).join(",");
}

/** Schedule exports use UTC consistently and leave unscheduled sentinel dates blank. */
export function formatCSVDate(date: Date | undefined | null): string {
	if (!date || !Number.isFinite(date.getTime()) || date.getUTCFullYear() >= 2090) return "";
	return date.toISOString().slice(0, 19).replace("T", " ");
}
