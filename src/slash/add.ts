import { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import {
	ChatInputCommandInteraction,
	PermissionFlagsBits,
	SlashCommandBuilder,
	SlashCommandSubcommandBuilder
} from "discord.js";
import { addPreCheckinTournament, addTournament, isPreCheckinName } from "../util/tournament";
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
					.setDescription("Add a Challonge tournament to the bot.")
					.addStringOption(option =>
						option
							.setName("url")
							.setDescription("Challonge URL. Leave empty and mention pre-check-in in the name to check in first.")
							.setRequired(false)
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

		const challongeUrl = interaction.options.getString("url");
		const customName = interaction.options.getString("name", true);
		const participantRole = interaction.options.getRole("participantrole");
		const preCheckin = !challongeUrl || isPreCheckinName(customName);

		await interaction.deferReply();

		const result = preCheckin
			? await addPreCheckinTournament(customName, interaction.guildId!, interaction.user.id)
			: await addTournament(challongeUrl!, customName, interaction.guildId!, interaction.user.id);

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
		const content = result.phase === "pre-checkin"
			? `Pre-check-in tournament **${result.customName}** has been added. No Challonge bracket yet.\nHost: <@${result.userId}>${roleNote}\n\nEnroll teams, then \`!precheckin open\`. \`!precheckin close\` creates the bracket from checked-in teams.`
			: `Tournament **${result.customName}** has been added!\n\nChallonge URL: ${result.url}\nChallonge ID: ${result.challongeId}\nHost: <@${result.userId}>${roleNote}\n\nUse \`!sync ${result.customName}\` to sync with Challonge and fetch tournament data.`;

		await interaction.editReply({ content });

		this.logger.verbose(
			`Tournament "${result.customName}" added by ${interaction.user.id} in server ${interaction.guildId} from Challonge URL ${result.url}`
		);
	}
}
