import { isVerificationThread } from "../util/verificationThread";
import { CommandDefinition } from "../Command";
import { getLogger } from "../util/logger";
import { isTournamentOrganizer } from "../util";

const logger = getLogger("command:close");

const command: CommandDefinition = {
	name: "close",
	requiredArgs: [],
	executor: async (msg) => {
		const isTO = isTournamentOrganizer(msg.member);
		const isAdmin = msg.member?.permissions.has("Administrator");

		if (!isTO && !isAdmin) {
			await msg.reply("You must be a Tournament Organizer to manually close tickets.");
			return;
		}

		if (!(await isVerificationThread(msg.channel))) {
			await msg.reply("This command can only be used in private verification threads.");
			return;
		}

		await msg.reply("Closing verification thread in 5 seconds...");
		setTimeout(async () => {
			try {
				await msg.channel.delete("Ticket closed by TO");
			} catch (e) {
				logger.error("Failed to delete verification thread:", e);
			}
		}, 5000);
	}
};

export default command;
