import { Mutex } from "async-mutex";
import { getCheckInChannelId } from "../util/channelScope";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	Message,
	ThreadAutoArchiveDuration
} from "discord.js";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger } from "../util/logger";
import { isTournamentOrganizer, assignParticipantRole, getParticipantRoleName, TO_COMMAND_BLOCKED, TICKET_CHANNEL_PREFIX } from "../util";
import { addUserToMatchThreads } from "../util/matchThreads";
import { enrollmentMatchesDiscord, expandEnrollmentsByEmail, formatTournamentList, selectActionableEnrollments } from "../util/enrolledPlayers";

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

		// First, find the tournaments for this guild
		const tournaments = await ChallongeTournament.find({
			where: { owningDiscordServer: msg.guild.id }
		});

		const channelTournaments = tournaments.filter(t => !msg.channel.isThread() && getCheckInChannelId(t) === msg.channel.id);
		if (!channelTournaments.length) {
			await msg.reply(`Please check in using your tournament's channel.${tournaments.length ? " " + [...new Set(tournaments.map(t => `<#${getCheckInChannelId(t)}>`))].join(" ") : ""}`);
			return;
		}

		// Block if all tournaments have check-in disabled
		if (channelTournaments.every(t => t.checkInDisabled)) {
			await msg.reply("❌ Check in is already closed. Please contact the Tournament Organizer for assistance.");
			return;
		}

		// Then, find all enrolled players for those tournaments
		const tournamentIds = channelTournaments.map(t => t.tournamentId);

		let enrolledPlayers: EnrolledPlayer[] = [];
		if (tournamentIds.length > 0) {
			for (const tournamentId of tournamentIds) {
				const playersForTournament = await EnrolledPlayer.find({
					where: { tournamentId },
					relations: ["tournament"]
				});
				enrolledPlayers.push(...playersForTournament);
			}
		}

		const matchForms = [msg.author.username.toLowerCase()];
		if (msg.author.globalName) matchForms.push(msg.author.globalName.toLowerCase());
		// Member displayName requires fetching member if not cached, but author is user.
		const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
		if (member && member.displayName) matchForms.push(member.displayName.toLowerCase());

		const directMatches = enrolledPlayers.filter(player => enrollmentMatchesDiscord(player, msg.author.id, matchForms));
		const matchedPlayers = expandEnrollmentsByEmail(directMatches, enrolledPlayers);

		if (matchedPlayers.length) {
			const tournamentMap = new Map(channelTournaments.map(tournament => [tournament.tournamentId, tournament]));
			for (const player of matchedPlayers) {
				if (player.tournament) continue;
				const tournament = tournamentMap.get(player.tournamentId) || await ChallongeTournament.findOne({
					where: { tournamentId: player.tournamentId }
				});
				if (!tournament) {
					logger.error(`Could not find tournament with ID ${player.tournamentId}`);
					continue;
				}
				player.tournament = tournament;
				tournamentMap.set(tournament.tournamentId, tournament);
			}

			const { actionable, closed } = selectActionableEnrollments(matchedPlayers, tournamentMap);
			if (closed || !actionable.length) {
				await msg.reply("❌ Check in is already closed. Please contact the Tournament Organizer for assistance.");
				return;
			}

			const verified: EnrolledPlayer[] = [];
			const restored: string[] = [];
			const already: string[] = [];
			const needsEmail: EnrolledPlayer[] = [];

			for (const player of actionable) {
				if (!player.tournament) continue;
				if (player.verified) {
					const hasRole = member?.roles.cache.some(role => role.name === getParticipantRoleName(player.tournament));
					if (!hasRole && member) {
						const roleAssigned = await assignParticipantRole(member, player.tournament, logger, support.participantRole);
						if (roleAssigned) {
							if (msg.guild) await addUserToMatchThreads(msg.guild, player, support.challonge);
							restored.push(player.tournament.name);
							continue;
						}
					}
					if (msg.guild) await addUserToMatchThreads(msg.guild, player, support.challonge);
					already.push(player.tournament.name);
					continue;
				}

				const alreadyKnown = directMatches.some(other => other.verified && other.email.toLowerCase() === player.email.toLowerCase());
				if (player.otp && !alreadyKnown) {
					needsEmail.push(player);
					continue;
				}

				try {
					player.verified = true;
					player.discordId = msg.author.id;
					player.discordUsername = msg.author.username;
					player.otp = null;
					await player.save();
					if (member) {
						const roleAssigned = await assignParticipantRole(member, player.tournament, logger, support.participantRole);
						if (!roleAssigned) logger.warn(`Failed to assign participant role to ${msg.author.tag} during check command`);
					}
					if (msg.guild) {
						const threadsAdded = await addUserToMatchThreads(msg.guild, player, support.challonge);
						if (threadsAdded > 0) logger.info(`Added ${msg.author.tag} to ${threadsAdded} match thread(s) via check-in`);
					}
					verified.push(player);
				} catch (err) {
					logger.error(`Error auto-verifying ${msg.author.tag} via check command:`, err);
				}
			}

			const lines: string[] = [];
			if (verified.length) {
				lines.push(`You have been successfully verified as **${verified[0].name}** for ${formatTournamentList(verified.map(player => player.tournament.name))}! You've been given the Participant role.`);
			}
			if (restored.length) lines.push(`Welcome back! Your participant role for ${formatTournamentList(restored)} has been restored.`);
			if (already.length) lines.push(`You are already verified for ${formatTournamentList(already)}.`);
			if (lines.length) await msg.reply(lines.join("\n"));
			if (needsEmail.length) await openVerificationThread(msg, lines.length > 0);
			if (!lines.length && !needsEmail.length) {
				await msg.reply("An error occurred during verification. Please try again later or open a verification thread.");
			}
			return;
		}

		await openVerificationThread(msg);
	}
};

export default command;

const threadCreation = new Mutex();

async function openVerificationThread(msg: Message, remaining = false): Promise<void> {
	// Serialize lookup and creation so concurrent check-ins cannot create duplicates.
	await threadCreation.runExclusive(() => createVerificationThread(msg, remaining));
}

async function createVerificationThread(msg: Message, remaining = false): Promise<void> {
	if (!msg.inGuild()) return;
	const parent = msg.channel.isThread() ? msg.channel.parent : msg.channel;
	if (!parent || parent.type !== ChannelType.GuildText) {
		await msg.reply("Use check-in in a text channel under the tournament category.");
		return;
	}

	try {
		// Stable user IDs let repeat check-ins reuse a thread even after a username change.
		const name = `${TICKET_CHANNEL_PREFIX}${msg.author.id}`;
		const active = await msg.guild.channels.fetchActiveThreads();
		const existing = active.threads.find(thread =>
			thread.type === ChannelType.PrivateThread && thread.parentId === parent.id && thread.name === name
		);
		if (existing) {
			await existing.members.add(msg.author.id);
			await msg.reply(remaining
				? `A private thread is open for the tournament that still needs email verification: <#${existing.id}>.`
				: `Your private verification thread is <#${existing.id}>.`);
			return;
		}

		const channel = await parent.threads.create({
			name,
			type: ChannelType.PrivateThread,
			invitable: false,
			autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
			reason: `Check-in verification for ${msg.author.tag}`
		});
		try {
			await channel.members.add(msg.author.id);
		} catch (error) {
			await channel.delete("Could not add player to verification thread").catch(() => undefined);
			throw error;
		}

		const welcomeEmbed = new EmbedBuilder()
			.setTitle("Verification Missing")
			.setDescription(
				remaining
					? `Hi <@${msg.author.id}>, you are checked in for your other tournament, but this one still needs email verification.\n\nPlease use the command \`!email <your_email>\` in this private thread. If you need help, a Tournament Organizer will be with you shortly.`
					: `Hi <@${msg.author.id}>, we couldn't automatically verify you based on your username.\n\nPlease use the command \`!email <your_email>\` in this private thread to verify your identity and get your participant roles. If you need help, a Tournament Organizer will be with you shortly.`
			)
			.setColor("#00b0f4");

		const closeButton = new ButtonBuilder()
			.setCustomId("close_ticket")
			.setLabel("Close Thread")
			.setStyle(ButtonStyle.Danger);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton);

		await channel.send({
			content: `<@${msg.author.id}>`,
			embeds: [welcomeEmbed],
			components: [row]
		});

		await msg.reply(remaining
			? `A private thread is open for the tournament that still needs email verification: <#${channel.id}>`
			: `We couldn't automatically verify you. A private verification thread has been opened for you: <#${channel.id}>`);
	} catch (err) {
		logger.error(`Error creating verification thread for ${msg.author.tag}:`, err);
		await msg.reply(`We couldn't verify you, and there was an issue creating a private thread. Please ask a TO for help.`);
	}
}
