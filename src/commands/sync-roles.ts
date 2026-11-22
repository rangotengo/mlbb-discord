import { indexMemberNames, matchMemberName, MemberNameIndex } from "../util/memberNames";
import { EmbedBuilder } from "discord.js";
import { In } from "typeorm";
import { CommandDefinition } from "../Command";
import { EnrolledPlayer, ChallongeTournament } from "../database/orm";
import { getLogger } from "../util/logger";
import { isTournamentHost } from "../util/discord";
import { assignParticipantRole, getParticipantRoleName } from "../util/roles";
import { parseDiscordId } from "../util/discordId";
import { addUserToMatchThreads } from "../util/matchThreads";

const logger = getLogger("command:sync-roles");
const command: CommandDefinition = {
	name: "sync-roles", requiredArgs: [], optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		if (!msg.guildId) return;
		const tournaments = await ChallongeTournament.find({ where: { owningDiscordServer: msg.guildId } });
		const allowed: string[] = [];
		for (const tournament of tournaments) {
			if (args[0] && tournament.tournamentId !== args[0]) continue;
			try {
				await support.database.authenticateHost(tournament.tournamentId, msg.author.id, msg.guildId,
					undefined, isTournamentHost(msg.member, tournament.tournamentId));
				allowed.push(tournament.tournamentId);
			} catch { /* Each tournament requires its own authorization. */ }
		}
		if (!allowed.length) {
			await msg.reply("No authorized tournaments found for role sync in this server.");
			return;
		}
		const progress = await msg.reply("Matching imported Discord IDs and names, then syncing participant roles…");
		try {
			const players = await EnrolledPlayer.find({ where: { tournamentId: In(allowed) }, relations: ["tournament"] });
			const guild = await msg.client.guilds.fetch(msg.guildId);
			let names: MemberNameIndex | undefined;
			if (players.some(player => !player.discordId && player.discordUsername && !parseDiscordId(player.discordUsername))) {
				try {
					// Fetch the complete server roster; a partial cache could hide ambiguous names.
					names = indexMemberNames((await guild.members.fetch()).values());
				} catch (error) { logger.error("Could not load members for name matching:", error); }
			}
			let verified = 0, roles = 0, threads = 0, skipped = 0, failed = 0, unchanged = 0;
			const failures: string[] = [];
			for (const player of players) {
				// Also recognize numeric IDs stored in the username column by older team imports.
				const id = player.discordId ? parseDiscordId(player.discordId) : parseDiscordId(player.discordUsername);
				if (!player.discordId && !player.discordUsername?.trim()) { skipped++; continue; }
				if (!player.tournament || player.tournament.owningDiscordServer !== msg.guildId) { skipped++; continue; }
				try {
					if (player.discordId && !id) throw new Error("Invalid saved Discord ID");
					if (!id && !names) throw new Error("Full member list unavailable; name matching was not attempted");
					const member = id ? await guild.members.fetch(id) : matchMemberName(names!, player.discordUsername!);
					if (member.user.bot) { skipped++; continue; }
					const hasRole = member.roles.cache.some(role => role.name === getParticipantRoleName(player.tournament));
					if (!hasRole) {
						if (!await assignParticipantRole(member, player.tournament, logger, support.participantRole)) {
							throw new Error("Could not assign participant role");
						}
						roles++;
					}
					const wasVerified = player.verified;
					// Verification succeeds only after an unambiguous member match and role checks pass.
					player.discordId = member.id;
					player.discordUsername = member.user.username;
					player.verified = true;
					player.otp = null;
					await player.save();
					if (!wasVerified) verified++;
					else if (hasRole) unchanged++;
					try { threads += await addUserToMatchThreads(guild, player, support.challonge); }
					catch (error) { logger.error("Could not restore match-thread access:", error); failures.push(`${player.name || player.team}: thread access failed`); }
				} catch (error) {
					failed++;
					failures.push(`${player.name || player.team}: ${error instanceof Error ? error.message : "Member or role unavailable"}`);
				}
			}
			const embed = new EmbedBuilder().setTitle("Verification & Role Sync Complete").setColor(failed ? 0xf1c40f : 0x00b894)
				.setDescription(`Processed ${players.length} player records in ${allowed.length} authorized tournament(s) in this server.`)
				.addFields(
					{ name: "Newly verified", value: String(verified), inline: true },
					{ name: "Roles assigned", value: String(roles), inline: true },
					{ name: "Threads added", value: String(threads), inline: true },
					{ name: "Already verified with role", value: String(unchanged), inline: true },
					{ name: "Skipped (no Discord value or bot)", value: String(skipped), inline: true },
					{ name: "Failed", value: String(failed), inline: true }
				);
			if (failures.length) embed.addFields({ name: "Issues (first 10)", value: failures.slice(0, 10).join("\n").slice(0, 1024) });
			await progress.edit({ content: "", embeds: [embed] });
		} catch (error) {
			logger.error("Role sync failed:", error);
			await progress.edit("Role sync could not finish. Please check the bot's member and role permissions.");
		}
	}
};
export default command;
