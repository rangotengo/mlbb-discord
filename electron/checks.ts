import { BotConfig } from './config';
import { ValidationError, validateConfig } from './config-validator';

/**
 * Independent setup checks (guide 9).
 *
 * Each check validates one integration with the same rules as startup.
 * Checks that need the running bot are reported as unavailable until the
 * backend owner lands the endpoint — they are never reported as passed.
 */

export type CheckState = 'pass' | 'fail' | 'unavailable' | 'not-checked';

export interface SetupCheck {
	id: string;
	label: string;
	state: CheckState;
	message: string;
	recovery?: string;
}

export interface ReadinessPayload {
	discord?: { ready?: boolean; guilds?: number; detail?: string };
	database?: { ok?: boolean; engine?: string; detail?: string };
	challengermode?: { ok?: boolean | null; lastSuccess?: string | null; detail?: string };
	email?: { configured?: boolean; lastResult?: 'accepted' | 'failed' | null; detail?: string };
	web?: { bind?: string; port?: number };
	buildVersion?: string;
}

const STEP_FIELDS: Record<string, string[]> = {
	discord: ['discord-token'],
	challengermode: ['challengermode-refresh-key'],
	storage: ['database-type', 'database-url', 'database-path'],
	dashboard: ['web-port', 'web-password', 'web-network']
};

export function localChecks(config: BotConfig): SetupCheck[] {
	const errors = validateConfig(config);
	const byField = new Map<string, ValidationError[]>();
	for (const error of errors) {
		const list = byField.get(error.field) ?? [];
		list.push(error);
		byField.set(error.field, list);
	}

	const discordErrors = errorsFor(byField, STEP_FIELDS.discord);
	const cmErrors = errorsFor(byField, STEP_FIELDS.challengermode);
	const storageErrors = errorsFor(byField, STEP_FIELDS.storage);
	const dashboardErrors = errorsFor(byField, STEP_FIELDS.dashboard);

	return [
		{
			id: 'discord',
			label: 'Discord connection',
			state: discordErrors.length ? 'fail' : 'pass',
			message: discordErrors.length
				? discordErrors.map(error => error.message).join(' ')
				: 'A Discord bot token is present. The bot still has to log in before the server list can be confirmed.',
			recovery: discordErrors[0]?.recovery
		},
		{
			id: 'server',
			label: 'Discord server',
			state: 'not-checked',
			message: 'Server, channel, and role checks run after the bot is connected. They are not counted as passed yet.',
			recovery: 'Start the bot, invite it to the server, then run the readiness check.'
		},
		{
			id: 'challengermode',
			label: 'Challengermode access',
			state: cmErrors.length ? 'fail' : 'not-checked',
			message: cmErrors.length
				? cmErrors.map(error => error.message).join(' ')
				: 'A refresh key is saved. This does not contact Challengermode; the integration stays read-only.',
			recovery: cmErrors[0]?.recovery ?? 'Use !sync after the bot is online. A failed sync is a setup problem, not a successful connection.'
		},
		{
			id: 'email',
			label: 'Email delivery',
			state: config.email?.configured ? 'not-checked' : 'fail',
			message: config.email?.configured
				? 'Email credentials are stored. Delivery has not been tested in this session.'
				: 'Email credentials are not stored. Participants cannot receive verification codes until email is configured.',
			recovery: 'Add the Google OAuth client id, secret, and refresh token, then send a test message once the bot offers that action.'
		},
		{
			id: 'storage',
			label: 'Storage',
			state: storageErrors.length ? 'fail' : 'pass',
			message: storageErrors.length
				? storageErrors.map(error => error.message).join(' ')
				: config.database.type === 'sqlite'
					? 'SQLite will be used. One desktop instance may open the file.'
					: 'PostgreSQL is selected. The desktop app does not file-copy that database during upgrades.',
			recovery: storageErrors[0]?.recovery
		},
		{
			id: 'dashboard',
			label: 'Dashboard access',
			state: dashboardErrors.length ? 'fail' : 'pass',
			message: dashboardErrors.length
				? dashboardErrors.map(error => error.message).join(' ')
				: config.web.allowNetwork
					? 'Network access is on. A password is required and the dashboard will not trust loopback alone.'
					: 'The dashboard listens on this computer only until you explicitly enable network access.',
			recovery: dashboardErrors[0]?.recovery
		}
	];
}

function errorsFor(byField: Map<string, ValidationError[]>, fields: string[]): ValidationError[] {
	return fields.flatMap(field => byField.get(field) ?? []);
}

/** Maps a live readiness payload. Null integration results stay "not checked". */
export function interpretReadiness(payload: ReadinessPayload | null, available: boolean): SetupCheck[] {
	if (!available || !payload) {
		return [{
			id: 'readiness',
			label: 'Live readiness',
			state: 'unavailable',
			message: 'Not available in this build. The bot does not expose readiness diagnostics yet.',
			recovery: 'Use the local checklist and the bot logs. Do not treat a running process as a ready tournament.'
		}];
	}

	const checks: SetupCheck[] = [];
	const discord = payload.discord;
	checks.push({
		id: 'discord-live',
		label: 'Discord connection',
		state: discord?.ready ? 'pass' : 'fail',
		message: discord?.ready
			? `Connected${typeof discord.guilds === 'number' ? ` to ${discord.guilds} server(s)` : ''}.`
			: (discord?.detail || 'The bot process is up, but Discord is not ready.'),
		recovery: 'Check the bot token and that the bot has been invited. Restart after replacing the token.'
	});

	const database = payload.database;
	checks.push({
		id: 'database-live',
		label: 'Database',
		state: database?.ok ? 'pass' : 'fail',
		message: database?.ok
			? `Database responded (${database.engine || 'unknown engine'}).`
			: (database?.detail || 'The database did not respond.'),
		recovery: 'Stop the app and confirm the database file or PostgreSQL URL. Restore the newest backup if the file is damaged.'
	});

	const cm = payload.challengermode;
	checks.push({
		id: 'challengermode-live',
		label: 'Challengermode',
		state: cm?.ok === true ? 'pass' : cm?.ok === false ? 'fail' : 'not-checked',
		message: cm?.ok === null || cm?.ok === undefined
			? 'Not checked yet. Readiness does not call Challengermode on every poll.'
			: cm.ok
				? `Last successful read${cm.lastSuccess ? ` at ${cm.lastSuccess}` : ''}.`
				: (cm.detail || 'The last Challengermode read failed.'),
		recovery: 'Confirm the application refresh key, then use sync from the dashboard. The bot never writes tournament data remotely. A null result means no sync has been attempted yet.'
	});

	const email = payload.email;
	checks.push({
		id: 'email-live',
		label: 'Email',
		state: !email?.configured ? 'fail' : email.lastResult === 'accepted' ? 'pass' : email.lastResult === 'failed' ? 'fail' : 'not-checked',
		message: !email?.configured
			? 'Email is not configured.'
			: email.lastResult === null || email.lastResult === undefined
				? 'Credentials are stored. No test send has been recorded.'
				: (email.detail || `Last result: ${email.lastResult}.`),
		recovery: 'Send a test email from setup. A missing credential, rejection, or timeout is a failure, not a sent code.'
	});

	return checks;
}

export interface EmailTestResult {
	accepted?: boolean;
	reason?: string;
	detail?: string;
}

export function interpretEmailTest(result: EmailTestResult | null, available: boolean): SetupCheck {
	if (!available || !result) {
		return {
			id: 'email-test',
			label: 'Test email',
			state: 'unavailable',
			message: 'Not available in this build. The bot does not expose a setup test send yet.',
			recovery: 'Configure the Google OAuth values, restart, and confirm a participant code only after the bot reports that the provider accepted it.'
		};
	}
	if (result.accepted) {
		return {
			id: 'email-test',
			label: 'Test email',
			state: 'pass',
			message: result.detail || 'The provider accepted the test message. That confirms submission, not that it reached the inbox.'
		};
	}
	return {
		id: 'email-test',
		label: 'Test email',
		state: 'fail',
		message: result.detail || 'The test message was not accepted.',
		recovery: recoveryForEmail(result.reason)
	};
}

function recoveryForEmail(reason: string | undefined): string {
	switch (reason) {
		case 'missing-credentials':
			return 'Enter the Google client id, client secret, and refresh token, then try again.';
		case 'auth-failed':
			return 'The refresh token was rejected. Generate a new one and replace the stored secret.';
		case 'provider-rejected':
			return 'Gmail refused the message. Check the sender and the destination address.';
		case 'timeout':
			return 'The provider did not answer in time. Try again before changing credentials.';
		case 'invalid-address':
			return 'Enter a full email address such as organiser@example.com.';
		default:
			return 'Read the detail, fix the reported cause, and send the test again. Do not tell participants a code was sent.';
	}
}
