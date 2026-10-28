import { Client } from "discord.js";
import { Router, Request, Response } from "express";
import os from "os";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { MatchSchedule } from "../../database/orm/MatchSchedule";
import { getLogger, getRecentLogs } from "../../util/logger";
import { getBotClient } from "../server";
import { getConnection } from "typeorm";
import { isEmailConfigured, sendEmailMessage } from "../../role/helper/email";
import { createSqliteBackup, listBackups } from "../../database/sqliteFile";
import path from "path";
import { inspectGuildReadiness } from "../../services/readiness";

const router = Router();
const logger = getLogger("web:system");

/**
 * Helper to safely get the Discord client or null
 */
function tryGetBotClient(): Client | null {
	try {
		return getBotClient();
	} catch (e) {
		return null;
	}
}


// API: Get system statistics
router.get("/api/system/stats", async (req: Request, res: Response) => {
	try {
		const tournamentCount = await ChallongeTournament.count();
		const playerCount = await EnrolledPlayer.count();
		const scheduleCount = await MatchSchedule.count();
		
		let discordGuilds = 0;
		const client = tryGetBotClient();
		if (client) {
			discordGuilds = client.guilds.cache.size;
		} else {
			logger.warn("Could not get Discord client for stats (bot not ready)");
		}


		// System info
		const system = {
			uptime: process.uptime(),
			memory: {
				free: os.freemem(),
				total: os.totalmem(),
				usage: process.memoryUsage().rss
			},
			platform: os.platform(),
			arch: os.arch(),
			cpus: os.cpus().length,
			nodeVersion: process.version
		};

		res.json({
			success: true,
			data: {
				tournaments: tournamentCount,
				players: playerCount,
				schedules: scheduleCount,
				discordGuilds,
				system
			}
		});
	} catch (error) {
		logger.error("Failed to fetch system stats:", error);
		res.status(500).json({ success: false, error: "Failed to fetch system stats" });
	}
});

// API: Get recent scrolls (logs)
router.get("/api/system/logs", (req: Request, res: Response) => {
	try {
		const logs = getRecentLogs();
		res.json({
			success: true,
			data: logs
		});
	} catch (error) {
		logger.error("Failed to fetch logs:", error);
		res.status(500).json({ success: false, error: "Failed to fetch logs" });
	}
});

// API: Get recent activity
router.get("/api/system/activity", async (req: Request, res: Response) => {
	try {
		const limit = parseInt(req.query.limit as string) || 10;

		// Get recent tournaments (ordered by primary key implicitly)
		const tournaments = await ChallongeTournament.find({
			take: limit,
		});

		const activities = tournaments.map(t => ({
			type: "tournament",
			message: `Tournament "${t.name}" (${t.status})`,
			timestamp: new Date().toISOString(), // Placeholder
		}));

		res.json({
			success: true,
			data: activities,
		});
	} catch (error) {
		logger.error("Failed to fetch system activity:", error);
		res.status(500).json({ success: false, error: "Failed to fetch system activity" });
	}
});

const STALE_SYNC_MS = 60 * 60 * 1000;
let lastEmailTest = 0;

router.get("/api/system/overview", async (req: Request, res: Response) => {
	try {
		const now = new Date();
		const tournaments = await ChallongeTournament.find();
		const schedules = await MatchSchedule.find({ order: { scheduledTime: "ASC" } });
		const names = new Map(tournaments.map(tournament => [tournament.tournamentId, tournament.name]));
		const upcoming = schedules.filter(schedule => schedule.scheduledTime.getFullYear() < 2090 && schedule.scheduledTime >= now).slice(0, 10);
		const unresolved = await EnrolledPlayer.count({ where: { identityVerified: false } });
		const pendingAccess = await EnrolledPlayer.count({ where: { accessPending: true } });
		const unscheduled = schedules.filter(schedule => schedule.scheduledTime.getFullYear() >= 2090).length;
		const stale = tournaments.filter(tournament => !tournament.lastSyncSuccess || now.getTime() - tournament.lastSyncSuccess.getTime() > STALE_SYNC_MS);
		res.json({
			success: true,
			data: {
				upcomingMatches: upcoming.map(schedule => ({
					matchId: schedule.matchId, tournamentId: schedule.tournamentId,
					tournamentName: names.get(schedule.tournamentId) || schedule.tournamentId,
					scheduledTime: schedule.scheduledTime.toISOString(), round: schedule.roundNumber ?? null, threadId: schedule.threadId
				})),
				unresolvedVerifications: unresolved,
				missingRoles: pendingAccess,
				unmatchedTeams: null,
				unscheduledMatches: unscheduled,
				failedJobs: null,
				staleSyncs: stale.map(tournament => ({
					tournamentId: tournament.tournamentId, name: tournament.name,
					lastSyncAttempt: tournament.lastSyncAttempt?.toISOString() || null,
					lastSyncSuccess: tournament.lastSyncSuccess?.toISOString() || null
				})),
				generatedAt: now.toISOString()
			}
		});
	} catch (error) {
		logger.error("Failed to build overview:", error);
		res.status(500).json({ success: false, error: "Failed to build overview" });
	}
});

router.get("/api/tournaments/:id/discord-readiness", async (req: Request, res: Response) => {
	const tournament = await ChallongeTournament.findOneBy({ tournamentId: String(req.params.id || "") });
	const client = tryGetBotClient();
	if (!tournament) return res.status(404).json({ success: false, error: "Tournament not found" });
	if (!client?.isReady()) return res.status(503).json({ success: false, error: "Discord is not connected" });
	const guild = await client.guilds.fetch(tournament.owningDiscordServer).catch(() => null);
	if (!guild) return res.status(404).json({ success: false, error: "The tournament server is not available to the bot" });
	res.json({ success: true, data: { issues: inspectGuildReadiness(guild, tournament), checkedAt: new Date().toISOString() } });
});

router.get("/api/system/readiness", async (req: Request, res: Response) => {
	const client = tryGetBotClient();
	let database = { ok: false, engine: process.env.SQLITE_DB ? "sqlite" : "postgres", detail: "Database is not connected" };
	try {
		await getConnection().query("SELECT 1");
		database = { ok: true, engine: database.engine, detail: "Database accepted a test query" };
	} catch (error) {
		database.detail = error instanceof Error ? error.message : database.detail;
	}
	const latest = await ChallongeTournament.find({ order: { lastSyncAttempt: "DESC" }, take: 1 });
	const sync = latest[0];
	res.json({
		success: true,
		data: {
			discord: { ready: Boolean(client?.isReady()), guilds: client?.guilds.cache.size || 0, detail: client ? undefined : "Bot client is not connected" },
			database,
			challengermode: { ok: sync?.lastSyncSuccess ? true : sync?.lastSyncAttempt ? false : null, lastSuccess: sync?.lastSyncSuccess?.toISOString() || null },
			email: { configured: isEmailConfigured(), lastAttempt: null, lastResult: null },
			web: { bind: process.env.WEB_BIND || "127.0.0.1", port: Number(process.env.WEB_PORT || 3000) },
			buildVersion: process.env.npm_package_version || "0.1.0",
			generatedAt: new Date().toISOString()
		}
	});
});

router.post("/api/system/email/test", async (req: Request, res: Response) => {
	if (Date.now() - lastEmailTest < 60_000) return res.status(429).json({ success: false, error: "Wait a minute before sending another test email" });
	const to = typeof req.body.to === "string" ? req.body.to.trim() : "";
	lastEmailTest = Date.now();
	const result = await sendEmailMessage(to, "Tournament email test", "This is a setup test from the tournament dashboard.");
	res.json({ success: true, data: result.accepted ? { accepted: true, messageId: result.messageId, detail: "Provider accepted the test" } : { accepted: false, reason: result.reason, detail: result.detail } });
});

function backupDirectory(): string {
	const dbPath = process.env.SQLITE_DB;
	return dbPath && dbPath !== ":memory:" ? path.join(path.dirname(dbPath), "backups") : path.resolve(process.cwd(), "data", "backups");
}

router.post("/api/system/backup", (req: Request, res: Response) => {
	const dbPath = process.env.SQLITE_DB;
	if (!dbPath || dbPath === ":memory:") return res.status(400).json({ success: false, error: "SQLite file backups are unavailable for this database. Use your PostgreSQL backup tool." });
	try {
		res.json({ success: true, data: createSqliteBackup(dbPath, backupDirectory()) });
	} catch (error) {
		res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Backup failed" });
	}
});

router.get("/api/system/backups", (req: Request, res: Response) => {
	res.json({ success: true, data: listBackups(backupDirectory()) });
});

// SQL.js holds the active database in memory; replacing its file while it is
// running would be undone by the next autosave. Restoration must be offline.
router.post("/api/system/restore", (req: Request, res: Response) => {
	res.status(409).json({ success: false, error: "Stop the bot before restoring a SQLite backup. Replace the database file while the application is stopped, then restart it." });
});

export default router;


