import { Interaction } from "discord.js";
import { CommandSupport } from "../Command";
import { AutocompletableCommand, SlashCommand } from "../SlashCommand";
import { AddCommand } from "../slash/add";
import { HostCommand } from "../slash/host";
import { InfoCommand } from "../slash/info";
import { InviteCommand } from "../slash/invite";
import { ListCommand } from "../slash/list";
import { ThreadCommand } from "../slash/thread";
import { TimerCommand } from "../slash/timer";
import { UpdateCommand } from "../slash/update";
import { VerifyPlayerCommand } from "../slash/verifyPlayer";
import { SetParticipantRoleCommand } from "../slash/setParticipantRole";
import { ChallongeTournament } from "../database/orm";
import { serialiseInteraction } from "../util";
import { getLogger } from "../util/logger";

const logger = getLogger("interaction");

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function makeHandler(support: CommandSupport) {
	const { organiserRole, participantRole, timeWizard } = support;
	const commandArray = [
		// Construct SlashCommand objects here
		new TimerCommand(organiserRole, timeWizard),
		new AddCommand(),
		new HostCommand(),
		new UpdateCommand(),
		new InfoCommand(),
		new ListCommand(organiserRole),
		new ThreadCommand(),
		new InviteCommand(),
		new VerifyPlayerCommand(participantRole, support.tournamentApi),
		new SetParticipantRoleCommand()
	];

	const commands = new Map<string, SlashCommand>();
	const autocompletes = new Map<string, AutocompletableCommand>();

	for (const command of commandArray) {
		commands.set(command.meta.name, command);
		if (command instanceof AutocompletableCommand) {
			autocompletes.set(command.meta.name, command);
		}
	}

	return async function interactionCreate(interaction: Interaction): Promise<void> {
		if (!interaction.inCachedGuild()) {
			return;
		}
		if (interaction.isChatInputCommand()) {
			logger.verbose(serialiseInteraction(interaction));
			await commands.get(interaction.commandName)?.run(interaction);
		} else if (interaction.isAutocomplete()) {
			logger.verbose(serialiseInteraction(interaction, { autocomplete: interaction.options.getFocused() }));
			await autocompletes.get(interaction.commandName)?.autocomplete(interaction);
		} else if (interaction.isButton()) {
			const customId = interaction.customId;
			if (customId.startsWith("push_") && !support.tournamentApi.supportsWrites) {
				await interaction.reply({ content: "Submit scores on Challengermode, then use !sync to refresh the bot.", ephemeral: true });
				return;
			}
			if (customId.startsWith("push_")) {
				// Format: push_{tournamentId}_{matchId}_{winnerId}_{winnerScore}_{loserScore}
				const parts = customId.split("_");
				if (parts.length === 6) {
					const [, tId, matchIdStr, winnerIdStr, wScoreStr, lScoreStr] = parts;
					const matchId = matchIdStr;
					const winnerId = winnerIdStr;
					const wScore = parseInt(wScoreStr, 10);
					const lScore = parseInt(lScoreStr, 10);

					try {
						await interaction.deferUpdate();
						// Get the tournament to find the actual Challengermode ID
						const tournament = await ChallongeTournament.findOne({ where: { tournamentId: tId } });
						if (!tournament) {
							throw new Error(`Tournament ${tId} not found`);
						}
						// We need a partial match object for the API wrapper
						const partialMatch = { matchId } as import("../website/challengermode").WebsiteMatch;
						await support.tournamentApi.submitScore(tournament.challongeTournamentId, partialMatch, winnerId, wScore, lScore);
						await interaction.editReply({
							content: `✅ Score pushed to Challengermode by <@${interaction.user.id}>!`,
							components: [],
							embeds: interaction.message.embeds
						});
					} catch (e) {
						logger.error("Error manually pushing score:", e);
						await interaction.followUp({ content: "❌Failed to push score to Challengermode.", ephemeral: true });
					}
				}
			} else if (customId.startsWith("reject_push_")) {
				await interaction.update({
					content: `❌ Score push rejected by <@${interaction.user.id}>.`,
					components: [],
					embeds: interaction.message.embeds
				});
			} else if (customId === "close_ticket") {
				const channel = interaction.channel;
				if (channel && channel.isTextBased()) {
					await interaction.reply("Closing ticket in 5 seconds...");
					setTimeout(async () => {
						try {
							await channel.delete("Ticket closed by user or TO");
						} catch (e) {
							logger.error("Failed to delete ticket channel:", e);
						}
					}, 5000);
				}
			}
		}
	};
}
