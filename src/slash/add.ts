import { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import {
	ChatInputCommandInteraction,
	PermissionFlagsBits,
	SlashCommandBuilder,
	SlashCommandSubcommandBuilder
} from "discord.js";
import { addTournament } from "../util/tournament";
import { SlashCommand } from "../SlashCommand";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger, Logger } from "../util/logger";

export class AddCommand extends SlashCommand {
	#logger = getLogger("command:add");

	constructor() {
		super();
	}

	static override get meta(): RESTPostAPIApplicationCommandsJSONBody {
		return new SlashCommandBuilder()
			.setName("add")
			.setDescription("Add a tournament to the bot.")
			.setDMPermission(false)
			.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
			.addSubcommand(
				new SlashCommandSubcommandBuilder()
					.setName("tournament")
					.setDescription("Add a Challengermode tournament to the bot.")
					.addStringOption(option =>
						option.setName("url").setDescription("The Challengermode tournament URL (e.g., https://www.challengermode.com/tournaments/<uuid>)").setRequired(true)
					)
					.addStringOption(option =>
						option.setName("name").setDescription("The custom tournament ID for the bot (e.g., mlbb_spring_2024)").setRequired(true)
					)
					.addRoleOption(option =>
						option
							.setName("participantrole")
							.setDescription("The role to assign to verified participants (defaults to \"Participant\")")
							.setRequired(false)
					)
			)
			.toJSON();
	}

	protected override get logger(): Logger {
		return this.#logger;
	}

	protected override async execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
		const subcommand = interaction.options.getSubcommand(true);

		if (subcommand !== "tournament") {
			await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
			return;
		}

		const challongeUrl = interaction.options.getString("url", true);
		const customName = interaction.options.getString("name", true);
		const participantRole = interaction.options.getRole("participantrole");

		await interaction.deferReply();

		// Use shared service to add tournament
		const result = await addTournament(challongeUrl, customName, interaction.guildId!, interaction.user.id);

		if (!result.success) {
			await interaction.editReply({ content: result.error! });
			return;
		}

		// If a participant role was provided, save it to the tournament
		if (participantRole) {
			const createdTournament = await ChallongeTournament.findOne({ where: { tournamentId: customName } });
			if (createdTournament) {
				createdTournament.participantRoleName = participantRole.name;
				await createdTournament.save();
			}
		}

		const roleNote = participantRole ? `\nParticipant role: **${participantRole.name}**` : "";

		await interaction.editReply({
			content: `Tournament **${result.customName}** has been added!\n\nChallonge URL: ${result.url}\nChallonge ID: ${result.challongeId}\nHost: <@${result.userId}>${roleNote}\n\nUse \`!sync ${result.customName}\` to sync with Challengermode and fetch tournament data.`
		});

		this.logger.verbose(
			`Tournament "${result.customName}" added by ${interaction.user.id} in server ${interaction.guildId} from Challengermode URL ${result.url}`
		);
	}
}
