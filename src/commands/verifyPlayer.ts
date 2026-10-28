import { EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { assignParticipantRole, isTournamentOrganizer, parseUserMention, addUserToMatchThreads } from "../util";
import { getLogger } from "../util/logger";

const logger = getLogger("command:verifyPlayer");

const command: CommandDefinition = {
	name: "verify-player",
	requiredArgs: ["@user", "email"],
	optionalArgs: ["tournamentId"],
	executor: async (msg, args, support) => {
		// Permission check
		if (!isTournamentOrganizer(msg.member) && !msg.member?.permissions.has("Administrator")) {
			await msg.reply("❌ Only Tournament Organizers can use this command.");
			return;
		}

		if (!msg.guild) return;

		// Parse arguments
		const userMention = args[0];
		const email = args[1].trim().toLowerCase();
		const tournamentIdArg = args[2];

		// Parse user mention
		const userId = parseUserMention(userMention);
		if (!userId) {
			await msg.reply("❌ First argument must be a user mention (e.g., @user).");
			return;
		}

		// Resolve tournament
		let tournament;
		if (tournamentIdArg) {
			tournament = await ChallongeTournament.findOne({
				where: { tournamentId: tournamentIdArg }
			});
			if (!tournament) {
				await msg.reply(`❌ Tournament with ID "${tournamentIdArg}" not found.`);
				return;
			}
		} else {
			tournament = await ChallongeTournament.findOne({
				where: { owningDiscordServer: msg.guild.id }
			});
			if (!tournament) {
				await msg.reply("❌ No tournament found for this server.");
				return;
			}
		}

		// Find enrolled player by email (case-insensitive)
		const enrolledPlayer = await EnrolledPlayer.createQueryBuilder("player")
			.innerJoinAndSelect("player.tournament", "tournament")
			.where("tournament.tournamentId = :tournamentId", { tournamentId: tournament.tournamentId })
			.andWhere("LOWER(player.email) = LOWER(:email)", { email })
			.getOne();

		if (!enrolledPlayer) {
			await msg.reply(`❌ No enrolled player found with email "${email}" in tournament "${tournament.name}".`);
			return;
		}

		// Refuse to silently replace an existing verified account link (guide 1.4).
		// Reassignment requires an explicit override flag after staff review.
		if (enrolledPlayer.verified && enrolledPlayer.discordId && enrolledPlayer.discordId !== userId) {
			const override = args[3]?.toLowerCase() === "override";
			if (!override) {
				const warnEmbed = new EmbedBuilder()
					.setTitle("⚠️ Already Verified to Another Account")
					.setDescription(
						`Player ${enrolledPlayer.name} (${email}) is already verified as <@${enrolledPlayer.discordId}>.\n\n` +
						`To reassign to <@${userId}>, run the same command with \`override\` as the final argument. ` +
						"The reassignment is recorded in the audit trail."
					)
					.setColor("#FF9900");
				await msg.reply({ embeds: [warnEmbed] });
				return;
			}
			logger.notify(
				`Organiser ${msg.author.id} reassigned enrolment ${enrolledPlayer.id} (${email}) from ${enrolledPlayer.discordId} to ${userId}`
			);
		}

		// Get mentioned user
		const member = await msg.guild.members.fetch(userId).catch(() => null);
		if (!member) {
			await msg.reply("❌ User is not in this server.");
			return;
		}

		// Already verified to same user
		if (enrolledPlayer.verified && enrolledPlayer.discordId === userId) {
			await msg.reply(`ℹ️ ${member} is already verified as ${enrolledPlayer.name}. No changes needed.`);
			return;
		}

		// Record identity as an audited organiser action, then provision access
		// separately so a role failure does not undo the organiser's decision.
		enrolledPlayer.verified = true;
		enrolledPlayer.identityVerified = true;
		enrolledPlayer.identityVerifiedAt = new Date();
		enrolledPlayer.identityVerifiedBy = msg.author.id;
		enrolledPlayer.discordId = member.id;
		enrolledPlayer.discordUsername = member.user.username;
		enrolledPlayer.accessPending = true;
		await enrolledPlayer.save();

		logger.info(`Manually verified ${member.user.tag} as ${enrolledPlayer.name} (${email}) for tournament ${tournament.tournamentId}`);

		// Assign participant role
		const participantRoleAssigned = await assignParticipantRole(member, enrolledPlayer.tournament, logger, support.participantRole);
		if (!participantRoleAssigned) {
			await msg.reply(`⚠️ Identity verified for ${enrolledPlayer.name}, but the participant role could not be assigned. Create the role or use \`!set-participant-role\`, then have the participant run \`!check-in\` to retry without re-verification.`);
			return;
		}

		enrolledPlayer.accessPending = false;
		await enrolledPlayer.save();

		// Add user to existing match threads if verification happened after thread creation
		await addUserToMatchThreads(msg.guild, enrolledPlayer, support.tournamentApi);

		// Build success message
		const successMsg = `✅ Successfully verified ${member} as **${enrolledPlayer.name}** from team **${enrolledPlayer.team || "No team"}**!`;

		await msg.reply(successMsg);
	}
};

export default command;
