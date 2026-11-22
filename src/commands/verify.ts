import { isVerificationThread } from "../util/verificationThread";
import { EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger } from "../util/logger";
import { isTournamentOrganizer, assignParticipantRole, TO_COMMAND_BLOCKED, NO_TOURNAMENTS_FOUND, addUserToMatchThreads } from "../util";
import { selectActionableEnrollments } from "../util/enrolledPlayers";

const logger = getLogger("command:verify");

const command: CommandDefinition = {
	name: "verify",
	requiredArgs: ["otp"],
	executor: async (msg, args, support) => {
		if (isTournamentOrganizer(msg.member)) {
			await msg.reply(TO_COMMAND_BLOCKED);
			return;
		}

		// Restrict to private verification threads only
		const isTicketChannel = await isVerificationThread(msg.channel);

		if (!isTicketChannel) {
			await msg.reply("This command can only be used in private verification threads. Please use `!check-in` to open a private thread.");
			return;
		}

		const otp = parseInt(args[0], 10);
		if (isNaN(otp)) {
			await msg.reply("Please provide a valid numeric OTP.");
			return;
		}

		// Find tournaments in this guild
		const tournaments = await ChallongeTournament.find({
			where: { owningDiscordServer: msg.guildId!, checkInChannelId: msg.channel.isThread() ? msg.channel.parentId! : msg.channel.id }
		});

		if (tournaments.length === 0) {
			await msg.reply(NO_TOURNAMENTS_FOUND);
			return;
		}

		const tournamentIds = tournaments.map(t => t.tournamentId);
		const tournamentMap = new Map(tournaments.map(t => [t.tournamentId, t]));

		// Find unverified enrolled players
		const players = await EnrolledPlayer.find({
			where: { discordId: msg.author.id, verified: false },
			relations: ["tournament"]
		});

		const guildPlayers = players.filter(p => tournamentIds.includes(p.tournamentId));
		const { actionable, closed } = selectActionableEnrollments(guildPlayers, tournamentMap);
		if (closed) {
			await msg.reply("❌ Check in is already closed. Please contact the Tournament Organizer for assistance.");
			return;
		}

		if (actionable.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("No pending verification found for you. Please use `!email <your_email>` first.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		// !email sets the same OTP on each current enrollment for this player.
		const matchingPlayer = actionable.find(p => p.otp === otp);

		if (!matchingPlayer) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("Invalid OTP provided. Please try again.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		// Verification passed! Process all linked tournaments
		const successfulTournaments: string[] = [];

		// Process all matching players in parallel for better performance
		const matchingPlayers = actionable.filter(p => p.otp === otp);

		// Fetch member once for all operations
		const member = msg.member || await msg.guild?.members.fetch(msg.author.id).catch(() => null);

		const verificationPromises = matchingPlayers.map(async (player) => {
			try {
				// Assign participant role first - if this fails, don't mark as verified
				let roleAssigned = true;
				if (member && player.tournament) {
					roleAssigned = await assignParticipantRole(member, player.tournament, logger, support.participantRole);
					if (!roleAssigned) {
						logger.warn(`Failed to assign participant role to ${msg.author.tag} during verify command`);
						return {
							success: false,
							tournamentId: player.tournamentId,
							error: "Role assignment failed"
						};
					}
				}

				// Mark player as verified in the database and clear OTP only after successful role assignment
				player.verified = true;
				player.otp = undefined;
				await player.save();

				// Add user to existing match threads if verification happened after thread creation
				if (msg.guild) {
					await addUserToMatchThreads(msg.guild, player, support.challonge);
				}

				return {
					success: true,
					tournamentId: player.tournamentId
				};
			} catch (err) {
				logger.error(`Failed to verify player ${player.name} for ${player.tournamentId}:`, err);
				return {
					success: false,
					tournamentId: player.tournamentId,
					error: String(err)
				};
			}
		});

		const results = await Promise.all(verificationPromises);

		for (const result of results) {
			if (result.success) {
				successfulTournaments.push(result.tournamentId);
			}
		}

		if (successfulTournaments.length > 0) {
			let desc = "You have been successfully verified and added to the tournament roster!";

			// Auto-close the verification thread if verification happened inside one
			const isTicketChannel = await isVerificationThread(msg.channel);

			if (isTicketChannel) {
				desc += "\n\n🎟️ This ticket will be automatically closed in **5 seconds**. Welcome!";
			}

			const embed = new EmbedBuilder()
				.setTitle("Verification Successful")
				.setDescription(desc)
				.setColor(0x00ff00);
			await msg.reply({ embeds: [embed] });

			if (isTicketChannel) {
				setTimeout(async () => {
					try {
						await msg.channel.delete("Ticket auto-closed after successful verification");
					} catch (e) {
						logger.error("Failed to auto-close verification thread after verification:", e);
					}
				}, 5000);
			}
		} else {
			// Check if there were any failures and provide specific error info
			const failedResults = results.filter(r => !r.success);
			const errorMessages = failedResults
				.map(r => (r as { success: false; tournamentId: string; error?: string }).error)
				.filter(Boolean);

			let errorMsg = "An error occurred during verification.";
			if (errorMessages.length > 0) {
				errorMsg += `\n\n**Reason:** ${errorMessages[0]}`;
			}
			errorMsg += "\n\nPlease contact a Tournament Organizer for assistance.";

			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription(errorMsg)
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
		}
	}
};

export default command;
