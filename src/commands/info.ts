import { tournamentUrl, UUID_PATTERN } from "../website/challengermode";
import { EmbedBuilder, EmbedField } from "discord.js";
import { CommandDefinition } from "../Command";
import { ChallongeTournament } from "../database/orm";
import { Participant } from "../database/orm";
import { UserError } from "../util/errors";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";

const logger = getLogger("command:info");

export function createTournamentEmbed(tournament: ChallongeTournament): EmbedBuilder {
	// For capacity: 0 means unlimited, otherwise show the limit
	const capacity = tournament.participantLimit === 0 ? "Unlimited" : `${tournament.participantLimit}`;

	const fields: EmbedField[] = [
		{ name: ":ticket: Capacity", value: capacity, inline: true },
		{
			name: ":tickets: CSV Enrolled",
			value: `**${tournament.enrolledPlayers.length}** players`,
			inline: true
		},
		{ name: ":notepad_spiral: Format", value: tournament.format, inline: true },
		{ name: ":hourglass: Status", value: tournament.status, inline: true }
	];
	const byes = tournament.confirmed
		.filter((p: Participant) => p.hasBye)
		.map((p: Participant) => `<@${p.discordId}>`)
		.join(" ");
	if (byes) {
		fields.push({ name: ":sunglasses: Round 1 byes", value: byes, inline: true });
	}
	const hosts = tournament.hosts.map(snowflake => `<@${snowflake}>`).join(" ");
	fields.push({ name: ":smile: Hosts", value: hosts, inline: true });
	const embed = new EmbedBuilder()
		.setTitle(`**${tournament.name}**`)
		.setFields(fields)
		.setFooter({ text: "Tournament details as of request time" });

	if (UUID_PATTERN.test(tournament.challongeTournamentId)) embed.setURL(tournamentUrl(tournament.challongeTournamentId));

	// Only set description if it exists and is not empty
	if (tournament.description) {
		embed.setDescription(tournament.description);
	}

	return embed;
}

const command: CommandDefinition = {
	name: "info",
	requiredArgs: [],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		await support.organiserRole.authorise(msg);

		const [providedId] = args;
		const id = await resolveTournamentId(providedId, msg.guildId);
		if (!msg.guildId) {
			throw new UserError("This can only be used in a server!");
		}
		const tournament = await ChallongeTournament.findOne({
			where: {
				tournamentId: id,
				owningDiscordServer: msg.guildId
			},
			relations: ["enrolledPlayers", "confirmed"] // Load enrolled players for count
		});
		if (tournament) {
			logger.verbose(
				JSON.stringify({
					channel: msg.channelId,
					message: msg.id,
					user: msg.author.id,
					tournament: id,
					command: "info",
					event: "found"
				})
			);
			const embed = createTournamentEmbed(tournament);
			await msg.reply({
				embeds: [embed],
				allowedMentions: { users: [] }
			});
		} else {
			logger.verbose(
				JSON.stringify({
					channel: msg.channelId,
					message: msg.id,
					user: msg.author.id,
					tournament: id,
					command: "info",
					event: "404"
				})
			);
			await msg.reply("No matching tournament in this server.");
		}
	}
};

export default command;
