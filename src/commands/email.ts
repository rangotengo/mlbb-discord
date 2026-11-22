import { isVerificationThread } from "../util/verificationThread";
import { EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { sendEmail } from "../role/helper/email";
import { getLogger } from "../util/logger";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { isTournamentOrganizer, TO_COMMAND_BLOCKED, NO_TOURNAMENTS_FOUND } from "../util";
import { selectActionableEnrollments } from "../util/enrolledPlayers";

const logger = getLogger("command:email");

const command: CommandDefinition = {
	name: "email",
	requiredArgs: ["address"],
	executor: async (msg, args) => {
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

		// Strip all whitespace including invisible/unicode chars (e.g. \r, non-breaking space)
		// that mobile Discord clients may inject when users paste emails
		let emailArg = args[0].replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF\r]/g, "").toLowerCase();
		// Accept the <address> form commonly copied from command examples.
		if (emailArg.startsWith("<") && emailArg.endsWith(">")) {
			emailArg = emailArg.slice(1, -1);
		}
		const emailRegex = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
		if (!emailRegex.test(emailArg)) {
			await msg.reply("Invalid email address.");
			return;
		}

		// Find any tournament in this guild
		const tournaments = await ChallongeTournament.find({
			where: { owningDiscordServer: msg.guildId!, checkInChannelId: msg.channel.isThread() ? msg.channel.parentId! : msg.channel.id }
		});

		if (tournaments.length === 0) {
			await msg.reply(NO_TOURNAMENTS_FOUND);
			return;
		}

		const tournamentIds = tournaments.map(t => t.tournamentId);
		const tournamentMap = new Map(tournaments.map(t => [t.tournamentId, t]));

		// Find enrolled players with this email in any tournament of this server (case-insensitive)
		let players = await EnrolledPlayer.createQueryBuilder("player")
			.where("LOWER(player.email) = LOWER(:email)", { email: emailArg })
			.getMany();

		players = players.filter(p => tournamentIds.includes(p.tournamentId));

		const { actionable, closed } = selectActionableEnrollments(players, tournamentMap);
		if (closed) {
			await msg.reply("❌ Check in is already closed. Please contact the Tournament Organizer for assistance.");
			return;
		}

		if (actionable.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("Invalid E-Mail address provided or you have not been enrolled by the TO. Please contact the Admin for further assistance.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		// A finished tournament's attempt count or verified flag must not block a current enrollment.
		const pending = actionable.filter(player => !player.verified);
		if (pending.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("This Email has already been verified.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		const targets = pending.filter(player => player.emailSent < 3);
		if (targets.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle("Verification Failed")
				.setDescription("You have exceeded the maximum number of attempts. Please contact the Admin for further assistance.")
				.setColor(0xff0000);
			await msg.reply({ embeds: [embed] });
			return;
		}

		const otp = Math.floor(100000 + Math.random() * 900000);

		for (const p of targets) {
			p.otp = otp;
			p.emailSent += 1;
			// Link the discord ID early so verify knows who sent this
			p.discordId = msg.author.id;
			p.discordUsername = msg.author.username;
			await p.save();
		}

		try {
			await sendEmail(emailArg, otp);
		} catch (error) {
			logger.error("Failed to send OTP email:", error);
			await msg.reply("Encountered an error sending the OTP email. Please try again later or contact an Admin.");
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle("Verification Under Process")
			.setDescription(`An OTP has been sent to your email. Enter the OTP using the command \`!verify\` or resend OTP using \`!email\``)
			.addFields([
				{ name: "To submit OTP", value: "```!verify 123456```", inline: false },
				{ name: "To resend OTP", value: "```!email example@abc.com```", inline: false }
			])
			.setColor(0xbf40bf);

		await msg.reply({ embeds: [embed] });
	}
};

export default command;
