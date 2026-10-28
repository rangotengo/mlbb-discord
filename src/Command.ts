import { Message } from "discord.js";
import { DatabaseWrapperPostgres } from "./database/postgres";
import { HostRoleProvider } from "./role/host";
import { OrganiserRoleProvider } from "./role/organiser";
import { ParticipantRoleProvider } from "./role/participant";
import { TimeWizard } from "./timer";
import { ChallongeAPIError, UserError } from "./util/errors";
import { getLogger } from "./util/logger";
import { Public } from "./util/types";
import { WebsiteWrapperChallengermode } from "./website/challengermode";

const logger = getLogger("command");

interface MatchScore {
	playerId: string;
	playerDiscord: string;
	playerScore: number;
	oppScore: number;
}

export interface CommandSupport {
	organiserRole: OrganiserRoleProvider;
	database: Public<DatabaseWrapperPostgres>;
	tournamentApi: WebsiteWrapperChallengermode;
	scores: Map<string, Map<string, MatchScore>>;
	participantRole: ParticipantRoleProvider;
	hostRole: HostRoleProvider;
	timeWizard: TimeWizard;
}

// This is a composition-over-inheritance approach. In an inheritance model this
// would just be combined with command and executor would be an abstract method
// the subclasses must implement.
export interface CommandDefinition {
	name: string;
	requiredArgs: string[];
	optionalArgs?: string[];
	executor: (message: Message, args: string[], support: CommandSupport) => Promise<void>;
}

export class Command {
	constructor(protected definition: CommandDefinition) {}

	protected checkUsage(args: string[]): string {
		const { requiredArgs, optionalArgs = [] } = this.definition;
		const minArgs = requiredArgs.length;
		const maxArgs = requiredArgs.length + optionalArgs.length;
		const isVariadic = requiredArgs.some(a => a.startsWith("...")) || optionalArgs.some(a => a.startsWith("..."));

		// Check if we have at least the minimum required arguments
		if (minArgs > 0 && args.length < minArgs) {
			return `Usage: ${this.definition.name} ${requiredArgs.join(" ")}${optionalArgs.length ? ` [${optionalArgs.join(" ")}]` : ""}`;
		}

		// Check if we have too many arguments
		if (maxArgs > 0 && args.length > maxArgs && !isVariadic) {
			return `Usage: ${this.definition.name} ${requiredArgs.join(" ")}${optionalArgs.length ? ` [${optionalArgs.join(" ")}]` : ""}`;
		}

		// Check if any required args are falsy
		if (args.slice(0, minArgs).some(value => !value)) {
			return `Usage: ${this.definition.name} ${requiredArgs.join("|")}${optionalArgs.length ? ` [${optionalArgs.join("|")}]` : ""}`;
		}

		return "";
	}

	protected log(msg: Message, extra: Record<string, unknown>): string {
		return JSON.stringify({
			channel: msg.channelId,
			message: msg.id,
			user: msg.author.id,
			command: this.definition.name,
			...extra
		});
	}

	public async run(msg: Message, args: string[], support: CommandSupport): Promise<void> {
		logger.verbose(this.log(msg, { event: "attempt" }));
		const error = this.checkUsage(args);
		if (error) {
			logger.verbose(this.log(msg, { error }));
			await msg.reply(error).catch(logger.error);
			return;
		}
		try {
			logger.info(this.log(msg, { args, event: "execute" }));
			await this.definition.executor(msg, args, support);
			logger.info(this.log(msg, { args, event: "success" }));
		} catch (e) {
			if (e instanceof UserError) {
				logger.verbose(this.log(msg, { error: e.message }));
				await msg.reply(e.message).catch(logger.error);
				return;
			}
			// make-fetch-happen and minipass-fetch do not export their otherwise identical FetchError
			if (e instanceof ChallongeAPIError || (e instanceof Error && e.name === "FetchError")) {
				logger.warn(this.log(msg, { args }), e);
				await msg.reply(`Something went wrong with Challengermode! Please try again later.`).catch(logger.error);
				return;
			}
			logger.error(this.log(msg, { args }), e); // internal error
			await msg.reply("Something went wrong. Please try again later.").catch(logger.error);
		}
	}
}
