import express, { Request, Response, NextFunction } from "express";
import path from "path";
import session from "express-session";
import { randomBytes, timingSafeEqual } from "crypto";
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
		csrfToken?: string;
	}
}

const logger = getLogger("web:server");

// Global bot client reference
let botClient: Client | null = null;

export function setBotClient(bot: Client): void {
	botClient = bot;
}

export function getBotClient(): Client {
	if (!botClient) {
		throw new Error("Bot client not initialized. Call setBotClient() first.");
	}
	return botClient;
}

/** Local redirect targets only: no scheme, no protocol-relative URLs. */
export function safeRedirectPath(candidate: unknown, fallback = "/tournaments"): string {
	if (typeof candidate !== "string" || candidate.length === 0) return fallback;
	if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
	if (candidate.includes("://")) return fallback;
	return candidate;
}

function constantTimeEqualsHex(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length || bufA.length === 0) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * In-memory login throttling. Adequate for the single-process desktop and
 * small-host deployments this project targets today; not shared across
 * replicas (documented in docs/improvement-status-backend.md).
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function loginRateLimited(key: string): boolean {
	const entry = loginAttempts.get(key);
	if (!entry) return false;
	if (entry.resetAt <= Date.now()) {
		loginAttempts.delete(key);
		return false;
	}
	return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string): void {
	const entry = loginAttempts.get(key);
	if (!entry || entry.resetAt <= Date.now()) {
		loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
		return;
	}
	entry.count += 1;
}

function clearLoginFailures(key: string): void {
	loginAttempts.delete(key);
}

const CSRF_HEADER = "X-CSRF-Token";
const CSRF_META_NAME = "csrf-token";

/** Routes that establish a session and are therefore CSRF-exempt. */
const CSRF_EXEMPT_PATHS = new Set(["/login", "/login/desktop"]);

function csrfFailure(req: Request, res: Response): void {
	if (req.path.startsWith("/api/")) {
		res.status(403).json({ success: false, error: "CSRF token missing or invalid" });
	} else {
		res.status(403).render("error", {
			title: "403 - Forbidden",
			message: "Your session token was missing or expired. Reload the page and try again.",
			path: req.path
		});
	}
}

function ensureCsrfToken(req: Request): string {
	if (!req.session.csrfToken) {
		req.session.csrfToken = randomBytes(32).toString("hex");
	}
	return req.session.csrfToken;
}

function csrfValid(req: Request): boolean {
	const presented = req.header(CSRF_HEADER) || (typeof req.body?._csrf === "string" ? req.body._csrf : undefined);
	const expected = req.session.csrfToken;
	if (!presented || !expected) return false;
	return constantTimeEqualsHex(presented, expected);
}

// One-time desktop bootstrap token. The Electron main process generates a
// fresh value per start; the server consumes it after a single use.
let bootstrapToken = process.env.MLBB_DESKTOP_BOOTSTRAP?.trim() || "";
let bootstrapConsumed = false;

export function desktopBootstrapConfigured(): boolean {
	return bootstrapToken.length > 0 && !bootstrapConsumed;
}

/** Exposed for tests; production code passes the token via environment only. */
export function setDesktopBootstrapToken(token: string): void {
	bootstrapToken = token.trim();
	bootstrapConsumed = false;
}

// Create Express app
export function createWebApp(): express.Express {
	const app = express();
	const config = getConfig();
	const httpsOnly = process.env.WEB_HTTPS === "true" || process.env.WEB_FORCE_HTTPS === "true";

	// A reverse proxy on the same host appears as loopback; only trust
	// X-Forwarded-* headers when the operator explicitly opts in.
	if (process.env.WEB_TRUST_PROXY === "true") {
		app.set("trust proxy", 1);
	}

	// Middleware
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.use(express.static(path.join(__dirname, "public")));

	// Session middleware. The secret must be independent of the login
	// password; when not configured, a per-start random secret is used and
	// sessions do not survive restarts (which is safe, merely inconvenient).
	const sessionSecret = process.env.WEB_SESSION_SECRET?.trim() || randomBytes(32).toString("hex");
	if (!process.env.WEB_SESSION_SECRET) {
		logger.warn("WEB_SESSION_SECRET is not set; using a random per-start session secret. Sessions will not survive restarts.");
	}
	if (process.env.NODE_ENV === "production") {
		logger.warn("Using the in-memory session store. Configure a persistent store before hosting multiple processes.");
	}
	app.use(session({
		secret: sessionSecret,
		resave: false,
		saveUninitialized: false,
		rolling: true,
		cookie: {
			maxAge: 24 * 60 * 60 * 1000, // 24 hours
			httpOnly: true,
			sameSite: "lax",
			secure: httpsOnly
		}
	}));

	// Every response can render the CSRF token into the layout meta tag.
	app.use((req: Request, res: Response, next: NextFunction) => {
		res.locals.csrfToken = req.session ? ensureCsrfToken(req) : "";
		res.locals.csrfMetaName = CSRF_META_NAME;
		next();
	});

	const isStaticAsset = (pathname: string): boolean =>
		pathname.startsWith("/css/") || pathname.startsWith("/js/") || pathname.startsWith("/img/") || pathname.startsWith("/favicon");

	// Login page
	app.get("/login", (req: Request, res: Response) => {
		if (req.session.authenticated) {
			return res.redirect("/tournaments");
		}
		res.render("login", { title: "Login", error: null });
	});

	// Login handler with throttling, session regeneration, and redirect validation
	app.post("/login", (req: Request, res: Response) => {
		const throttleKey = `password:${req.ip || "unknown"}`;
		if (loginRateLimited(throttleKey)) {
			return res.status(429).render("login", {
				title: "Login",
				error: "Too many attempts. Try again in a few minutes."
			});
		}

		const { password } = req.body;
		if (typeof password === "string" && password.length > 0 && password === config.webPassword) {
			req.session.regenerate(err => {
				if (err) {
					logger.error("Session regeneration failed:", err);
					return res.status(500).render("login", { title: "Login", error: "Login failed. Try again." });
				}
				req.session.authenticated = true;
				ensureCsrfToken(req);
				clearLoginFailures(throttleKey);
				const redirectTo = safeRedirectPath(req.body.redirect || req.query.redirect);
				return res.redirect(redirectTo);
			});
			return;
		}

		recordLoginFailure(throttleKey);
		res.render("login", { title: "Login", error: "Invalid password" });
	});

	// One-time desktop bootstrap exchange: no password, constant-time token
	// comparison, fresh session. Replaces the previous loopback IP bypass.
	const handleDesktopBootstrap = (req: Request, res: Response): void => {
		const throttleKey = `desktop:${req.ip || "unknown"}`;
		if (loginRateLimited(throttleKey)) {
			if (req.path.startsWith("/api/") || req.accepts(["html", "json"]) === "json") {
				res.status(429).json({ success: false, error: "Too many attempts. Try again in a few minutes." });
			} else {
				res.redirect("/login");
			}
			return;
		}

		const presented = String((req.body && req.body.token) || req.query.token || "");
		const valid = desktopBootstrapConfigured()
			&& typeof presented === "string"
			&& constantTimeEqualsHex(presented, bootstrapToken);

		if (!valid) {
			recordLoginFailure(throttleKey);
			logger.warn("Rejected desktop bootstrap attempt");
			if (req.method === "POST" && req.accepts(["html", "json"]) === "json") {
				res.status(401).json({ success: false, error: "Invalid or expired desktop session token" });
			} else {
				res.redirect("/login");
			}
			return;
		}

		// Single use: consume before establishing the session.
		bootstrapConsumed = true;
		req.session.regenerate(err => {
			if (err) {
				logger.error("Session regeneration failed during desktop bootstrap:", err);
				bootstrapConsumed = false;
				if (req.method === "POST" && req.accepts(["html", "json"]) === "json") {
					res.status(500).json({ success: false, error: "Login failed. Try again." });
				} else {
					res.redirect("/login");
				}
				return;
			}
			req.session.authenticated = true;
			ensureCsrfToken(req);
			clearLoginFailures(throttleKey);
			logger.notify("Desktop dashboard session established via bootstrap token");
			const redirectTo = safeRedirectPath((req.body && req.body.path) || req.query.path);
			if (req.method === "POST" && req.accepts(["html", "json"]) === "json") {
				res.status(303).json({ success: true, data: { redirectTo } });
			} else {
				res.redirect(303, redirectTo);
			}
		});
	};

	app.post("/login/desktop", handleDesktopBootstrap);
	app.get("/login/desktop", handleDesktopBootstrap);

	// CSRF token for clients that cannot render the meta tag (e.g. pure JSON pages)
	app.get("/api/csrf", (req: Request, res: Response) => {
		res.json({ success: true, data: { token: ensureCsrfToken(req), header: CSRF_HEADER } });
	});

	// Logout handler
	app.get("/logout", (req: Request, res: Response) => {
		req.session.destroy(() => {
			res.redirect("/login");
		});
	});

	// Auth middleware - protect everything except login, health, and static assets.
	// There is deliberately no IP-based bypass: a reverse proxy on the same
	// host would forward loopback connections.
	const authMiddleware = (req: Request, res: Response, next: NextFunction): void | Response => {
		const publicPaths = ["/login", "/login/desktop", "/api/health", "/api/csrf"];
		if (publicPaths.includes(req.path) || isStaticAsset(req.path)) {
			return next();
		}

		if (req.session.authenticated) {
			return next();
		}

		if (req.path.startsWith("/api/")) {
			return res.status(401).json({ success: false, error: "Authentication required" });
		}

		return res.redirect(`/login?redirect=${encodeURIComponent(safeRedirectPath(req.path, "/tournaments"))}`);
	};

	// CSRF middleware: state-changing requests must present the session token.
	const csrfMiddleware = (req: Request, res: Response, next: NextFunction): void | Response => {
		if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
		if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
		if (!req.session.authenticated) return next(); // auth middleware rejects first
		if (csrfValid(req)) return next();
		logger.warn(`CSRF rejection: ${req.method} ${req.path}`);
		return csrfFailure(req, res);
	};

	app.use(authMiddleware);
	app.use(csrfMiddleware);

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

	// Health check endpoint (liveness only; readiness lives in /api/system/readiness)
	app.get("/api/health", (req: Request, res: Response) => {
		res.json({ status: "ok", timestamp: new Date().toISOString() });
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

	// Privacy & retention page (guide 23); the view is owned by the dashboard
	app.get("/privacy", (req: Request, res: Response) => {
		res.render("privacy", { title: "Privacy & Retention", path: "/privacy" });
	});

	// Support & diagnostics page (guide 24); the view is owned by the dashboard
	app.get("/support", (req: Request, res: Response) => {
		res.render("support", { title: "Support & Diagnostics", path: "/support" });
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
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
		logger.error(`Error handling ${req.path}:`, err);
		if (req.path.startsWith("/api/")) {
			return res.status(500).json({ success: false, error: "Something went wrong. Please try again later." });
		}
		res.status(500).render("error", {
			title: "500 - Server Error",
			message: "Something went wrong. Please try again later.",
			path: req.path,
		});
	});

	return app;
}

export function createWebServer(): Promise<void> {
	const app = createWebApp();
	const config = getConfig();
	const port = config.webPort || 3000;
	const bindHost = process.env.WEB_BIND?.trim() || "127.0.0.1";

	// Start server. Loopback by default; network exposure is an explicit
	// deployment decision (WEB_BIND=0.0.0.0) and requires authentication.
	return new Promise<void>((resolve, reject) => {
		if (bindHost !== "127.0.0.1" && bindHost !== "localhost" && bindHost !== "::1") {
			logger.notify(`Web server binding to ${bindHost}. Network access is enabled; authentication is mandatory.`);
		}
		const server = app.listen(port, bindHost, () => {
			logger.notify(`Web server listening on ${bindHost}:${port}`);
			logger.notify(`Tournament admin available at http://localhost:${port}/tournaments`);
			resolve();
		});

		server.on("error", (err: Error) => {
			logger.error("Failed to start web server:", err);
			reject(err);
		});
	});
}
