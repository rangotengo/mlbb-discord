import { parseCSV } from "../util/csv";
import { parseDateTime } from "../util/parseDateTime";
import { UUID_PATTERN } from "../website/challengermode";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../database/orm/MatchSchedule";

export type ImportStatus = "added" | "changed" | "unchanged" | "rejected";

export interface ImportRow {
	row: number;
	status: ImportStatus;
	reason?: string;
	values: Record<string, string>;
}

export interface ImportPreview {
	added: number;
	changed: number;
	unchanged: number;
	rejected: number;
	rows: ImportRow[];
	summary: string;
}

function indexOf(headers: string[], accepted: string[]): number {
	return headers.findIndex(header => accepted.includes(header));
}

function summarise(preview: Omit<ImportPreview, "summary">): ImportPreview {
	return {
		...preview,
		summary: `${preview.added} to add, ${preview.changed} to change, ${preview.unchanged} unchanged, ${preview.rejected} rejected`
	};
}

function counts(rows: ImportRow[]): Omit<ImportPreview, "summary"> {
	return {
		added: rows.filter(row => row.status === "added").length,
		changed: rows.filter(row => row.status === "changed").length,
		unchanged: rows.filter(row => row.status === "unchanged").length,
		rejected: rows.filter(row => row.status === "rejected").length,
		rows
	};
}

export async function previewParticipants(tournamentId: string, csv: string): Promise<ImportPreview | { error: string }> {
	const lines = parseCSV(csv);
	if (lines.length < 2) return { error: "CSV must have a header and one data row" };
	const headers = lines[0].map(header => header.toLowerCase());
	const emailIdx = indexOf(headers, ["email"]);
	const nameIdx = indexOf(headers, ["name", "player name", "playername", "player_name"]);
	const teamIdx = headers.findIndex(header => header.includes("team"));
	if (emailIdx < 0 || nameIdx < 0 || teamIdx < 0) return { error: "CSV header must contain email, name, and team columns" };
	const discordIdx = indexOf(headers, ["discord username", "discordusername", "discord"]);
	const discordIdIdx = indexOf(headers, ["discord id", "discordid"]);
	const existing = await EnrolledPlayer.find({ where: { tournamentId } });
	const byEmail = new Map(existing.map(player => [player.email.toLowerCase(), player]));
	const seen = new Set<string>();
	const rows: ImportRow[] = [];

	for (let index = 1; index < lines.length; index++) {
		const columns = lines[index];
		const values = {
			email: columns[emailIdx] || "",
			name: columns[nameIdx] || "",
			team: columns[teamIdx] || "",
			discordUsername: discordIdx >= 0 ? columns[discordIdx] || "" : "",
			discordId: discordIdIdx >= 0 ? columns[discordIdIdx] || "" : ""
		};
		const email = values.email.trim().toLowerCase();
		if (!email || !values.name.trim() || !values.team.trim()) {
			rows.push({ row: index + 1, status: "rejected", reason: "Missing email, name, or team", values });
			continue;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			rows.push({ row: index + 1, status: "rejected", reason: "Invalid email address", values });
			continue;
		}
		if (seen.has(email)) {
			rows.push({ row: index + 1, status: "rejected", reason: "Duplicate email in this file", values });
			continue;
		}
		seen.add(email);
		const current = byEmail.get(email);
		if (!current) {
			rows.push({ row: index + 1, status: "added", values });
			continue;
		}
		const changed = current.name !== values.name || current.team !== values.team
			|| (values.discordUsername && current.discordUsername !== values.discordUsername)
			|| (values.discordId && current.discordId !== values.discordId);
		if (current.identityVerified && values.discordId && values.discordId !== current.discordId) {
			rows.push({ row: index + 1, status: "rejected", reason: "Verified Discord account cannot be replaced by import", values });
			continue;
		}
		rows.push({ row: index + 1, status: changed ? "changed" : "unchanged", values });
	}
	return summarise(counts(rows));
}

export async function previewSchedules(tournamentId: string, csv: string, knownMatches?: Set<string>): Promise<ImportPreview | { error: string }> {
	const lines = parseCSV(csv);
	if (lines.length < 2) return { error: "CSV must have a header and one data row" };
	const headers = lines[0].map(header => header.toLowerCase());
	const matchIdx = headers.findIndex(header => header.includes("match") && header.includes("id"));
	const timeIdx = headers.findIndex(header => header.includes("scheduled") || header.includes("time") || header.includes("date"));
	const zoneIdx = headers.findIndex(header => header.includes("timezone") || header === "tz" || header.includes("zone"));
	if (matchIdx < 0 || timeIdx < 0) return { error: "CSV header must contain match_id and scheduled_time columns" };
	const existing = await MatchSchedule.find({ where: { tournamentId } });
	const byMatch = new Map(existing.map(schedule => [schedule.matchId, schedule]));
	const seen = new Set<string>();
	const rows: ImportRow[] = [];

	for (let index = 1; index < lines.length; index++) {
		const columns = lines[index];
		const values = { matchId: columns[matchIdx] || "", scheduledTime: columns[timeIdx] || "", timezone: zoneIdx >= 0 ? columns[zoneIdx] || "" : "" };
		const matchId = values.matchId.trim().toLowerCase();
		if (!matchId || !values.scheduledTime.trim()) {
			rows.push({ row: index + 1, status: "rejected", reason: "Missing match_id or scheduled_time", values });
			continue;
		}
		if (!UUID_PATTERN.test(matchId)) {
			rows.push({ row: index + 1, status: "rejected", reason: "match_id must be a UUID", values });
			continue;
		}
		if (knownMatches && !knownMatches.has(matchId)) {
			rows.push({ row: index + 1, status: "rejected", reason: "Match does not belong to this tournament", values });
			continue;
		}
		if (seen.has(matchId)) {
			rows.push({ row: index + 1, status: "rejected", reason: "Duplicate match in this file", values });
			continue;
		}
		seen.add(matchId);
		let parsed: Date;
		try {
			parsed = parseDateTime(values.scheduledTime, values.timezone || undefined);
		} catch (error) {
			rows.push({ row: index + 1, status: "rejected", reason: error instanceof Error ? error.message : "Invalid date", values });
			continue;
		}
		const current = byMatch.get(matchId);
		if (!current) {
			rows.push({ row: index + 1, status: "added", values });
			continue;
		}
		rows.push({ row: index + 1, status: current.scheduledTime.getTime() === parsed.getTime() ? "unchanged" : "changed", values });
	}
	return summarise(counts(rows));
}
