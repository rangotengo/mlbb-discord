import { parseDiscordId } from "./discordId";
import { UserError } from "./errors";

export const TEAM_IMPORT_HEADERS = ["Team Name", ...Array.from({ length: 6 }, (_, i) =>
	[`email_p${i + 1}`, `discord_p${i + 1}`, `name_p${i + 1}`]).flat()];

export interface ImportedPlayer {
	email: string;
	name: string;
	team: string;
	discordUsername?: string;
	discordId?: string;
	source: string;
}

// Supports CSV exports and tab-separated spreadsheet data, including quoted cells.
export function parseImportTable(text: string): string[][] {
	text = text.replace(/^\uFEFF/, "");
	const firstLine = text.split(/\r?\n/, 1)[0];
	const delimiter = firstLine.includes("\t") ? "\t" : ",";
	const rows: string[][] = [];
	let row: string[] = [], cell = "", quoted = false;
	const finishRow = (): void => {
		row.push(cell.trim());
		if (row.some(value => value !== "")) rows.push(row);
		row = []; cell = "";
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
			else quoted = !quoted;
		} else if (ch === delimiter && !quoted) {
			row.push(cell.trim()); cell = "";
		} else if ((ch === "\n" || ch === "\r") && !quoted) {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			finishRow();
		} else cell += ch;
	}
	if (quoted) throw new UserError("Unclosed quoted cell in participant import");
	finishRow();
	return rows;
}

export function parseParticipantImport(text: string): { players: ImportedPlayer[]; errors: string[] } {
	const rows = parseImportTable(text);
	if (rows.length < 2) throw new UserError("Import must have a header and at least one data row");
	const headers = rows[0].map(h => h.toLowerCase().replace(/[\s_-]/g, ""));
	const index = (...names: string[]): number => headers.findIndex(h => names.includes(h));
	const teamIndex = index("team", "teamname");
	const wide = headers.some(h => /^(email|discord|name)p\d+$/.test(h));
	const groups = wide ? Array.from({ length: 6 }, (_, i) => ({
		email: index(`emailp${i + 1}`), name: index(`namep${i + 1}`),
		discord: index(`discordp${i + 1}`), id: -1, slot: i + 1
	})).filter(g => g.email !== -1 || g.name !== -1 || g.discord !== -1) : [{
		email: index("email", "emailaddress"), name: index("name", "fullname"),
		discord: index("discord", "discordusername"), id: index("discordid"), slot: 0
	}];
	if (teamIndex === -1 || !groups.length || groups.some(g => g.email === -1 || g.name === -1)) {
		throw new UserError("Use Team Name with email_p1, discord_p1, name_p1 through p6, or email,name,team,discord columns. Each player group needs email and name columns.");
	}
	if (headers.some(h => /^(email|discord|name)p\d+$/.test(h) && Number(h.match(/\d+$/)![0]) > 6)) {
		throw new UserError("Team imports support player columns p1 through p6 only");
	}
	const players: ImportedPlayer[] = [], errors: string[] = [];
	const seen = new Set<string>();
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r], team = row[teamIndex] || "";
		let populated = false;
		for (const g of groups) {
			const email = (row[g.email] || "").trim().toLowerCase();
			const name = row[g.name] || "";
			const discordValue = row[g.discord] || undefined;
			const discordUsername = parseDiscordId(discordValue) ? undefined : discordValue;
			const discordId = row[g.id] || parseDiscordId(discordValue);
			if (wide && !email && !name && !discordValue) continue;
			populated = true;
			const source = `Row ${r + 1}${wide ? `, player ${g.slot}` : ""}`;
			if (!team || !email || !name) { errors.push(`${source}: Missing team, email, or name`); continue; }
			if (seen.has(email)) { errors.push(`${source}: Duplicate player email in this import`); continue; }
			seen.add(email);
			players.push({ email, name, team, discordUsername, discordId, source });
		}
		if (!populated) errors.push(`Row ${r + 1}: No players supplied`);
	}
	return { players, errors };
}
