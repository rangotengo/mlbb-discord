import { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { SlashCommand } from "../SlashCommand";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ParticipantRoleProvider } from "../role/participant";
import { assignParticipantRole, addUserToMatchThreads } from "../util";
import { getLogger, Logger } from "../util/logger";
import { WebsiteWrapperChallengermode } from "../website/challengermode";

export class VerifyPlayerCommand extends SlashCommand<"cached"> {
	#logger = getLogger("slash:verifyPlayer");
	#participantRoleProvider: ParticipantRoleProvider;
	#challonge: WebsiteWrapperChallengermode;

	constructor(participantRoleProvider: ParticipantRoleProvider, challonge: WebsiteWrapperChallengermode) {
		super();
		this.#participantRoleProvider = participantRoleProvider;
		this.#challonge = challonge;
	}

	protected override get logger(): Logger {
		return this.#logger;
	}

	static override get meta(): RESTPostAPIApplicationCommandsJSONBody {
		return new SlashCommandBuilder()
			.setName("verify-player")
			.setDescription("Manually verify a player and assign their roles (TO only)")
			.setDMPermission(false)
			.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
			.addUserOption(option =>
				option
					.setName("user")
					.setDescription("The Discord user to verify")
					.setRequired(true)
			)
			.addStringOption(option =>
				option
					.setName("email")
					.setDescription("The email address from the enrollment CSV")
					.setRequired(true)
			)
			.addStringOption(option =>
				option
					.setName("tournament")
					.setDescription("Tournament ID (optional if server has only one)")
					.setRequired(false)
			)
			.toJSON();
	}

	protected override async execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
		await interaction.deferReply();

		const user = interaction.options.getUser("user", true);
		const email = interaction.options.getString("email", true);
		const tournamentIdArg = interaction.options.getString("tournament");

		// Resolve tournament
		let tournament: ChallongeTournament | null;
		if (tournamentIdArg) {
			tournament = await ChallongeTournament.findOne({ where: { tournamentId: tournamentIdArg } });
			if (!tournament) {
				await interaction.editReply(`❌ Tournament with ID "${tournamentIdArg}" not found.`);
				return;
			}
		} else {
			tournament = await ChallongeTournament.findOne({ where: { owningDiscordServer: interaction.guildId } });
			if (!tournament) {
				await interaction.editReply("❌ No tournament found for this server.");
				return;
			}
		}

		// Find enrolled player by email
		const enrolledPlayer = await EnrolledPlayer.findOne({
			where: { tournament: { tournamentId: tournament.tournamentId }, email },
			relations: ["tournament"]
		});

		if (!enrolledPlayer) {
			await interaction.editReply(`❌ No enrolled player found with email "${email}" in tournament "${tournament.name}".`);
			return;
		}

		// Get target member
		const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
		if (!targetMember) {
			await interaction.editReply("❌ User is not in this server.");
			return;
		}

		// Already verified to same user — idempotent
		if (enrolledPlayer.verified && enrolledPlayer.discordId === targetMember.id) {
			await interaction.editReply(`ℹ️ ${targetMember} is already verified as **${enrolledPlayer.name}**. No changes needed.`);
			return;
		}

		// Already verified to a different user — warn
		if (enrolledPlayer.verified && enrolledPlayer.discordId !== targetMember.id) {
			await interaction.editReply(
				`⚠️ Player **${enrolledPlayer.name}** (${email}) is already verified as <@${enrolledPlayer.discordId}>. ` +
				`To reassign, update the enrollment data or contact an admin.`
			);
			return;
		}

		// Update database
		enrolledPlayer.verified = true;
		enrolledPlayer.discordId = targetMember.id;
		enrolledPlayer.discordUsername = targetMember.user.username;
		await enrolledPlayer.save();

		this.#logger.info(
			`Manually verified ${targetMember.user.tag} as ${enrolledPlayer.name} (${email}) for tournament ${tournament.tournamentId}`
		);

		// Assign participant role
		const participantRoleAssigned = await assignParticipantRole(targetMember, enrolledPlayer.tournament, this.#logger, this.#participantRoleProvider);
		if (!participantRoleAssigned) {
			await interaction.editReply(
				`⚠️ Verified **${enrolledPlayer.name}**, but failed to assign participant role. ` +
				`Please create the role or use \`/set-participant-role\`.`
			);
			return;
		}

		// Add user to existing match threads if verification happened after thread creation
		await addUserToMatchThreads(interaction.guild, enrolledPlayer, this.#challonge);

		const successMsg = `✅ Successfully verified ${targetMember} as **${enrolledPlayer.name}** from team **${enrolledPlayer.team || "No team"}**!`;

		await interaction.editReply(successMsg);
	}
}
