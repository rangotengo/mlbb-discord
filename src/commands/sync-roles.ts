import { EmbedBuilder } from "discord.js";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer } from "../database/orm/EnrolledPlayer";
import { ChallongeTournament } from "../database/orm/ChallongeTournament";
import { getLogger } from "../util/logger";
import { isTournamentHost } from "../util/discord";
import { assignParticipantRole, getParticipantRoleName } from "../util";
import { resolveTournamentId } from "../util/tournament";
import { addUserToMatchThreads } from "../util/matchThreads";

const logger = getLogger("command:sync-roles");

const command: CommandDefinition = {
	name: "sync-roles",
	requiredArgs: [],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		// Verify user is a TO
		const [providedId] = args;
		let targetTournamentId: string | null = null;

		// If tournament ID is provided, validate it
		if (providedId) {
			targetTournamentId = await resolveTournamentId(providedId, msg.guildId);
			try {
				const tournament = await support.database.authenticateHost(
					targetTournamentId,
					msg.author.id,
					msg.guildId,
					undefined,
					isTournamentHost(msg.member, targetTournamentId)
				);
				logger.info(`Starting role sync for tournament: ${tournament.name} (${targetTournamentId})`);
			} catch (err) {
				await msg.reply("You are not authorized to sync roles for this tournament.");
				return;
			}
		} else {
			// Check if user is a TO for any tournament
			const tournaments = await ChallongeTournament.find({
				where: { owningDiscordServer: msg.guildId! }
			});

			if (tournaments.length === 0) {
				await msg.reply("No tournaments found in this server.");
				return;
			}

			// Check if user is authorized for at least one tournament
			let isAuthorized = false;
			for (const t of tournaments) {
				try {
					await support.database.authenticateHost(
						t.tournamentId,
						msg.author.id,
						msg.guildId,
						undefined,
						isTournamentHost(msg.member, t.tournamentId)
					);
					isAuthorized = true;
					break;
				} catch {
					// Continue checking other tournaments
				}
			}

			if (!isAuthorized) {
				await msg.reply("You must be a Tournament Organizer to use this command.");
				return;
			}
		}

		// Send initial message
		const initialMsg = await msg.reply(
			targetTournamentId
				? `🔄 Syncing roles for tournament... This may take a moment.`
				: `🔄 Syncing roles for all tournaments... This may take a moment.`
		);

		try {
			// Fetch verified players
			const whereClause: { verified: boolean; tournamentId?: string } = { verified: true };
			if (targetTournamentId) {
				whereClause.tournamentId = targetTournamentId;
			}

			const verifiedPlayers = await EnrolledPlayer.find({
				where: whereClause,
				relations: ["tournament"]
			});

			if (verifiedPlayers.length === 0) {
				await initialMsg.edit("No verified players found in the database.");
				return;
			}

			let totalSuccess = 0;
			let totalFailed = 0;
			let totalThreadsAdded = 0;
			const failures: string[] = [];

			// Group players by guild and tournament
			const playersByGuild = new Map<string, EnrolledPlayer[]>();
			for (const player of verifiedPlayers) {
				// Skip players without a tournament relation
				if (!player.tournament) {
					logger.warn(`Player ${player.name} (${player.discordId}) has no tournament relation, skipping`);
					totalFailed++;
					failures.push(`${player.name} - No tournament relation`);
					continue;
				}

				const guildId = player.tournament.owningDiscordServer;
				if (!playersByGuild.has(guildId)) {
					playersByGuild.set(guildId, []);
				}
				playersByGuild.get(guildId)!.push(player);
			}

			// Process each guild
			for (const [guildId, players] of playersByGuild.entries()) {
				const guild = await msg.client.guilds.fetch(guildId).catch(() => null);
				if (!guild) {
					logger.warn(`Could not fetch guild ${guildId}`);
					totalFailed += players.length;
					failures.push(`Guild ${guildId} - Could not fetch guild`);
					continue;
				}

				// Process players with delay for rate limiting
				for (const player of players) {
					if (!player.discordId) continue;

					// Skip players without a tournament relation
					if (!player.tournament) {
						logger.warn(`Player ${player.name} (${player.discordId}) has no tournament relation, skipping`);
						totalFailed++;
						failures.push(`${player.name} - No tournament relation`);
						continue;
					}

					try {
						const member = await guild.members.fetch(player.discordId).catch(() => null);
						if (!member) {
							logger.verbose(`User ${player.discordId} not found in guild ${guildId}`);
							totalFailed++;
							failures.push(`${player.name} (${player.discordId}) - User not in server`);
							continue;
						}

						// Check if user has the role
						const roleName = getParticipantRoleName(player.tournament);
						const hasRole = member.roles.cache.some(r => r.name === roleName);

						if (!hasRole) {
							const roleAssigned = await assignParticipantRole(member, player.tournament, logger, support.participantRole);
							if (roleAssigned) {
								totalSuccess++;
								logger.info(`Restored role for ${player.name} in ${player.tournament.name}`);
							} else {
								totalFailed++;
								failures.push(`${player.name} - Failed to assign role`);
							}
						}

						// Add user to match threads if they were missed
						try {
							const threadsAdded = await addUserToMatchThreads(guild, player, support.tournamentApi);
							if (threadsAdded > 0) {
								totalThreadsAdded += threadsAdded;
								logger.info(`Added ${player.name} to ${threadsAdded} match thread(s)`);
							}
						} catch (err) {
							logger.error(`Failed to add ${player.name} to match threads:`, err);
						}
					} catch (err) {
						logger.error(`Error processing player ${player.name}:`, err);
						totalFailed++;
						failures.push(`${player.name} - ${err instanceof Error ? err.message : 'Unknown error'}`);
					}

					// Small delay to avoid rate limits
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}

			// Build results embed
			const embed = new EmbedBuilder()
				.setTitle("Role & Thread Sync Complete")
				.setColor(totalSuccess > 0 || totalThreadsAdded > 0 ? 0x00ff00 : 0xff0000)
				.addFields(
					{ name: "✅ Roles Synced", value: totalSuccess.toString(), inline: true },
					{ name: "🧵 Threads Added", value: totalThreadsAdded.toString(), inline: true },
					{ name: "❌ Failed", value: totalFailed.toString(), inline: true }
				);

			if (targetTournamentId) {
				const tournament = await ChallongeTournament.findOne({ where: { tournamentId: targetTournamentId } });
				embed.addFields({ name: "Tournament", value: tournament?.name || targetTournamentId, inline: true });
			} else {
				embed.addFields({ name: "Scope", value: "All tournaments", inline: true });
			}

			if (failures.length > 0 && failures.length <= 10) {
				embed.addFields({ name: "Failures", value: failures.join("\n"), inline: false });
			} else if (failures.length > 10) {
				embed.addFields({
					name: "Failures (first 10)",
					value: `${failures.slice(0, 10).join("\n")  }\n...and ${failures.length - 10} more`,
					inline: false
				});
			}

			await initialMsg.edit({ content: "", embeds: [embed] });
		} catch (err) {
			logger.error("Error during role sync:", err);
			await initialMsg.edit(`An error occurred during role sync: ${err instanceof Error ? err.message : 'Unknown error'}`);
		}
	}
};

export default command;
