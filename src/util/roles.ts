import { GuildMember } from "discord.js";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { Logger } from "./logger";
import { ParticipantRoleProvider } from "../role/participant";

/**
 * Gets the participant role name for a tournament.
 * Returns tournament-specific custom role if set, otherwise uses the auto-generated format.
 * The auto-generated format matches ParticipantRoleProvider's naming: {tournamentId}-player
 */
export function getParticipantRoleName(tournament: ChallongeTournament): string {
	return tournament.participantRoleName || `${tournament.tournamentId}-player`;
}

/**
 * Assigns the participant role to a guild member.
 *
 * If tournament.participantRoleName is configured, uses that specific role.
 * Otherwise, uses ParticipantRoleProvider to auto-create and assign a role
 * with the pattern "{tournamentId}-player".
 *
 * @param member - The guild member to assign the role to
 * @param tournament - The tournament to get the role name from
 * @param logger - Logger instance
 * @param participantRoleProvider - Optional provider for auto-creating roles
 * @returns true if successful, false otherwise
 */
export async function assignParticipantRole(
	member: GuildMember,
	tournament: ChallongeTournament,
	logger: Logger,
	participantRoleProvider?: ParticipantRoleProvider
): Promise<boolean> {
	// If tournament has a custom role configured, use it directly
	if (tournament.participantRoleId || tournament.participantRoleName) {
		const roleName = getParticipantRoleName(tournament);
		const role = (tournament.participantRoleId && member.guild.roles.cache.get(tournament.participantRoleId))
			|| member.guild.roles.cache.find(r => r.name === roleName);

		if (!role) {
			logger.warn(`Participant role "${roleName}" not found for tournament ${tournament.tournamentId}`);
			return false;
		}

		try {
			await member.roles.add(role);
			logger.info(`Assigned participant role "${roleName}" to ${member.user.tag}`);
			return true;
		} catch (err) {
			logger.error(`Failed to assign participant role ${roleName} to ${member.user.tag}:`, err);
			return false;
		}
	}

	// Otherwise, use ParticipantRoleProvider for auto-creation
	if (participantRoleProvider) {
		try {
			await participantRoleProvider.grant(member.id, {
				id: tournament.tournamentId,
				server: member.guild.id
			});
			logger.info(`Assigned participant role via provider to ${member.user.tag} for tournament ${tournament.tournamentId}`);
			return true;
		} catch (err) {
			logger.error(`Failed to assign participant role via provider to ${member.user.tag}:`, err);
			return false;
		}
	}

	// Fallback: try the default role name from config
	const roleName = getParticipantRoleName(tournament);
	const role = member.guild.roles.cache.find(r => r.name === roleName);

	if (!role) {
		logger.warn(`Participant role "${roleName}" not found for tournament ${tournament.tournamentId}`);
		return false;
	}

	try {
		await member.roles.add(role);
		logger.info(`Assigned participant role "${roleName}" to ${member.user.tag}`);
		return true;
	} catch (err) {
		logger.error(`Failed to assign participant role ${roleName} to ${member.user.tag}:`, err);
		return false;
	}
}
