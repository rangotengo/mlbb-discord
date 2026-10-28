import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	GuildMember,
	PermissionsBitField
} from "discord.js";
import { CommandSupport } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger } from "../util/logger";
import { assignParticipantRole, TICKETS_CATEGORY_NAME, TICKET_CHANNEL_PREFIX } from "../util";
import { addUserToMatchThreads } from "../util/matchThreads";

const logger = getLogger("event:guildMemberAdd");

export function makeHandler(_support: CommandSupport) {
	return async (member: GuildMember) => {
		try {
			logger.info(`New member joined: ${member.user.tag} in guild ${member.guild.id}`);

			// Query EnrolledPlayer for this guild
			// We look for any enrolled player whose discordUsername or name matches the joined user's username,
			// global name, or displayName.

			// First, find the tournaments for this guild
			const tournaments = await ChallongeTournament.find({
				where: { owningDiscordServer: member.guild.id }
			});

			// Then, find all enrolled players for those tournaments
			const tournamentIds = tournaments.map(t => t.tournamentId);

			// Block if all tournaments have check-in disabled
			if (tournaments.length > 0 && tournaments.every(t => t.checkInDisabled)) {
				logger.info(`Verification disabled for guild ${member.guild.id}, skipping member join logic for ${member.user.tag}`);
				return;
			}

			const enrolledPlayers: EnrolledPlayer[] = [];
			if (tournamentIds.length > 0) {
				for (const tournamentId of tournamentIds) {
					const playersForTournament = await EnrolledPlayer.find({
						where: { tournamentId },
						relations: ["tournament"]
					});
					enrolledPlayers.push(...playersForTournament);
				}
			}

			const matchForms = [member.user.username.toLowerCase()];
			if (member.user.globalName) matchForms.push(member.user.globalName.toLowerCase());
			if (member.displayName) matchForms.push(member.displayName.toLowerCase());

			const matchedPlayer = enrolledPlayers.find(
				p => p.discordUsername && matchForms.includes(p.discordUsername.toLowerCase())
			);

			if (matchedPlayer) {
				// If tournament relation is not loaded, fetch it manually
				if (!matchedPlayer.tournament) {
					const tournament = await ChallongeTournament.findOne({
						where: { tournamentId: matchedPlayer.tournamentId }
					});
					if (!tournament) {
						logger.error(`Could not find tournament with ID ${matchedPlayer.tournamentId}`);
						return;
					}
					matchedPlayer.tournament = tournament;
				}

				if (!matchedPlayer.verified) {
					// Local-only verification as per the new team-focused plan
					try {
						matchedPlayer.verified = true;
						matchedPlayer.discordId = member.id;
						matchedPlayer.discordUsername = member.user.username;
						await matchedPlayer.save();

						// Assign participant role
						const roleAssigned = await assignParticipantRole(member, matchedPlayer.tournament, logger, _support.participantRole);
						if (!roleAssigned) {
							logger.warn(`Failed to assign participant role to ${member.user.tag} on guild join`);
						}

						// Add user to existing match threads
						const threadsAdded = await addUserToMatchThreads(member.guild, matchedPlayer, _support.tournamentApi);
						if (threadsAdded > 0) {
							logger.info(`Added ${member.user.tag} to ${threadsAdded} match thread(s) via guild join`);
						}

						logger.info(`Successfully auto-verified member ${member.user.tag} (Local Check)`);
					} catch (err) {
						logger.error(`Error during local auto-verification for ${member.user.tag}:`, err);
					}
				} else {
					// Player is already verified, just assign the role
					const roleAssigned = await assignParticipantRole(member, matchedPlayer.tournament, logger, _support.participantRole);
					if (!roleAssigned) {
						logger.warn(`Failed to assign participant role to already-verified ${member.user.tag} on guild join`);
					}

					// Also try to add to match threads in case they were missed
					const threadsAdded = await addUserToMatchThreads(member.guild, matchedPlayer, _support.tournamentApi);
					if (threadsAdded > 0) {
						logger.info(`Added ${member.user.tag} to ${threadsAdded} match thread(s) via guild join (already verified)`);
					}

					logger.info(`Member ${member.user.tag} is already verified, assigned role`);
				}

				return; // Stop here, don't create a ticket
			}

			// If no match was found or verification failed, open an onboarding ticket
			const category = member.guild.channels.cache.find(
				ch => ch.name.toLowerCase() === TICKETS_CATEGORY_NAME && ch.type === ChannelType.GuildCategory
			);

			// create channel
			const channel = await member.guild.channels.create({
				name: `${TICKET_CHANNEL_PREFIX}${member.user.username}`,
				type: ChannelType.GuildText,
				parent: category?.id,
				permissionOverwrites: [
					{
						id: member.guild.roles.everyone.id,
						deny: [PermissionsBitField.Flags.ViewChannel]
					},
					{
						id: member.id,
						allow: [
							PermissionsBitField.Flags.ViewChannel,
							PermissionsBitField.Flags.SendMessages,
							PermissionsBitField.Flags.ReadMessageHistory,
							PermissionsBitField.Flags.AttachFiles,
							PermissionsBitField.Flags.EmbedLinks
						]
					}
				],
				reason: `Onboarding ticket for ${member.user.tag}`
			});

			const welcomeEmbed = new EmbedBuilder()
				.setTitle("Welcome to the Tournament Server!")
				.setDescription(
					`Hi <@${member.id}>, we couldn't automatically verify you.\n\nPlease use the command \`!email <your_email>\` in this channel to verify your identity and get your participant roles. If you need help, a Tournament Organizer will be with you shortly.`
				)
				.setColor("#00b0f4");

			const closeButton = new ButtonBuilder()
				.setCustomId("close_ticket")
				.setLabel("Close Ticket")
				.setStyle(ButtonStyle.Danger);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton);

			await channel.send({
				content: `<@${member.id}>`,
				embeds: [welcomeEmbed],
				components: [row]
			});

		} catch (error) {
			logger.error(`Error handling guildMemberAdd for ${member.user.id}:`, error);
		}
	};
}
