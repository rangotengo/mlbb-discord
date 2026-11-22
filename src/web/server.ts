import { getCommandReference } from "./commandReference";
import { ALLOWED_CATEGORY_ID } from "../util/channelScope";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import session from "express-session";
import { Client } from "discord.js";
import { getConfig } from "../config";
import { getLogger } from "../util/logger";
import tournamentRoutes from "./routes/tournaments";
import participantRoutes from "./routes/participants";
import scheduleRoutes from "./routes/schedules";
import roundRoutes from "./routes/rounds";
import systemRoutes from "./routes/system";
import configRoutes from "./routes/config";
import playersRoutes from "./routes/players";
import expressLayouts from "express-ejs-layouts";

// Extend express-session types
declare module "express-session" {
	interface SessionData {
		authenticated: boolean;
	}
}

const logger = getLogger("web:server");

// Global bot client reference
let botClient: Client | null = null;

export function setBotClient(bot: Client) {
	botClient = bot;
}

export function getBotClient(): Client {
	if (!botClient) {
		throw new Error("Bot client not initialized. Call setBotClient() first.");
	}
	return botClient;
}

// Create Express app
export function createWebServer() {
	const app = express();
	const config = getConfig();
	const port = config.webPort || 3000;

	// Middleware
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.use(express.static(path.join(__dirname, "public")));

	// Session middleware
	app.use(session({
		secret: config.webPassword || "dot-tournament-secret",
		resave: false,
		saveUninitialized: false,
		cookie: {
			maxAge: 24 * 60 * 60 * 1000 // 24 hours
		}
	}));

	// Auth middleware - protect all routes except login and static assets
	const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
		// Skip auth for login routes and static assets
		const publicPaths = ["/login", "/api/health"];
		if (publicPaths.includes(req.path) || req.path.startsWith("/css/") || req.path.startsWith("/js/")) {
			return next();
		}

		// Skip auth for localhost requests (Electron app)
		const clientIp = req.ip || req.socket.remoteAddress || "";
		if (clientIp === "::1" || clientIp === "127.0.0.1" || clientIp === "::ffff:127.0.0.1") {
			return next();
		}

		// Check if authenticated
		if (req.session.authenticated) {
			return next();
		}

		// Redirect to login
		return res.redirect("/login");
	};

	// Login page
	app.get("/login", (req: Request, res: Response) => {
		if (req.session.authenticated) {
			return res.redirect("/tournaments");
		}
		res.render("login", { title: "Login", error: null });
	});

	// Login handler
	app.post("/login", (req: Request, res: Response) => {
		const { password } = req.body;

		if (password === config.webPassword) {
			req.session.authenticated = true;
			const redirectTo = (req.query.redirect as string) || "/tournaments";
			return res.redirect(redirectTo);
		}

		res.render("login", { title: "Login", error: "Invalid password" });
	});

	// Logout handler
	app.get("/logout", (req: Request, res: Response) => {
		req.session.destroy(() => {
			res.redirect("/login");
		});
	});

	// Apply auth middleware to all routes
	app.use(authMiddleware);

	// Set EJS as view engine
	app.use(expressLayouts);
	app.set("view engine", "ejs");
	app.set("views", path.join(__dirname, "views"));
	app.set("layout", "layout");
	// Disable view cache in development for easier template editing
	app.set("view cache", false);

	// Make common variables available to all views
	app.use((req: Request, res: Response, next: NextFunction) => {
		res.locals.path = req.path;
		res.locals.title = "Dot Tournament Admin";
		next();
	});

	// Request logging middleware
	app.use((req: Request, res: Response, next: NextFunction) => {
		logger.verbose(`${req.method} ${req.path}`);
		next();
	});

	// Health check endpoint
	app.get("/api/health", (req: Request, res: Response) => {
		res.json({ status: "ok", timestamp: new Date().toISOString() });
	});

	app.get("/commands", (_req: Request, res: Response) => {
		res.render("commands", {
			title: "Commands", path: "/commands", commands: getCommandReference(getConfig().defaultPrefix),
			categoryId: ALLOWED_CATEGORY_ID
		});
	});

	// Tournament routes
	app.use(tournamentRoutes);

	// Participant routes
	app.use(participantRoutes);

	// Schedule routes
	app.use(scheduleRoutes);

	// Round routes
	app.use(roundRoutes);

	// System routes
	app.use(systemRoutes);

	// Config routes
	app.use(configRoutes);

	// Players routes
	app.use(playersRoutes);

	// Redirect root to tournaments
	app.get("/", (req: Request, res: Response) => {
		res.redirect("/tournaments");
	});

	// System status page
	app.get("/system", (req: Request, res: Response) => {
		res.render("system", {
			title: "System Status",
			path: "/system",
		});
	});

	// 404 handler
	app.use((req: Request, res: Response) => {
		res.status(404).render("error", {
			title: "404 - Page Not Found",
			message: "The page you're looking for doesn't exist.",
			path: req.path,
		});
	});

	// Error handler
	app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
		logger.error(`Error handling ${req.path}:`, err);
		res.status(500).render("error", {
			title: "500 - Server Error",
			message: "Something went wrong. Please try again later.",
			path: req.path,
		});
	});

	// Start server
	return new Promise<void>((resolve, reject) => {
		const server = app.listen(port, () => {
			logger.notify(`Web server listening on port ${port}`);
			logger.notify(`Tournament admin available at http://localhost:${port}/tournaments`);
			resolve();
		});

		server.on("error", (err: Error) => {
			logger.error("Failed to start web server:", err);
			reject(err);
		});
	});
}
