/** Parse IDs as strings so spreadsheet snowflakes never lose integer precision. */
export function parseDiscordId(value: string | null | undefined): string | undefined {
	const text = value?.trim() || "";
	const id = text.match(/^<@!?(\d{17,20})>$/)?.[1] || text;
	if (!/^\d{17,20}$/.test(id) || BigInt(id) > 18446744073709551615n) return undefined;
	return id;
}
