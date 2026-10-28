import { EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { sendOtpEmail, isEmailConfigured } from "../role/helper/email";
import { getLogger } from "../util/logger";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { isTournamentOrganizer, TO_COMMAND_BLOCKED, NO_TOURNAMENTS_FOUND, TICKET_CHANNEL_PREFIX } from "../util";
import { issueChallenge, recordDeliveryAttempt } from "../role/helper/verification";
import { otpPolicyFromEnv } from "../util/otp";

const logger = getLogger("command:email");

const command: CommandDefinition = {
	name: "email",
	requiredArgs: ["address"],
	executor: async (msg, args) => {
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

		// Strip all whitespace including invisible/unicode chars (e.g. \r, non-breaking space)
		// that mobile Discord clients may inject when users paste emails
		const emailArg = args[0].replace(/[\s\u200B-\u200D]/g, "").toLowerCase();
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(emailArg)) {
			await msg.reply("Invalid email address.");
			return;
		}

		if (!isEmailConfigured()) {
			await msg.reply({
				embeds: [new EmbedBuilder()
					.setTitle("Verification Unavailable")
					.setDescription("Email verification is not configured on this server. Please ask a Tournament Organizer to verify you manually.")
					.setColor(0xff0000)]
			});
			return;
		}

		// Find any tournament in this guild
		const tournaments = await ChallongeTournament.find({
			where: { owningDiscordServer: msg.guildId! }
		});

		if (tournaments.length === 0) {
			await msg.reply(NO_TOURNAMENTS_FOUND);
			return;
		}

		const tournamentMap = new Map(tournaments.map(t => [t.tournamentId, t]));

		// Find enrolled players with this email in any tournament of this server (case-insensitive)
		const players = (await EnrolledPlayer.createQueryBuilder("player")
			.where("LOWER(player.email) = LOWER(:email)", { email: emailArg })
			.getMany()).filter(p => tournamentMap.has(p.tournamentId));

		if (players.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("Invalid E-Mail address provided or you have not been enrolled by the TO. Please contact the Admin for further assistance.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		// Only tournaments whose check-in is open are eligible (guide 4): the
		// operation proceeds when at least one relevant tournament is open,
		// and closed ones are never touched.
		const eligible = players.filter(p => !p.identityVerified && tournamentMap.get(p.tournamentId)!.checkInDisabled !== true);
		const closed = players.filter(p => tournamentMap.get(p.tournamentId)!.checkInDisabled === true);

		if (eligible.length === 0) {
			const closedNames = closed.map(p => `**${tournamentMap.get(p.tournamentId)!.name}**`).join(", ");
			await msg.reply(`❌ Check-in is closed for ${closedNames}. Please contact the Tournament Organizer for assistance.`);
			return;
		}

		if (eligible.every(p => p.identityVerified)) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("This Email has already been verified.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		const policy = otpPolicyFromEnv();

		// Issue the challenge first; a provider failure afterwards does not
		// permanently exhaust the participant's allowance (guide 2.3).
		const issued = await issueChallenge({
			discordId: msg.author.id,
			guildId: msg.guildId!,
			email: emailArg
		});

		if (!issued.ok) {
			if (issued.error === "no-eligible") {
				await msg.reply("No tournament is currently open for check-in.");
				return;
			}
			if (issued.error === "max-sends") {
				const embed = new EmbedBuilder()
					.setTitle("Verification Failed")
					.setDescription(`You have reached the limit of ${policy.maxSends} code requests. Please contact a Tournament Organizer for assistance.`)
					.setColor(0xff0000);
				await msg.reply({ embeds: [embed] });
				return;
			}
			const seconds = Math.max(1, Math.ceil((issued.retryAt.getTime() - Date.now()) / 1000));
			await msg.reply(`Please wait ${seconds}s before requesting a new code.`);
			return;
		}

		const delivery = await sendOtpEmail(emailArg, issued.code);
		await recordDeliveryAttempt({
			discordId: msg.author.id,
			guildId: msg.guildId!,
			email: emailArg,
			accepted: delivery.accepted
		});

		if (!delivery.accepted) {
			logger.error(`OTP delivery failed (${delivery.reason}): ${delivery.detail}`);
			const embed = new EmbedBuilder()
				.setTitle("Verification Code Not Sent")
				.setDescription(
					`Your code could **not** be sent: ${delivery.detail}.\n\nNo code has been delivered, so please do not wait for an email. You can try again shortly, or ask a Tournament Organizer to verify you manually.`
				)
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		const expiryMinutes = Math.max(1, Math.round(policy.expiryMs / 60000));
		const closedNotice = closed.length > 0
			? `\n\nCheck-in is closed for ${closed.map(p => `**${tournamentMap.get(p.tournamentId)!.name}**`).join(", ")}, so that tournament will not be verified.`
			: "";

		const embed = new EmbedBuilder()
			.setTitle("Verification Under Process")
			.setDescription(
				`The email provider accepted your code. Enter the OTP using the command \`!verify\` or resend OTP using \`!email\`. The code expires in ${expiryMinutes} minute${expiryMinutes === 1 ? "" : "s"}; a new request invalidates the previous one.${closedNotice}`
			)
			.addFields([
				{ name: "To submit OTP", value: "```!verify 123456```", inline: false },
				{ name: "To resend OTP", value: "```!email example@abc.com```", inline: false }
			])
			.setColor(0xbf40bf);

		await msg.reply({ embeds: [embed] });
	}
};

export default command;
