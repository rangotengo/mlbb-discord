import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { getLogger } from "../../util/logger";
import { getBotClient } from "../server";
import dotenv from "dotenv";


const router = Router();
const logger = getLogger("web:routes:config");

// Production has no project .env. Keep saved values on the mounted data volume.
const envPath = process.env.NODE_ENV === "production"
    ? path.resolve(process.env.SQLITE_DB ? path.dirname(process.env.SQLITE_DB) : path.join(process.cwd(), "data"), ".env")
    : path.resolve(process.cwd(), ".env");

// Helper to update .env file
function updateEnv(updates: Record<string, string>) {
	try {
        let envFileContent = "";
        if (fs.existsSync(envPath)) {
            envFileContent = fs.readFileSync(envPath, "utf-8");
        }
        
        const lines = envFileContent.split('\n');
        
        const updatedLines = [];
        const seenKeys = new Set<string>();

        // Update existing keys
        for (const line of lines) {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                if (updates[key] !== undefined) {
                    updatedLines.push(`${key}=${updates[key]}`);
                    seenKeys.add(key);
                } else {
                    updatedLines.push(line);
                }
            } else {
                updatedLines.push(line);
            }
        }

        // Add new keys
        for (const [key, value] of Object.entries(updates)) {
            if (!seenKeys.has(key)) {
                updatedLines.push(`${key}=${value}`);
            }
        }

        fs.writeFileSync(envPath, updatedLines.join('\n'), "utf-8");
        
        // Reload dotenv to reflect changes in current process process.env if possible.
        // process.env won't automatically update for already destructured things, 
        // but it will update process.env itself.
        Object.assign(process.env, updates);
        
        return true;
	} catch (error) {
		logger.error("Failed to update .env file:", error);
		return false;
	}
}

const SECRET_KEYS = new Set(["DISCORD_TOKEN", "CHALLONGE_TOKEN", "WEB_PASSWORD", "DOT_LOGGER_WEBHOOK"]);

// Keys this page may show or save. Anything else in the environment stays out.
const MANAGED_KEYS = [
    "CHALLONGE_USERNAME",
    "CHALLONGE_TOKEN",
    "DOT_DEFAULT_PREFIX",
    "DOT_DEFAULT_TO_ROLE",
    "DOT_PARTICIPANT_ROLE",
    "SQLITE_DB",
    "POSTGRESQL_URL",
    "WEB_PORT",
    "WEB_PASSWORD",
    "DOT_LOGGER_WEBHOOK",
    "DOT_REVISION"
];

// Helper to get parsed .env. Production injects these as process env and has no file.
function getParsedEnv(): Record<string, string> {
    const parsed: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
        Object.assign(parsed, dotenv.parse(fs.readFileSync(envPath, "utf-8")));
    }
    for (const key of MANAGED_KEYS) {
        if (parsed[key] === undefined && process.env[key] !== undefined) {
            parsed[key] = process.env[key] as string;
        }
    }
    return parsed;
}

// GET /config
router.get("/config", (req: Request, res: Response) => {
	try {
        const parsed = getParsedEnv();
        const configData: Record<string, string> = {};
        for (const key of MANAGED_KEYS) {
            if (parsed[key] === undefined || SECRET_KEYS.has(key)) continue;
            configData[key] = parsed[key];
        }

		res.render("config/index", {
			title: "Configuration",
			path: "/config",
			configData,
			success: req.query.success === "true",
			error: req.query.error,
			botRestart: req.query.botRestart === "true",
			serverRestart: req.query.serverRestart === "true"
		});
	} catch (error) {
		logger.error("Error fetching config:", error);
		res.status(500).render("error", {
			title: "500 - Server Error",
			message: "Failed to load configuration.",
			path: "/config"
		});
	}
});

// POST /config
router.post("/config", async (req: Request, res: Response) => {
	try {
        const body = req.body as Record<string, string>;
        for (const key of Object.keys(body)) {
            if (!MANAGED_KEYS.includes(key) || SECRET_KEYS.has(key)) {
                delete body[key];
            }
        }

        const oldEnv = getParsedEnv();

        let serverRestart = false;

        const success = updateEnv(body);

		if (success) {
            for (const [key, value] of Object.entries(body)) {
                if (oldEnv[key] !== value && key === "SQLITE_DB") {
                    serverRestart = true;
                }
            }
            if (body.DOT_DEFAULT_TO_ROLE && body.DOT_DEFAULT_TO_ROLE !== oldEnv.DOT_DEFAULT_TO_ROLE) {
                try {
                    const { OrganiserRoleProvider } = require("../../role/organiser") as typeof import("../../role/organiser");
                    const provider = new OrganiserRoleProvider(body.DOT_DEFAULT_TO_ROLE, 0x3498db);
                    for (const guild of getBotClient().guilds.cache.values()) {
                        await provider.get(guild);
                    }
                } catch (error) {
                    logger.warn("Saved TO role, but the live role was not created:", error);
                }
            }

            let redirectUrl = "/config?success=true";
            if (serverRestart) redirectUrl += "&serverRestart=true";

			res.redirect(redirectUrl);
		} else {
			res.redirect("/config?error=Failed to update configuration");
		}
	} catch (error) {
		logger.error("Error saving config:", error);
		res.redirect("/config?error=Server error while saving");
	}
});

export default router;
