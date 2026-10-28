import { Router, Request, Response } from "express";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { getLogger } from "../../util/logger";

const router = Router();
const logger = getLogger("web:players");

// API: Search players across all tournaments
router.get("/api/players/search", async (req: Request, res: Response) => {
	try {
		const page = Math.max(1, Number(req.query.page) || 1);
		const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
		const filters = ["1=1"];
		const values: Record<string, string> = {};
		const add = (sql: string, key: string, value: unknown): void => {
			if (typeof value === "string" && value.trim()) {
				filters.push(sql);
				values[key] = value.trim();
			}
		};
		add("LOWER(player.email) LIKE LOWER(:email)", "email", typeof req.query.email === "string" ? `%${req.query.email}%` : undefined);
		add("LOWER(player.discordUsername) LIKE LOWER(:discordUsername)", "discordUsername", typeof req.query.discordUsername === "string" ? `%${req.query.discordUsername}%` : undefined);
		add("player.discordId = :discordId", "discordId", req.query.discordId);
		add("LOWER(player.team) LIKE LOWER(:team)", "team", typeof req.query.team === "string" ? `%${req.query.team}%` : undefined);
		add("player.tournamentId = :tournamentId", "tournamentId", req.query.tournamentId);
		if (req.query.verified === "true" || req.query.verified === "false") {
			filters.push("player.verified = :verified");
			values.verified = req.query.verified === "true" ? "1" : "0";
		}

		const query = EnrolledPlayer.createQueryBuilder("player")
			.leftJoinAndSelect("player.tournament", "tournament")
			.where(filters.join(" AND "), values)
			.orderBy("tournament.name", "ASC")
			.addOrderBy("player.team", "ASC")
			.addOrderBy("player.id", "ASC");
		const total = await query.getCount();
		const players = await query.skip((page - 1) * limit).take(limit).getMany();
		const mask = (address: string): string => {
			const [local, domain] = address.split("@");
			if (!domain || local.length < 2) return "***";
			return `${local[0]}***${local[local.length - 1]}@${domain}`;
		};
		const data = players.map(p => ({
			id: p.id,
			email: mask(p.email),
			name: p.name,
			team: p.team,
			discordUsername: p.discordUsername,
			discordId: p.discordId,
			verified: p.verified,
			challongeId: p.challongeId,
			tournament: p.tournament ? { id: p.tournament.tournamentId, name: p.tournament.name } : null,
		}));

		res.json({ success: true, data, total, page, limit, pages: Math.ceil(total / limit), emailMasked: true });
	} catch (error) {
		logger.error("Failed to search players:", error);
		res.status(500).json({ success: false, error: "Failed to search players" });
	}
});

// Page: Player search
router.get("/players", (req: Request, res: Response) => {
	res.render("players/index", {
		title: "Player Search",
		path: "/players",
	});
});

export default router;
