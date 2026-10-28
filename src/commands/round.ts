import { resolveTeamMembers } from "../util/teams";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, EmbedBuilder, ThreadAutoArchiveDuration, TextChannel } from "discord.js";
import { CommandDefinition } from "../Command";
import { TournamentStatus } from "../database/interface";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../database/orm/MatchSchedule";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { WebsitePlayer } from "../website/challengermode";
import { resolveTournamentId } from "../util/tournament";
import { In } from "typeorm";

const logger = getLogger("command:round");

const command: CommandDefinition = {
	name: "round",
	requiredArgs: [],
	optionalArgs: ["id", "channel", "round"],
	executor: async (msg, args, support) => {
		// Handle Discord autocomplete weirdness - if we got 1 arg with a space, split it
		if (args.length === 1 && args[0].includes(" ")) {
			args = args[0].split(/\s+/);
		}

		// Validate argument count
		if (args.length < 2) {
			await msg.reply(`Usage: \`!round <id> #channel <round>\` or \`!round #channel <round>\``);
			return;
		}
		// Handle flexible argument order where id is optional:
		// - 2 args: [#channel, roundNumber] or [id, roundNumber]
		// - 3 args: [id, #channel, roundNumber]
		let providedId: string | undefined;
		let channelIdString: string;
		let roundNumberString: string;

		if (args.length === 3) {
			[providedId, channelIdString, roundNumberString] = args;
		} else if (args[0].startsWith("<#") || args[0].startsWith("#")) {
			// First arg is a channel mention, so no id provided
			[channelIdString, roundNumberString] = args;
		} else {
			// First arg is an id, second is channel - missing round number
			await msg.reply("⚠️ **Missing Round Number**\n\nUsage: `!round <id> #channel <round>` or `!round #channel <round>`");
			return;
		}

		const id = await resolveTournamentId(providedId, msg.guildId);
		const roundNumber = parseInt(roundNumberString, 10);
		
		if (isNaN(roundNumber)) {
			await msg.reply("Please provide a valid numeric round number.");
			return;
		}

		const channelId = channelIdString.replace(/<#|>/g, ""); // strip <#> if they mention it

		const tournament = await support.database.authenticateHost(
			id,
			msg.author.id,
			msg.guildId,
			TournamentStatus.IPR,
			isTournamentHost(msg.member, id)
		);

		const targetChannel = await msg.guild?.channels.fetch(channelId).catch(() => null);
		if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
			await msg.reply(`Could not find a valid Text Channel using the ID \`${channelId}\` in this server.`);
			return;
		}

		await msg.reply("Fetching matches from Challengermode... This may take a moment.");

		// Use the actual Challengermode tournament ID to query Challengermode API
		const challongeId = tournament.challongeTournamentId;
		logger.verbose(`Querying Challengermode with ID: "${challongeId}" (bot internal ID: "${id}")`);

		const allMatches = await support.tournamentApi.getMatches(challongeId, false);
		const roundMatches = allMatches.filter(m => m.round === roundNumber && m.open);

		if (roundMatches.length === 0) {
			await msg.reply(`No open matches found on Challengermode for Round \`${roundNumber}\`.`);
			return;
		}

		const players = await support.tournamentApi.getPlayers(challongeId);

		const matchDescriptions = roundMatches.map(m => {
			const p1 = players.find(p => p.challongeId === m.player1)?.name || "Unknown";
			const p2 = players.find(p => p.challongeId === m.player2)?.name || "Unknown";
			return `Match ${m.matchId}: **${p1}** vs **${p2}**`;
		});

		// Check for enrolled players
		const enrolledPlayers = await EnrolledPlayer.find({
			where: { tournamentId: id, verified: true }
		});

		if (enrolledPlayers.length === 0) {
			await msg.reply("⚠️ **No Players Enrolled**\n\nNo Discord users have enrolled yet. Players must enroll first using `!enroll` so they can be pinged in match threads.");
			return;
		}


		// Check for scheduled times
		const matchIds = roundMatches.map(m => m.matchId);
		const schedules = await MatchSchedule.find({
			where: { tournamentId: id, matchId: In(matchIds) }
		});

		if (schedules.length === 0) {
			await msg.reply("⚠️ **No Schedule Imported**\n\nNo match schedules found. Please import the schedule first using `!schedule` command with a CSV file containing match times.");
			return;
		}

		// Build schedule lookup map to avoid N+1 queries
		const scheduleMap = new Map(schedules.map(s => [s.matchId, s]));

		// Validate that all matches have a scheduled time configured
		const missingSchedules: string[] = [];
		for (const m of roundMatches) {
			const schedule = scheduleMap.get(m.matchId);
			if (!schedule || !schedule.scheduledTime || schedule.scheduledTime.getFullYear() > 2090) {
				const p1 = players.find(p => p.challongeId === m.player1)?.name || "Unknown";
				const p2 = players.find(p => p.challongeId === m.player2)?.name || "Unknown";
				missingSchedules.push(`- Match ${m.matchId}: **${p1}** vs **${p2}**`);
			}
		}

		if (missingSchedules.length > 0) {
			const missingText = missingSchedules.join("\n");
			await msg.reply(`⚠️ **Schedules Not Set**\n\nThe following matches in Round ${roundNumber} do not have a scheduled time. Please update them in the web dashboard first:\n\n${missingText}`);
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle(`Ready to start Round ${roundNumber}`)
			.setDescription(`Found **${roundMatches.length}** matches for this round:\n\n${matchDescriptions.join("\n")}`)
			.setFooter({ text: "Threads will be created inside the selected channel and players will be pinged." })
			.setColor("#3498db");

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("confirm_round")
				.setLabel("Confirm & Start")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId("cancel_round")
				.setLabel("Cancel")
				.setStyle(ButtonStyle.Secondary)
		);

		const promptMessage = await msg.reply({ embeds: [embed], components: [row] });

		const collector = promptMessage.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60000 * 5, // 5 minutes to confirm
			filter: i => i.user.id === msg.author.id
		});

		collector.on("collect", async interaction => {
			if (interaction.customId === "cancel_round") {
				await interaction.update({ content: "Round startup cancelled.", embeds: [], components: [] });
				collector.stop();
				return;
			}

			if (interaction.customId === "confirm_round") {
				await interaction.update({ content: "Starting round... creating threads and pinging players.", embeds: [], components: [] });

				const toRoleId = await support.organiserRole.get(msg.guild!);
				const hostRoleId = await support.hostRole.get({ id, server: msg.guildId! });
				let createdCount = 0;
				for (const m of roundMatches) {
					const p1Challonge = players.find((p: WebsitePlayer) => p.challongeId === m.player1);
					const p2Challonge = players.find((p: WebsitePlayer) => p.challongeId === m.player2);

					if (!p1Challonge || !p2Challonge) continue;

					const threadName = `${p1Challonge.name} vs ${p2Challonge.name}`;
					try {
						const thread = await (targetChannel as TextChannel).threads.create({
							name: threadName,
							type: ChannelType.PrivateThread,
							autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
							reason: `Round ${roundNumber} match generated by !round`
						});

						const team1Players = resolveTeamMembers(enrolledPlayers, p1Challonge);
						const team2Players = resolveTeamMembers(enrolledPlayers, p2Challonge);

						const getMentions = (playersArray: EnrolledPlayer[]): string => {
							const mentions = playersArray.map(p => p.discordId ? `<@${p.discordId}>` : null).filter(Boolean);
							return mentions.length > 0 ? mentions.join(" ") : "(No linked Discord users found)";
						};

						const p1Mentions = getMentions(team1Players);
						const p2Mentions = getMentions(team2Players);

						// Look up scheduled time for this match using pre-loaded map
						let scheduledTimeText = "";
						const schedule = scheduleMap.get(m.matchId);
						if (schedule?.scheduledTime) {
							if (schedule.scheduledTime.getFullYear() > 2090) {
								scheduledTimeText = `\n\n⏰ **Scheduled Time:** Not set`;
							} else {
								const unixTimestamp = Math.floor(schedule.scheduledTime.getTime() / 1000);
								scheduledTimeText = `\n\n⏰ **Scheduled Time:** <t:${unixTimestamp}:F>`;
							}
						}

						await thread.send(`🏆 **Round ${roundNumber} Match** 🏆\n\n**${p1Challonge.name}** ${p1Mentions}\n**VS**\n**${p2Challonge.name}** ${p2Mentions}${scheduledTimeText}\n<@&${toRoleId}> <@&${hostRoleId}>\nGood luck!`);

						// Save thread ID to MatchSchedule for later reference
						if (schedule) {
							schedule.threadId = thread.id;
							await schedule.save();
						}

						createdCount++;

					} catch (e) {
						logger.error(`Error creating thread for match ${m.matchId}:`, e);
					}
				}

				// Set this round as the active round for the tournament
				const tournamentEntity = await ChallongeTournament.findOne({
					where: { tournamentId: id }
				});
				if (tournamentEntity) {
					tournamentEntity.activeRound = roundNumber;
					await tournamentEntity.save();
					logger.info(`Set active round to ${roundNumber} for tournament ${id}`);
				}

				await promptMessage.edit(`Successfully created **${createdCount}** match threads in <#${channelId}> for Round ${roundNumber}!`);
				collector.stop();
			}
		});

		collector.on("end", collected => {
			if (collected.size === 0) {
				promptMessage.edit({ content: "Round startup prompt timed out.", components: [] }).catch(() => null);
			}
		});
	}
};

export default command;
