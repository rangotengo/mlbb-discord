import { isVerificationThread } from "../util/verificationThread";
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
import { isAllowedChannel, isConfiguredCheckInChannel } from "../util/channelScope";

const logger = getLogger("interaction");

// Metadata is available to the dashboard without requiring a Discord connection.
export const slashCommandMetadata = [
	TimerCommand.meta, AddCommand.meta, HostCommand.meta, UpdateCommand.meta, InfoCommand.meta,
	ListCommand.meta, ThreadCommand.meta, InviteCommand.meta, VerifyPlayerCommand.meta, SetParticipantRoleCommand.meta
];

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
		new VerifyPlayerCommand(participantRole, support.challonge),
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
		if ((!isAllowedChannel(interaction.channel) && !await isConfiguredCheckInChannel(interaction.channel))) return;
		if (interaction.isChatInputCommand()) {
			logger.verbose(serialiseInteraction(interaction));
			await commands.get(interaction.commandName)?.run(interaction);
		} else if (interaction.isAutocomplete()) {
			logger.verbose(serialiseInteraction(interaction, { autocomplete: interaction.options.getFocused() }));
			await autocompletes.get(interaction.commandName)?.autocomplete(interaction);
		} else if (interaction.isButton()) {
			const customId = interaction.customId;
			if (customId.startsWith("push_")) {
				// Format: push_{tournamentId}_{matchId}_{winnerId}_{winnerScore}_{loserScore}
				const parts = customId.split("_");
				if (parts.length === 6) {
					const [, tId, matchIdStr, winnerIdStr, wScoreStr, lScoreStr] = parts;
					const matchId = parseInt(matchIdStr, 10);
					const winnerId = parseInt(winnerIdStr, 10);
					const wScore = parseInt(wScoreStr, 10);
					const lScore = parseInt(lScoreStr, 10);

					try {
						await interaction.deferUpdate();
						// Get the tournament to find the actual Challonge ID
						const tournament = await ChallongeTournament.findOne({ where: { tournamentId: tId } });
						if (!tournament) {
							throw new Error(`Tournament ${tId} not found`);
						}
						// We need a partial match object for the API wrapper
						const partialMatch = { matchId } as import("../website/challonge").WebsiteMatch;
						await support.challonge.submitScore(tournament.getChallongeIdForApi(), partialMatch, winnerId, wScore, lScore);
						await interaction.editReply({
							content: `✅ Score pushed to Challonge by <@${interaction.user.id}>!`,
							components: [],
							embeds: interaction.message.embeds
						});
					} catch (e) {
						logger.error("Error manually pushing score:", e);
						await interaction.followUp({ content: "❌Failed to push score to Challonge.", ephemeral: true });
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
				if (channel && await isVerificationThread(channel)) {
					await interaction.reply("Closing verification thread in 5 seconds...");
					setTimeout(async () => {
						try {
							await channel.delete("Ticket closed by user or TO");
						} catch (e) {
							logger.error("Failed to delete verification thread:", e);
						}
					}, 5000);
				}
			}
		}
	};
}
