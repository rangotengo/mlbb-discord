import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	PermissionsBitField
} from "discord.js";
import { CommandDefinition } from "../Command";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger } from "../util/logger";
import { isTournamentOrganizer, assignParticipantRole, getParticipantRoleName, TO_COMMAND_BLOCKED, TICKETS_CATEGORY_NAME, TICKET_CHANNEL_PREFIX } from "../util";
import { addUserToMatchThreads } from "../util/matchThreads";
import { matchCheckIn } from "../role/helper/verification";

const logger = getLogger("command:check");

const command: CommandDefinition = {
	name: "check-in",
	requiredArgs: [],
	executor: async (msg, _args, support) => {
		if (isTournamentOrganizer(msg.member)) {
			await msg.reply(TO_COMMAND_BLOCKED);
			return;
		}

		if (!msg.guild) return;

		const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);

		// Display names are suggestions only; a verified Discord ID is the
		// sole basis for automatic identity confirmation (guide 1).
		const matchForms = [msg.author.username.toLowerCase()];
		if (msg.author.globalName) matchForms.push(msg.author.globalName.toLowerCase());
		if (member?.displayName) matchForms.push(member.displayName.toLowerCase());

		const match = await matchCheckIn(msg.author.id, msg.guild.id, matchForms);

		if (match.kind === "returning") {
			// Returning participant with a previously verified identity link.
			const outcomes: string[] = [];
			for (const player of match.players) {
				const tournament = player.tournament ?? await ChallongeTournament.findOne({
					where: { tournamentId: player.tournamentId }
				});
				if (!tournament) continue;

				if (tournament.checkInDisabled) {
					outcomes.push(`❌ **${tournament.name}**: check-in is closed. Contact the Tournament Organizer.`);
					continue;
				}

				const hasRole = member?.roles.cache.some(role => role.name === getParticipantRoleName(tournament));
				if (hasRole) {
					outcomes.push(`✅ **${tournament.name}**: you are verified and have access.`);
					continue;
				}

				const roleAssigned = member
					? await assignParticipantRole(member, tournament, logger, support.participantRole)
					: false;
				if (!roleAssigned) {
					// Identity stands; access provisioning is retried safely.
					if (!player.accessPending) {
						player.accessPending = true;
						await player.save().catch((err: unknown) => logger.error("Failed to mark access pending:", err));
					}
					outcomes.push(`⚠️ **${tournament.name}**: identity verified; access pending. The participant role could not be assigned — ask a Tournament Organizer to retry (\`!check-in\` again after the role is fixed).`);
					continue;
				}
				if (player.accessPending) {
					player.accessPending = false;
					await player.save().catch(() => undefined);
				}
				await addUserToMatchThreads(msg.guild, player, support.tournamentApi).catch(() => 0);
				outcomes.push(`✅ **${tournament.name}**: participant access restored. Welcome back!`);
			}
			await msg.reply(outcomes.join("\n") || "You are verified, but your tournaments could not be loaded. Please ask a TO for help.");
			return;
		}

		if (match.kind === "suggested") {
			// Name matches exist but prove nothing. Open the ticket flow; the
			// enrolment records are never mutated here.
			const names = [...new Set(match.players.map(p => p.tournamentId))].join(", ");
			logger.info(`Suggested-only check-in for ${msg.author.id}: ${names}. Ticket flow required.`);
		}

		// If no identity link was found, open an onboarding ticket.
		const category = msg.guild.channels.cache.find(
			ch => ch.name.toLowerCase() === TICKETS_CATEGORY_NAME && ch.type === ChannelType.GuildCategory
		);

		// Check if user already has an open ticket by fetching all channels
		const allChannels = await msg.guild.channels.fetch();
		const existingTicket = allChannels.find(ch =>
			ch?.type === ChannelType.GuildText &&
			ch.name === `${TICKET_CHANNEL_PREFIX}${msg.author.username}`
		);

		if (existingTicket) {
			await msg.reply(`You already have an open ticket: <#${existingTicket.id}>. Use \`!email <your_email>\` there to verify.`);
			return;
		}

		try {
			const channel = await msg.guild.channels.create({
				name: `${TICKET_CHANNEL_PREFIX}${msg.author.username}`,
				type: ChannelType.GuildText,
				parent: category?.id,
				permissionOverwrites: [
					{
						id: msg.guild.roles.everyone.id,
						deny: [PermissionsBitField.Flags.ViewChannel]
					},
					{
						id: msg.author.id,
						allow: [
							PermissionsBitField.Flags.ViewChannel,
							PermissionsBitField.Flags.SendMessages,
							PermissionsBitField.Flags.ReadMessageHistory,
							PermissionsBitField.Flags.AttachFiles,
							PermissionsBitField.Flags.EmbedLinks
						]
					}
				],
				reason: `Onboarding ticket via !check-in for ${msg.author.tag}`
			});

			const suggestedNote = match.kind === "suggested"
				? "\n\nWe found enrolment records that may be yours, but a matching name is not proof of ownership, so a Tournament Organizer or email verification is required."
				: "";

			const welcomeEmbed = new EmbedBuilder()
				.setTitle("Verification Required")
				.setDescription(
					`Hi <@${msg.author.id}>, we couldn't automatically verify you from a previously verified account.${suggestedNote}\n\nPlease use the command \`!email <your_email>\` in this channel to verify your identity and get your participant roles. The code expires in 10 minutes. If you need help, a Tournament Organizer will be with you shortly.`
				)
				.setColor("#00b0f4");

			const closeButton = new ButtonBuilder()
				.setCustomId("close_ticket")
				.setLabel("Close Ticket")
				.setStyle(ButtonStyle.Danger);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton);

			await channel.send({
				content: `<@${msg.author.id}>`,
				embeds: [welcomeEmbed],
				components: [row]
			});

			await msg.reply(`We couldn't automatically verify you. A private ticket has been opened for you: <#${channel.id}>`);
		} catch (err) {
			logger.error(`Error creating ticket for ${msg.author.tag}:`, err);
			await msg.reply(`We couldn't verify you, and there was an issue creating a ticket. Please ask a TO for help.`);
		}
	}
};

export default command;
