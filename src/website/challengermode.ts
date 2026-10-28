import { UserError } from "../util/errors";

/** The legacy challongeId property is retained for compatibility with stored enrollments. */
export interface WebsitePlayer {
	challongeId: string;
	discordId: string;
	name: string;
	active: boolean;
	rank: number;
	seed: number;
}

export interface WebsiteTournament {
	id: string;
	name: string;
	desc: string;
	url: string;
	players: WebsitePlayer[];
	rounds: number;
	tieBreaks: string[];
	state?: "pending" | "underway" | "complete";
	format?: "single elimination" | "double elimination" | "round robin" | "swiss";
	signupCap?: number | null;
}

export type MatchState = "pending" | "open" | "underway" | "complete";

export interface WebsiteMatch {
	player1: string | null;
	player2: string | null;
	matchId: string;
	state: MatchState;
	open: boolean;
	round: number;
	scheduledTime?: string | null;
}

export class ChallengermodeAPIError extends UserError {}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractTournamentId(input: string): string {
	const value = input.trim();
	if (UUID_PATTERN.test(value)) return value.toLowerCase();
	let url: URL;
	try {
		url = new URL(value.includes("://") ? value : `https://${value}`);
	} catch {
		throw new UserError("Enter a Challengermode tournament URL or tournament UUID.");
	}
	const segments = url.pathname.split("/").filter(Boolean);
	const index = segments.indexOf("tournaments");
	const id = segments[index + 1];
	if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
		!["challengermode.com", "www.challengermode.com"].includes(url.hostname.toLowerCase()) ||
		index < 0 || !id || !UUID_PATTERN.test(id)) {
		throw new UserError("Enter a Challengermode tournament URL, such as https://www.challengermode.com/s/your-space/tournaments/<uuid>.");
	}
	return id.toLowerCase();
}

export function tournamentUrl(id: string): string {
	return `https://www.challengermode.com/tournaments/${extractTournamentId(id)}`;
}

interface Lineup {
	id: string;
	name: string;
	disqualified: boolean;
	seed: number | null;
	placement: { bestPlacement: number; worstPlacement: number } | null;
}

interface Metadata {
	id: string;
	name: string | null;
	description: string;
	state: string;
	links: { overviewUrl: string };
	settings: { tournamentSettings: { format: string; maxLineupCount: number } };
	attendance: { roster: { lineupCount: number } | null; signups: { lineupCount: number } };
}

interface Series {
	id: string;
	state: string;
	lineupCount: number;
	lineups: ({ id: string } | null)[];
	labels: string[];
	scheduledStartTimeAt: string | null;
	context: { tournamentContext: { stageNumber: number; roundNumber: number } | null };
}

const LINEUP_FIELDS = "id name disqualified seed placement { bestPlacement worstPlacement }";

// Queries follow https://publicapi.challengermode.com/graphql?sdl.
// MatchSeries represents the whole best-of fixture; individual Match objects are games.
export const METADATA_QUERY = `query BotTournament($id: UUID!) {
	tournament(tournamentId: $id) {
		id name description state links { overviewUrl }
		settings { tournamentSettings { format maxLineupCount } }
		attendance { roster { lineupCount } signups { lineupCount } }
	}
}`;

export const SERIES_QUERY = `query BotMatches($id: UUID!) {
	tournament(tournamentId: $id) {
		matchSeries {
			id state lineupCount lineups { id } labels scheduledStartTimeAt
			context { tournamentContext { ... on TournamentMatchContext { stageNumber roundNumber } } }
		}
	}
}`;

type Fetch = typeof globalThis.fetch;

/** Reads tournament data using application BOT access. Remote administration stays on Challengermode. */
export class WebsiteWrapperChallengermode {
	readonly supportsWrites = false;
	private token?: { value: string; expiresAt: number };
	private refreshing?: Promise<string>;

	constructor(private refreshKey: string, private request: Fetch = globalThis.fetch) {}

	private async json(url: string, options: RequestInit): Promise<{ response: Response; body: { value?: unknown; expiresAt?: unknown; errors?: unknown[]; data?: unknown } }> {
		let response: Response;
		try {
			response = await this.request(url, { ...options, signal: AbortSignal.timeout(30_000) });
		} catch {
			throw new ChallengermodeAPIError("Could not connect to Challengermode. Please try again later.");
		}
		const body = await response.json().catch(() => undefined);
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			// Gateways may return an empty 401; the query layer still needs to refresh its token.
			if (response.status === 401) return { response, body: {} };
			throw new ChallengermodeAPIError(`Challengermode returned an invalid response (HTTP ${response.status}).`);
		}
		return { response, body };
	}

	private async accessToken(): Promise<string> {
		if (!this.refreshKey.trim()) {
			throw new ChallengermodeAPIError("Set CHALLENGERMODE_REFRESH_KEY using an application refresh key from the Challengermode developer dashboard, then restart the bot.");
		}
		if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
		if (!this.refreshing) {
			this.refreshing = (async () => {
				const { response, body } = await this.json("https://publicapi.challengermode.com/mk1/v1/auth/access_keys", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ refreshKey: this.refreshKey })
				});
				const expiresAt = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
				if (!response.ok || typeof body.value !== "string" || !body.value || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
					throw new ChallengermodeAPIError(`Challengermode authentication failed (HTTP ${response.status}). Check the application refresh key.`);
				}
				this.token = { value: body.value, expiresAt };
				return body.value as string;
			})().finally(() => { this.refreshing = undefined; });
		}
		return this.refreshing;
	}

	private async query<T>(query: string, variables: Record<string, unknown>, retry = true): Promise<T> {
		const token = await this.accessToken();
		const { response, body } = await this.json("https://publicapi.challengermode.com/graphql", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ query, variables })
		});
		if (response.status === 401 && retry) {
			if (this.token?.value === token) this.token = undefined;
			return this.query(query, variables, false);
		}
		// Never import partial GraphQL results: doing so could silently lose teams or fixtures.
		if (!response.ok || body.errors?.length || (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) ||
			(body.errors !== undefined && !Array.isArray(body.errors))) {
			throw new ChallengermodeAPIError(`Could not read Challengermode data (HTTP ${response.status}). Check API access and the tournament URL${response.status === 429 ? "; rate limit reached, try again later" : ""}.`);
		}
		return body.data as T;
	}

	private async metadata(tournamentId: string): Promise<Metadata> {
		const id = extractTournamentId(tournamentId);
		const data = await this.query<{ tournament: Metadata | null }>(METADATA_QUERY, { id });
		const tournament = data.tournament;
		if (!tournament || typeof tournament.id !== "string" || !UUID_PATTERN.test(tournament.id) || tournament.id.toLowerCase() !== id || !tournament.attendance?.signups || !tournament.links || !tournament.settings?.tournamentSettings) {
			throw new ChallengermodeAPIError("Challengermode tournament not found or inaccessible.");
		}

		const settings = tournament.settings.tournamentSettings;
		if ((tournament.name !== null && typeof tournament.name !== "string") || typeof tournament.description !== "string" ||
			typeof tournament.links.overviewUrl !== "string" || !Number.isSafeInteger(settings.maxLineupCount) || settings.maxLineupCount < 0) {
			throw new ChallengermodeAPIError("Invalid Challengermode tournament data.");
		}
		return { ...tournament, id };
	}

	private async players(tournament: Metadata): Promise<WebsitePlayer[]> {
		const roster = tournament.attendance.roster;
		let lineups: Lineup[] = [];
		const count = roster?.lineupCount ?? tournament.attendance.signups.lineupCount;
		if (!Number.isInteger(count) || count < 0) throw new ChallengermodeAPIError("Invalid Challengermode team count.");
		if (count === 0) return [];
		if (roster) {
			const query = `query BotRoster($id: UUID!, $limit: Int!) {
				tournament(tournamentId: $id) { attendance { roster { lineups(limit: $limit) { ${LINEUP_FIELDS} } } } }
			}`;
			const data = await this.query<{ tournament: { attendance: { roster: { lineups: Lineup[] } | null } } | null }>(query, { id: tournament.id, limit: roster.lineupCount });
			lineups = data.tournament?.attendance?.roster?.lineups ?? [];
			if (!Array.isArray(lineups) || lineups.length !== roster.lineupCount) throw new ChallengermodeAPIError("Incomplete Challengermode roster. Please sync again.");
		} else {
			const count = tournament.attendance.signups.lineupCount;
			for (let skip = 0; skip < count; skip += 100) {
				const query = `query BotSignups($id: UUID!, $limit: Int!, $skip: Int!) {
					tournament(tournamentId: $id) { attendance { signups { lineups(limit: $limit, skip: $skip) { ${LINEUP_FIELDS} } } } }
				}`;
				const data = await this.query<{ tournament: { attendance: { signups: { lineups: Lineup[] } } } | null }>(query, { id: tournament.id, limit: Math.min(100, count - skip), skip });
				const page = data.tournament?.attendance?.signups?.lineups;
				if (!Array.isArray(page) || page.length !== Math.min(100, count - skip)) throw new ChallengermodeAPIError("Incomplete Challengermode signups. Please sync again.");
				lineups.push(...page);
			}
		}
		const ids = new Set<string>();
		return lineups.map(p => {
			if (!p || typeof p.id !== "string" || !UUID_PATTERN.test(p.id) || typeof p.name !== "string" || typeof p.disqualified !== "boolean" ||
				(p.seed !== null && !Number.isSafeInteger(p.seed)) || ids.has(p.id.toLowerCase())) throw new ChallengermodeAPIError("Invalid or duplicate Challengermode team data.");
			ids.add(p.id.toLowerCase());
			return {
				challongeId: p.id.toLowerCase(), name: p.name, discordId: "DUMMY", active: !p.disqualified,
				rank: p.placement?.bestPlacement === p.placement?.worstPlacement ? p.placement?.bestPlacement ?? -1 : -1,
				seed: p.seed ?? 0
			};
		});
	}

	public async getTournament(tournamentId: string): Promise<WebsiteTournament> {
		const t = await this.metadata(tournamentId);
		const formats: Record<string, WebsiteTournament["format"]> = {
			SINGLE_ELIMINATION: "single elimination", DOUBLE_ELIMINATION: "double elimination", ROUND_ROBIN: "round robin", SWISS: "swiss"
		};
		const states: Record<string, WebsiteTournament["state"]> = {
			UNLISTED: "pending", OPEN: "pending", STARTING: "pending", RUNNING: "underway", COMPLETED: "complete", CANCELLED: "complete"
		};
		const format = formats[t.settings.tournamentSettings.format];
		if (!Object.hasOwn(formats, t.settings.tournamentSettings.format) || !Object.hasOwn(states, t.state)) throw new ChallengermodeAPIError("This Challengermode tournament format or state is not supported by the bot.");
		return {
			id: t.id, name: t.name || t.id, desc: t.description, url: t.links.overviewUrl || tournamentUrl(t.id),
			players: await this.players(t), rounds: 0, tieBreaks: [], state: states[t.state], format,
			signupCap: t.settings.tournamentSettings.maxLineupCount
		};
	}

	public async getPlayers(tournamentId: string): Promise<WebsitePlayer[]> {
		return this.players(await this.metadata(tournamentId));
	}

	public async getPlayer(tournamentId: string, playerId: string): Promise<WebsitePlayer> {
		const player = (await this.getPlayers(tournamentId)).find(p => p.challongeId === playerId.toLowerCase());
		if (!player) throw new ChallengermodeAPIError("Team not found in the Challengermode tournament.");
		return player;
	}

	public async getMatches(tournamentId: string, open = false, playerId?: string): Promise<WebsiteMatch[]> {
		const id = extractTournamentId(tournamentId);
		const data = await this.query<{ tournament: { matchSeries: Series[] } | null }>(SERIES_QUERY, { id });
		if (!data.tournament || !Array.isArray(data.tournament.matchSeries)) throw new ChallengermodeAPIError("Challengermode fixtures are unavailable.");
		const series = data.tournament.matchSeries;
		const ids = new Set<string>();
		// Keep rounds from consecutive stages distinct, with negative rounds for the lower bracket.
		const stageSizes = new Map<number, number>();
		for (const s of series) {
			const c = s?.context?.tournamentContext;
			if (!s || typeof s.id !== "string" || !UUID_PATTERN.test(s.id) || !c || !Number.isInteger(c.roundNumber) || c.roundNumber < 0 || !Number.isInteger(c.stageNumber) || c.stageNumber < 0) {
				throw new ChallengermodeAPIError("Invalid Challengermode fixture or round data.");
			}
			if (ids.has(s.id.toLowerCase())) throw new ChallengermodeAPIError("Duplicate Challengermode fixture ID.");
			ids.add(s.id.toLowerCase());
			if (s.lineupCount !== 2 || !Array.isArray(s.lineups) || s.lineups.length > 2 || s.lineups.some(p => p !== null && (!p || typeof p.id !== "string" || !UUID_PATTERN.test(p.id)))) {
				throw new ChallengermodeAPIError("Only fixtures between two teams or players are supported.");
			}
			if (s.lineups[0] && s.lineups[1] && s.lineups[0].id.toLowerCase() === s.lineups[1].id.toLowerCase()) {
				throw new ChallengermodeAPIError("A Challengermode fixture cannot pair a team with itself.");
			}
			if (s.state === "RUNNING" && (!s.lineups[0] || !s.lineups[1])) throw new ChallengermodeAPIError("A running Challengermode fixture is missing an opponent.");
			if (!Array.isArray(s.labels) || (s.scheduledStartTimeAt !== null && (typeof s.scheduledStartTimeAt !== "string" || !Number.isFinite(Date.parse(s.scheduledStartTimeAt))))) {
				throw new ChallengermodeAPIError("Invalid Challengermode fixture schedule.");
			}
			stageSizes.set(c.stageNumber, Math.max(stageSizes.get(c.stageNumber) ?? 0, c.roundNumber + 1));
		}
		const stageOffsets = new Map<number, number>();
		let offset = 0;
		for (const [stage, size] of [...stageSizes].sort(([a], [b]) => a - b)) {
			stageOffsets.set(stage, offset);
			offset += size;
		}
		const states: Record<string, MatchState> = { WAITING: "pending", RUNNING: "underway", PAUSED: "pending", COMPLETED: "complete", NULLIFIED: "complete" };
		return series.map(s => {
			let state = states[s.state];
			if ((s.state === "WAITING" || s.state === "PAUSED") && s.lineups[0] && s.lineups[1]) state = "open";
			if (!Object.hasOwn(states, s.state)) throw new ChallengermodeAPIError("Unknown Challengermode fixture state.");
			const c = s.context.tournamentContext!;
			const round = (stageOffsets.get(c.stageNumber) ?? 0) + c.roundNumber + 1;
			return {
				matchId: s.id.toLowerCase(), player1: s.lineups[0]?.id.toLowerCase() ?? null, player2: s.lineups[1]?.id.toLowerCase() ?? null,
				state, open: state === "open" || state === "underway", round: s.labels.includes("DOUBLE_ELIMINATION_LOWER_BRACKET") ? -round : round,
				scheduledTime: s.scheduledStartTimeAt
			};
		}).filter(m => (!open || m.open) && (!playerId || m.player1 === playerId.toLowerCase() || m.player2 === playerId.toLowerCase()))
			.sort((a, b) => Math.abs(a.round) - Math.abs(b.round) || a.matchId.localeCompare(b.matchId));
	}

	public assertWritesSupported(): never {
		throw new UserError("This integration reads data from Challengermode. Manage registration, scores, and tournament settings on Challengermode, then use !sync to refresh the bot.");
	}

	// Retain the call signatures so older commands fail with instructions before any remote change.
	public bulkAddParticipants(id: string, names: string[]): Promise<Map<string, string>>;
	public async bulkAddParticipants(): Promise<Map<string, string>> { return this.assertWritesSupported(); }
	public submitScore(id: string, match: WebsiteMatch, winner: string, winnerScore: number, loserScore: number): Promise<void>;
	public async submitScore(): Promise<void> { this.assertWritesSupported(); }
}

let sharedClient: { refreshKey: string; client: WebsiteWrapperChallengermode } | undefined;

export function getTournamentApi(refreshKey: string): WebsiteWrapperChallengermode {
	if (!sharedClient || sharedClient.refreshKey !== refreshKey) {
		sharedClient = { refreshKey, client: new WebsiteWrapperChallengermode(refreshKey) };
	}
	return sharedClient.client;
}
