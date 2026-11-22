import { GuildMember } from "discord.js";

export type MemberNameIndex = Map<string, Map<string, GuildMember>>;
export function normalizeDiscordName(value: string): string {
	return value.trim().replace(/^@/, "").toLowerCase();
}

export function indexMemberNames(members: Iterable<GuildMember>): MemberNameIndex {
	const index: MemberNameIndex = new Map();
	for (const member of members) {
		if (member.user.bot) continue;
		for (const value of [member.user.username, member.user.globalName, member.displayName, member.user.tag]) {
			if (!value) continue;
			const name = normalizeDiscordName(value);
			if (!index.has(name)) index.set(name, new Map());
			index.get(name)!.set(member.id, member);
		}
	}
	return index;
}

export function matchMemberName(index: MemberNameIndex, value: string): GuildMember {
	const matches = index.get(normalizeDiscordName(value));
	if (!matches?.size) throw new Error("No server member matches the imported Discord name");
	if (matches.size !== 1) throw new Error("Discord name matches multiple server members; use a Discord ID or manual verification");
	return matches.values().next().value!;
}
