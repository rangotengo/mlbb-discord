import dotenv from "dotenv";
import { UserError } from "../util/errors";

/** Update an env file without interpreting values as additional assignments or comments. */
export function updateEnvContent(content: string, updates: Record<string, unknown>): string {
	const encoded = new Map<string, string>();
	for (const [key, value] of Object.entries(updates)) {
		if (key === "DISCORD_TOKEN") continue;
		if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof value !== "string" || /[\r\n\0]/.test(value)) {
			throw new UserError("Environment settings must use valid keys and single-line text values.");
		}
		const quoted = ["'", '"', "`"].map(q => `${q}${value}${q}`).find(candidate => dotenv.parse(`VALUE=${candidate}`).VALUE === value);
		if (!quoted) throw new UserError(`Cannot encode the value for ${key} in an env file.`);
		encoded.set(key, quoted);
	}
	const seen = new Set<string>();
	const lines = content.split(/\r?\n/).map(line => {
		const key = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1];
		if (!key || !encoded.has(key)) return line;
		seen.add(key);
		return `${key}=${encoded.get(key)}`;
	});
	for (const [key, value] of encoded) if (!seen.has(key)) lines.push(`${key}=${value}`);
	return lines.join("\n");
}
