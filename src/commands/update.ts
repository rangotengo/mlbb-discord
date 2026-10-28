import { CommandDefinition } from "../Command";
import { isTournamentHost } from "../util/discord";
import { getLogger } from "../util/logger";
import { resolveTournamentId } from "../util/tournament";
import { assertTournamentNotComplete } from "../util/errors";

const logger = getLogger("command:update");

const command: CommandDefinition = {
	name: "update",
	requiredArgs: ["name", "description"],
	optionalArgs: ["id"],
	executor: async (msg, args, support) => {
		// If all 3 args provided: [providedId, name, desc]
		// If only 2 args provided (no id): [name, desc]
		let providedId: string | undefined;
		let name: string;
		let desc: string;

		if (args.length === 3) {
			[providedId, name, desc] = args;
		} else {
			[name, desc] = args;
		}

		const id = await resolveTournamentId(providedId, msg.guildId);
		const tournament = await support.database.authenticateHost(id, msg.author.id, msg.guildId, undefined, isTournamentHost(msg.member, id));
		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "update",
				name,
				desc,
				event: "attempt"
			})
		);
		assertTournamentNotComplete(tournament.name, tournament.status);
		// Update DB first because it performs an important check that might throw
		await support.database.updateTournament(id, name, desc);
		logger.verbose(
			JSON.stringify({
				channel: msg.channelId,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "update",
				name,
				desc,
				event: "success"
			})
		);
		await msg.reply(`Tournament \`${id}\` updated locally! It now has the name ${name} and the given description. Remote settings must be changed on Challengermode; syncing will refresh these local details.`);
	}
};

export default command;
