import { getLogger } from "../../util/logger";

const logger = getLogger("email");

export type EmailFailureReason =
	| "missing-credentials"
	| "auth-failed"
	| "provider-rejected"
	| "timeout"
	| "network-error"
	| "invalid-address";

/** Typed delivery outcome so callers can never mistake silence for success. */
export type EmailResult =
	| { accepted: true; messageId?: string }
	| { accepted: false; reason: EmailFailureReason; detail: string };

export interface Credentials {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	tokenUri: string;
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS) > 0 ? Number(process.env.EMAIL_TIMEOUT_MS) : 15_000;

/** Bounded fetch: a hung provider must not stall a Discord command forever. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export function loadEmailCredentials(): Credentials | null {
	if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
		return {
			clientId: process.env.GOOGLE_CLIENT_ID,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET,
			refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
			tokenUri: process.env.GOOGLE_TOKEN_URI || "https://oauth2.googleapis.com/token"
		};
	}

	// Tests must never discover credentials on the developer machine.
	if (process.env.NODE_TEST_CONTEXT || process.env.MLBB_DISABLE_EMAIL_FILE === "1") return null;

	// Fallback to credentials.json for local development
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const path = require("path");

		let credentialsPath: string;

		if (process.platform === "win32") {
			// Windows path
			credentialsPath = "C:/mlbb-data/credentials/credentials.json";
		} else {
			// Mac/Linux - use relative path from project root
			credentialsPath = path.join(__dirname, "../../../credentials.json");
		}

		return require(credentialsPath);
	} catch {
		return null;
	}
}

function currentCredentials(): Credentials | null {
	return loadEmailCredentials();
}

let access_token = "";
let expiry: Date = new Date(Date.now() - 120 * 1000);

function isTokenExpired(): boolean {
	const currentTime = new Date();
	return expiry < currentTime;
}

class EmailError extends Error {
	constructor(readonly reason: EmailFailureReason, message: string) {
		super(message);
	}
}

/** Refreshes the OAuth token or throws a controlled error; never returns silently. */
async function refreshAccessToken(): Promise<void> {
	if (!isTokenExpired()) return;

	const credentials = currentCredentials();
	if (!credentials) {
		throw new EmailError("missing-credentials", "Email credentials are not configured");
	}

	logger.info("Google API access token expired. Refreshing token.");

	const payload = new URLSearchParams({
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		refresh_token: credentials.refreshToken,
		grant_type: "refresh_token"
	});

	let response: Response;
	try {
		response = await fetchWithTimeout(credentials.tokenUri, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: payload.toString()
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new EmailError("timeout", "Timed out refreshing email access token");
		}
		throw new EmailError("network-error", "Could not reach the email token endpoint");
	}

	if (!response.ok) {
		// 4xx from the token endpoint means the authorisation is no longer valid.
		throw new EmailError(
			"auth-failed",
			response.status >= 500 ? "Email token endpoint unavailable" : "Email authorisation expired or was revoked"
		);
	}

	const responseJson = await response.json() as { access_token: string; expires_in: number };
	access_token = responseJson.access_token;
	const expiry_in: number = responseJson.expires_in;
	expiry = new Date(Date.now() + (expiry_in - 180) * 1000);
}

export function isEmailConfigured(): boolean {
	return currentCredentials() !== null;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/**
 * Sends a one-time code email and reports the provider's acceptance.
 * Acceptance by the provider is not inbox delivery; callers must word
 * participant messages accordingly.
 */
export async function sendOtpEmail(to: string, otp: string): Promise<EmailResult> {
	return sendEmailMessage(to, "OTP for Discord Verification", `Your OTP for Discord Verification is: ${otp}`);
}

/** Sends an arbitrary plain-text email with the same typed result contract. */
export async function sendEmailMessage(to: string, subject: string, message: string): Promise<EmailResult> {
	if (!EMAIL_ADDRESS_PATTERN.test(to)) {
		return { accepted: false, reason: "invalid-address", detail: "The email address is not valid" };
	}
	const credentials = currentCredentials();
	if (!credentials) {
		logger.error("Cannot send email: Google credentials are not configured");
		return {
			accepted: false,
			reason: "missing-credentials",
			detail: "Email is not configured; ask an organiser to complete email setup"
		};
	}

	try {
		await refreshAccessToken();
	} catch (error) {
		if (error instanceof EmailError) {
			logger.error(`Email token refresh failed (${error.reason}): ${error.message}`);
			return { accepted: false, reason: error.reason, detail: error.message };
		}
		logger.error("Email token refresh failed:", error);
		return { accepted: false, reason: "auth-failed", detail: "Email authorisation could not be refreshed" };
	}

	const sender = process.env.EMAIL_SENDER_ADDRESS || "leagueops@nodwin.com";
	const messageBytes = `From: ${sender}\nTo: ${to}\nSubject: ${subject}\n\n${message}`;

	const base64Encoded = Buffer.from(messageBytes)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	const payload = { raw: base64Encoded };

	try {
		const response = await fetchWithTimeout("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${access_token}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		});

		if (response.ok) {
			const body = await response.json().catch(() => ({}));
			logger.info(`Mail accepted by provider for: ${to}, Subject: ${subject}`);
			return { accepted: true, messageId: (body as { id?: string }).id };
		}

		const detail = response.status >= 500
			? "The email provider is temporarily unavailable"
			: "The email provider rejected the message";
		logger.error(`Provider rejected email to ${to} with status ${response.status}`);
		return { accepted: false, reason: "provider-rejected", detail };
	} catch (error) {
		if (isAbortError(error)) {
			logger.error(`Timed out sending email to ${to}`);
			return { accepted: false, reason: "timeout", detail: "The email provider did not respond in time" };
		}
		logger.error(`Exception while sending email to ${to}:`, error);
		return { accepted: false, reason: "network-error", detail: "Could not reach the email provider" };
	}
}
