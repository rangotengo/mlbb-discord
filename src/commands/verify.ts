import { EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger } from "../util/logger";
import { isTournamentOrganizer, assignParticipantRole, TO_COMMAND_BLOCKED, NO_TOURNAMENTS_FOUND, addUserToMatchThreads, TICKET_CHANNEL_PREFIX } from "../util";
import { verifyChallenge, markIdentityVerified, markAccessGranted } from "../role/helper/verification";

const logger = getLogger("command:verify");

const command: CommandDefinition = {
	name: "verify",
	requiredArgs: ["otp"],
	executor: async (msg, args, support) => {
		if (isTournamentOrganizer(msg.member)) {
			await msg.reply(TO_COMMAND_BLOCKED);
			return;
		}

		// Restrict to ticket channels only
		const isTicketChannel =
			msg.channel.isTextBased() &&
			"name" in msg.channel &&
			typeof msg.channel.name === "string" &&
			msg.channel.name.startsWith(TICKET_CHANNEL_PREFIX);

		if (!isTicketChannel) {
			await msg.reply("This command can only be used in ticket channels. Please use `!check-in` to create a ticket.");
			return;
		}

		// Exact six digits; the previous parseInt accepted "123456extra".
		if (!/^\d{6}$/.test(args[0].trim())) {
			await msg.reply("Please provide a valid 6-digit OTP.");
			return;
		}

		// Find tournaments in this guild
		const tournaments = await ChallongeTournament.find({
			where: { owningDiscordServer: msg.guildId! }
		});

		if (tournaments.length === 0) {
			await msg.reply(NO_TOURNAMENTS_FOUND);
			return;
		}

		const tournamentMap = new Map(tournaments.map(t => [t.tournamentId, t]));

		const member = msg.member || await msg.guild?.members.fetch(msg.author.id).catch(() => null);

		// The challenge is bound to the Discord account and guild, so it is
		// verified once, then applied to each eligible enrolment individually.
		const verification = await verifyChallenge({
			discordId: msg.author.id,
			guildId: msg.guildId!,
			code: args[0]
		});

		if (!verification.ok) {
			const messages: Record<typeof verification.error, string> = {
				malformed: "Please provide a valid 6-digit OTP.",
				"not-found": "No active verification code found for you. Please use `!email <your_email>` first; requesting a new code invalidates the previous one.",
				expired: "Your code has expired. Please request a new one with `!email <your_email>`.",
				"attempts-exhausted": "Too many incorrect attempts. Please request a new code with `!email <your_email>`.",
				mismatch: `Invalid OTP provided.${verification.remainingAttempts !== undefined ? ` ${verification.remainingAttempts} attempt${verification.remainingAttempts === 1 ? "" : "s"} remaining.` : ""}`
			};
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription(messages[verification.error])
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		// Only the address proven by this challenge can claim enrolments.
		const pending = (await EnrolledPlayer.createQueryBuilder("player")
			.leftJoinAndSelect("player.tournament", "tournament")
			.where("LOWER(player.email) = :email", { email: verification.email })
			.andWhere("player.identityVerified = :verified", { verified: false })
			.getMany()).filter(player => tournamentMap.has(player.tournamentId));

		if (pending.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("Code accepted, but no pending enrolment was found for you in this server. Please ask a Tournament Organizer for assistance.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		// Per-tournament outcomes (guide 4): closed tournaments are untouched,
		// each eligible record gets its own identity/access result, and the
		// ticket is only closed when nothing needs staff attention.
		const lines: string[] = [];
		let failures = 0;

		for (const player of pending) {
			const tournament = player.tournament ?? tournamentMap.get(player.tournamentId)!;
			if (!tournament) continue;

			if (tournament.checkInDisabled) {
				lines.push(`❌ **${tournament.name}**: check-in is closed; this enrolment was left unchanged. Contact the Tournament Organizer.`);
				failures++;
				continue;
			}

			try {
				// Identity first, unconditionally: a role failure must not
				// force the participant to re-verify (guide 1.3).
				player.discordId = msg.author.id;
				player.discordUsername = msg.author.username;
				await markIdentityVerified(player, "email");
			} catch (err) {
				logger.error(`Failed to record identity verification for ${player.name}:`, err);
				lines.push(`❌ **${tournament.name}**: verification could not be recorded. Please ask a Tournament Organizer for help.`);
				failures++;
				continue;
			}

			const roleAssigned = member
				? await assignParticipantRole(member, tournament, logger, support.participantRole)
				: false;
			if (!roleAssigned) {
				lines.push(`⚠️ **${tournament.name}**: identity verified; access pending. The participant role could not be assigned — ask a Tournament Organizer to fix the role and run \`!check-in\` to retry.`);
				failures++;
				continue;
			}

			await markAccessGranted(player);
			if (msg.guild) await addUserToMatchThreads(msg.guild, player, support.tournamentApi).catch(() => 0);
			lines.push(`✅ **${tournament.name}**: verified as **${player.name}** and granted access.`);
		}

		const success = lines.filter(l => l.startsWith("✅")).length;
		const embed = new EmbedBuilder()
			.setTitle(failures === 0 ? "Verification Successful" : success > 0 ? "Verification Partially Complete" : "Verification Needs Attention")
			.setDescription(lines.join("\n"))
			.setColor(failures === 0 ? 0x00ff00 : success > 0 ? 0xff9900 : 0xff0000);
		await msg.reply({ embeds: [embed] });

		// Only auto-close the ticket when every requested operation succeeded;
		// otherwise the ticket stays open for staff (guide 4.4).
		if (failures === 0) {
			setTimeout(async () => {
				try {
					await msg.channel.delete("Ticket auto-closed after successful verification");
				} catch (e) {
					logger.error("Failed to auto-close ticket channel after verification:", e);
				}
			}, 5000);
		}
	}
};

export default command;
