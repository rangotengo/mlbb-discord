import type { WebsitePlayer } from "../website/challengermode";

/** Stored platform identities take precedence over mutable display names. */
export function resolveTeamMembers<T extends { challongeId?: string; team?: string; name?: string }>(
	members: T[], lineup: Pick<WebsitePlayer, "challongeId" | "name"> | null | undefined
): T[] {
	if (!lineup) return [];
	const normalized = lineup.name.trim().toLowerCase();
	return members.filter(member => member.challongeId
		? member.challongeId === lineup.challongeId
		: (member.team || member.name || "").trim().toLowerCase() === normalized);
}
