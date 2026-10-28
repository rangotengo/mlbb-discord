import { Guild, PermissionFlagsBits, Role } from "discord.js";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../database/orm/MatchSchedule";

export interface ReadinessIssue {
	code: string;
	severity: "error" | "warning";
	message: string;
	repair?: string;
}

export interface TournamentChecklist {
	tournamentId: string;
	steps: Array<{ id: string; label: string; complete: boolean; action: string }>;
	nextAction: string | null;
}

function roleByConfiguredIdentity(guild: Guild, id?: string | null, name?: string | null): Role | undefined {
	if (id && guild.roles.cache.has(id)) return guild.roles.cache.get(id);
	if (name) return guild.roles.cache.find(role => role.name === name);
	return undefined;
}

/** Inspects Discord permissions without changing the server. */
export function inspectGuildReadiness(guild: Guild, tournament: ChallongeTournament): ReadinessIssue[] {
	const issues: ReadinessIssue[] = [];
	const me = guild.members.me;
	if (!me) return [{ code: "bot-missing", severity: "error", message: "The bot is not available in this server." }];
	const required = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
	if (!me.permissions.has(required)) {
		issues.push({ code: "bot-permissions", severity: "error", message: "The bot needs Manage Roles, Manage Channels, View Channel, and Send Messages.", repair: "Move or edit the bot role in Discord, then recheck." });
	}
	const participant = roleByConfiguredIdentity(guild, tournament.participantRoleId, tournament.participantRoleName);
	if (!participant) {
		issues.push({ code: "participant-role", severity: "error", message: "The configured participant role cannot be found by its saved ID or name.", repair: "Select the role again from tournament settings." });
	} else if (participant.position >= me.roles.highest.position) {
		issues.push({ code: "role-position", severity: "error", message: `The bot cannot assign ${participant.name} because that role is above the bot.`, repair: "Move the bot role above the participant role." });
	}
	for (const channelId of [...tournament.publicChannels, ...tournament.privateChannels]) {
		const channel = guild.channels.cache.get(channelId);
		if (!channel) issues.push({ code: "channel-missing", severity: "error", message: `Configured channel ${channelId} no longer exists.`, repair: "Choose a replacement channel." });
		else if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel)) issues.push({ code: "channel-access", severity: "error", message: `The bot cannot view #${channel.name}.` });
	}
	return issues;
}

export async function tournamentChecklist(tournament: ChallongeTournament): Promise<TournamentChecklist> {
	const players = await EnrolledPlayer.find({ where: { tournamentId: tournament.tournamentId } });
	const schedules = await MatchSchedule.count({ where: { tournamentId: tournament.tournamentId } });
	const unresolved = players.filter(player => !player.identityVerified).length;
	const steps = [
		{ id: "connect", label: "Connect tournament", complete: Boolean(tournament.challongeTournamentId), action: `/tournaments/${encodeURIComponent(tournament.tournamentId)}` },
		{ id: "import", label: "Import enrolments", complete: players.length > 0, action: `/tournaments/${encodeURIComponent(tournament.tournamentId)}` },
		{ id: "resolve", label: "Resolve unmatched enrolments", complete: unresolved === 0, action: "/players" },
		{ id: "checkin", label: "Configure check-in", complete: true, action: `/tournaments/${encodeURIComponent(tournament.tournamentId)}` },
		{ id: "schedule", label: "Schedule fixtures", complete: schedules > 0, action: `/tournaments/${encodeURIComponent(tournament.tournamentId)}` }
	];
	return { tournamentId: tournament.tournamentId, steps, nextAction: steps.find(step => !step.complete)?.action || null };
}
