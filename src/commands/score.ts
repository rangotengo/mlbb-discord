import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, ButtonInteraction } from "discord.js";
import { CommandDefinition } from "../Command";
import { TournamentStatus } from "../database/interface";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { findMatch } from "../util/challonge";
import { UserError } from "../util/errors";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";
import { isTournamentOrganizer, parseScore } from "../util";

const logger = getLogger("command:score");

const command: CommandDefinition = {
	name: "score",
	requiredArgs: ["score"],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		if (!support.tournamentApi.supportsWrites) support.tournamentApi.assertWritesSupported();
		if (isTournamentOrganizer(msg.member)) {
			await msg.reply(`You are a Tournament Organizer. Please use the \`!forcescore\` command instead of \`!score\`.`);
			return;
		}

		let providedId: string | undefined;
		let score: string;

		if (args.length === 2) {
			[providedId, score] = args;
		} else {
			score = args[0];
		}

		const id = await resolveTournamentId(providedId, msg.guildId);
		const scores = parseScore(score);
		function log(event: string, extra?: Record<string, unknown>): void {
			logger.verbose(
				JSON.stringify({
					channel: msg.channelId,
					message: msg.id,
					user: msg.author.id,
					tournament: id,
					command: "score",
					scores,
					event,
					...extra
				})
			);
		}

		const enrolledPlayer = await EnrolledPlayer.findOne({ 
			where: { discordId: msg.author.id, tournamentId: id },
			relations: ["tournament"]
		});

		if (!enrolledPlayer || !enrolledPlayer.verified) {
			throw new UserError("You must be enrolled and verified to report scores.");
		}

		if (enrolledPlayer.tournament.status !== TournamentStatus.IPR) {
			throw new UserError(`Tournament **${enrolledPlayer.tournament.name}** is not currently in progress.`);
		}

		const teamName = enrolledPlayer.team;
		if (!teamName) {
			throw new UserError("You do not have an assigned team. Please contact a Tournament Organizer.");
		}

		const challongePlayers = await support.tournamentApi.getPlayers(enrolledPlayer.tournament.getChallongeIdForApi());
		const ourTeamOnChallonge = challongePlayers.find(p => p.name.toLowerCase() === teamName.toLowerCase());

		if (!ourTeamOnChallonge) {
			throw new UserError(`Could not find team **${teamName}** on the Challengermode bracket. Please ensure your team name matches exactly.`);
		}

		const match = await findMatch(enrolledPlayer.tournament.getChallongeIdForApi(), ourTeamOnChallonge.challongeId, support.tournamentApi);
		
		if (!match) {
			log("no match", { team: teamName, challongeId: ourTeamOnChallonge.challongeId });
			await msg.reply(`Could not find an open match for **${teamName}** in **${enrolledPlayer.tournament.name}**.`);
			return;
		}

		// Calculate scores for submission formatting
		const weWon = scores[0] > scores[1];
		// Match is from findMatch, so player1/player2 are guaranteed non-null (open match)
		const winner = weWon ? ourTeamOnChallonge.challongeId : (match.player1 === ourTeamOnChallonge.challongeId ? match.player2! : match.player1!);
		const winnerScore = weWon ? scores[0] : scores[1];
		const loserScore = weWon ? scores[1] : scores[0];

		// Get opponent info for pinging
		const opponentChallongeId = winner === ourTeamOnChallonge.challongeId ? (match.player1 === ourTeamOnChallonge.challongeId ? match.player2! : match.player1!) : winner;
		const opponentWebPlayer = challongePlayers.find(p => p.challongeId === opponentChallongeId);

		let opponentMentions = opponentWebPlayer?.name ? opponentWebPlayer.name : "Opponent";
		let opponentDiscordIds: string[] = [];

		if (opponentWebPlayer) {
			const oppEnrolled = await EnrolledPlayer.find({ where: [{ tournamentId: id, team: opponentWebPlayer.name }, { tournamentId: id, name: opponentWebPlayer.name }] });
			opponentDiscordIds = oppEnrolled.map(p => p.discordId).filter(Boolean) as string[];
			if (opponentDiscordIds.length > 0) {
				opponentMentions = opponentDiscordIds.map(id => `<@${id}>`).join(" ");
			}
		}

		const embed = new EmbedBuilder()
			.setTitle("Score Report")
			.setDescription(`<@${msg.author.id}> has reported the score as **${scores[0]} - ${scores[1]}**.\n\n${opponentMentions}, do you approve this score?`)
			.setFooter({ text: "If you do not respond within 10 minutes, the score will be automatically approved." })
			.setColor("#e67e22");

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("approve_score")
				.setLabel("Approve")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId("reject_score")
				.setLabel("Reject")
				.setStyle(ButtonStyle.Danger)
		);

		const prompt = await msg.reply({ content: `${opponentMentions}`, embeds: [embed], components: [row] });

		const collector = prompt.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 600000 // 10 minutes
		});

		let resolved = false;

		const processApproval = async (auto: boolean, approverId?: string): Promise<void> => {
			if (resolved) return;
			resolved = true;
			collector.stop();

			await prompt.edit({
				embeds: [EmbedBuilder.from(embed).setDescription(`Score **${scores[0]} - ${scores[1]}** was ${auto ? "automatically approved (timeout)" : `approved by <@${approverId}>`}.`).setColor("#2ecc71")],
				components: []
			});

			const tDB = await ChallongeTournament.findOne({ where: { tournamentId: id } });
			const autoPush = tDB?.autoPushScores ?? true;

			if (autoPush) {
				try {
					await support.tournamentApi.submitScore(tDB!.challongeTournamentId, match, winner, winnerScore, loserScore);
					await prompt.reply("✅ Score has been automatically pushed to the bracket!");
				} catch (err) {
					logger.error("Error submitting score automatically:", err);
					await prompt.reply("❌ Error submitting score to Challengermode. Please ask a TO to do it manually.");
				}
			} else {
				await prompt.reply("✅ Score approved! It has been sent to the Tournament Organizers for final review before appearing on the bracket.");

				if (tDB?.scoreReviewChannelId) {
					const reviewChannel = await msg.guild?.channels.fetch(tDB.scoreReviewChannelId).catch(() => null);
					if (reviewChannel && reviewChannel.isTextBased()) {
						const reviewEmbed = new EmbedBuilder()
							.setTitle(`Pending Score: Match ${match.matchId}`)
							.setDescription(`**Reporter:** <@${msg.author.id}>\n**Score:** ${scores[0]} - ${scores[1]}\n**Match URL:** [Jump to Thread](${prompt.url})`)
							.setFooter({ text: `Tournament ID: ${id} | Winner ID: ${winner} | Scores: ${winnerScore}-${loserScore}` })
							.setColor("#f1c40f");

						const reviewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder().setCustomId(`push_${id}_${match.matchId}_${winner}_${winnerScore}_${loserScore}`).setLabel("Approve & Push").setStyle(ButtonStyle.Success),
							new ButtonBuilder().setCustomId(`reject_push_${match.matchId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
						);
						
						await reviewChannel.send({ embeds: [reviewEmbed], components: [reviewRow] });
					}
				}
			}
		};

		collector.on("collect", async (interaction: ButtonInteraction) => {
			// Only allow the opponent(s) to click, or any TO
			const isTO = interaction.memberPermissions?.has("Administrator");
			const isOpponent = opponentDiscordIds.includes(interaction.user.id);

			if (!isTO && !isOpponent) {
				await interaction.reply({ content: "You are not authorized to respond to this score report.", ephemeral: true });
				return;
			}

			if (interaction.customId === "reject_score") {
				if (resolved) return;
				resolved = true;
				collector.stop();
				await interaction.update({
					embeds: [EmbedBuilder.from(embed).setDescription(`Score **${scores[0]} - ${scores[1]}** was REJECTED by <@${interaction.user.id}>.\n\nPlease discuss the correct score and report again.`).setColor("#e74c3c")],
					components: []
				});
			} else if (interaction.customId === "approve_score") {
				await interaction.deferUpdate();
				await processApproval(false, interaction.user.id);
			}
		});

		collector.on("end", async () => {
			if (!resolved) {
				await processApproval(true);
			}
		});
	}
};

export default command;
