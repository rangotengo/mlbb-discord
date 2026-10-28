import { updateEnvContent } from "../../config/envFile";
import { EDITABLE_SETTINGS, RestartRequirement, validateSettings } from "../../config/settings";
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { getLogger } from "../../util/logger";
import dotenv from "dotenv";
import { UserError } from "../../util/errors";

const router = Router();
const logger = getLogger("web:routes:config");

const envPath = process.env.DOTENV_CONFIG_PATH || path.resolve(process.cwd(), ".env");

function updateEnv(updates: Record<string, string>): boolean {
	try {
		let envFileContent = "";
		if (fs.existsSync(envPath)) {
			envFileContent = fs.readFileSync(envPath, "utf-8");
		}
		const temporary = `${envPath}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, updateEnvContent(envFileContent, updates), "utf-8");
		fs.renameSync(temporary, envPath);
		dotenv.config({ path: envPath, override: true, quiet: true });
		return true;
	} catch (error) {
		logger.error("Failed to update .env file:", error);
		return false;
	}
}

function getParsedEnv(): Record<string, string> {
	if (!fs.existsSync(envPath)) return {};
	return dotenv.parse(fs.readFileSync(envPath, "utf-8"));
}

function restartFor(changes: string[]): RestartRequirement {
	let restart: RestartRequirement = "none";
	for (const key of changes) {
		const requirement = EDITABLE_SETTINGS.find(setting => setting.key === key)?.restart || "none";
		if (requirement === "server") return "server";
		if (requirement === "bot") restart = "bot";
	}
	return restart;
}

function configFields(parsed: Record<string, string>): Array<{ key: string; label: string; description: string; value: string; configured: boolean; secret: boolean; restart: RestartRequirement }> {
	return EDITABLE_SETTINGS.map(setting => ({
		key: setting.key,
		label: setting.label,
		description: setting.description,
		value: setting.secret ? "" : parsed[setting.key] || "",
		configured: Boolean(parsed[setting.key]),
		secret: setting.secret,
		restart: setting.restart
	}));
}

router.get("/config", (req: Request, res: Response) => {
	try {
		const parsed = getParsedEnv();
		const fields = configFields(parsed);
		const configData: Record<string, string> = {};
		for (const field of fields) {
			if (!field.secret) configData[field.key] = field.value;
		}
		res.render("config/index", {
			title: "Configuration",
			path: "/config",
			fields,
			configData,
			success: req.query.success === "true",
			error: typeof req.query.error === "string" ? req.query.error : undefined,
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

router.get("/api/config", (req: Request, res: Response) => {
	res.json({ success: true, data: { fields: configFields(getParsedEnv()) } });
});

router.post("/config", (req: Request, res: Response) => {
	try {
		const body = req.body && typeof req.body === "object" ? { ...req.body as Record<string, unknown> } : {};
		delete body.DISCORD_TOKEN;
		delete body._csrf;
		const current = getParsedEnv();
		const invalid = validateSettings(body, current);
		if (invalid) {
			res.redirect(`/config?error=${encodeURIComponent(invalid)}`);
			return;
		}

		const updates: Record<string, string> = {};
		const changed: string[] = [];
		for (const [key, value] of Object.entries(body)) {
			if (typeof value !== "string") continue;
			const setting = EDITABLE_SETTINGS.find(item => item.key === key);
			if (!setting || (setting.secret && value === "")) continue;
			updates[key] = value;
			if ((current[key] || "") !== value) changed.push(key);
		}

		if (!updateEnv(updates)) {
			res.redirect("/config?error=Failed%20to%20update%20configuration");
			return;
		}

		const restart = restartFor(changed);
		const params = new URLSearchParams({ success: "true" });
		if (restart === "server") params.set("serverRestart", "true");
		else if (restart === "bot") params.set("botRestart", "true");
		res.redirect(`/config?${params.toString()}`);
	} catch (error) {
		logger.error("Error saving config:", error);
		const message = error instanceof UserError ? error.message : "Server error while saving";
		res.redirect(`/config?error=${encodeURIComponent(message)}`);
	}
});

export default router;
