
export enum TournamentStatus {
	PREPARING = "preparing",
	IPR = "in progress",
	COMPLETE = "complete"
}

/**
 * How a tournament reaches its Challonge bracket.
 * Linked tournaments already have a Challonge URL.
 * Pre-check-in tournaments collect team attendance first, then the bot creates the bracket.
 */
export enum TournamentPhase {
	LINKED = "linked",
	PRE_CHECKIN = "pre-checkin",
	CHECKIN_OPEN = "checkin-open",
	BRACKET_CREATED = "bracket-created"
}

export enum TournamentFormat {
	SINGLE_ELIMINATION = "single elimination",
	DOUBLE_ELIMINATION = "double elimination",
	ROUND_ROBIN = "round robin",
	SWISS = "swiss",
	FREE_FOR_ALL = "free for all"
}

export interface DatabasePlayer {
	discordId: string;
	challongeId: number;

}

export interface DatabaseMessage {
	messageId: string;
	channelId: string;
}

// interface structure WIP as fleshed out command-by-command
export interface DatabaseTournament {
	id: string;
	challongeTournamentId?: string;
	name: string;
	description: string;
	format: TournamentFormat;
	status: TournamentStatus;
	hosts: string[];
	players: DatabasePlayer[];
	limit: number;
	server: string;
	publicChannels: string[];
	privateChannels: string[];
	byes: string[];
	findPlayer: (id: string) => DatabasePlayer | undefined;
}

export interface DatabasePlayerWithTournament {
	challongeId: number;
	tournament: {
		name: string;
		privateChannels: string[];
	};
}

export interface SynchroniseTournament {
	name: string;
	description: string;
	players: { challongeId: number; discordId: string }[];
	status?: TournamentStatus;
	format?: TournamentFormat;
	participantLimit?: number;
}

// Force this file to be compiled to JavaScript
export const __DATABASE_INTERFACE_VERSION__ = '1.0.0';
