import util from "util";
import debug, { Debug } from "debug";
import { WebhookClient } from "discord.js";

const globalDebug = debug("dot");

const webhook = process.env.DOT_LOGGER_WEBHOOK ? new WebhookClient({ url: process.env.DOT_LOGGER_WEBHOOK }) : null;

// In-memory log buffer
const MAX_LOGS = 100;
const logBuffer: { timestamp: string, namespace: string, message: string }[] = [];

export function getRecentLogs(): { timestamp: string; namespace: string; message: string }[] {
	return [...logBuffer];
}

function withWebhook(log: debug.Debugger): Debug["log"] {
	return function (...args: Parameters<debug.Debugger>) {
		const message = util.format(...args);
		
		// Push to buffer
		logBuffer.push({
			timestamp: new Date().toISOString(),
			namespace: log.namespace,
			message
		});
		if (logBuffer.length > MAX_LOGS) {
			logBuffer.shift();
		}

		// Console output
		log(...args);

		// Webhook output
		if (webhook) {
			webhook
				.send({
					username: log.namespace,
					content: message,
					allowedMentions: { parse: [] }
				})
				.catch(error => {
					// Don't use the same log function to avoid infinite loop
					console.error("Failed to notify webhook.", error);
				});
		}
	};
}

export interface Logger {
	error: Debug["log"];
	warn: Debug["log"];
	notify: Debug["log"];
	info: Debug["log"];
	verbose: Debug["log"];
}

export function getLogger(namespace: string): Logger {
	const debugInfo = globalDebug.extend(`info:${namespace}`);
	const debugVerbose = globalDebug.extend(`verbose:${namespace}`);

	return {
		error: withWebhook(globalDebug.extend(`error:${namespace}`)),
		warn: withWebhook(globalDebug.extend(`warn:${namespace}`)),
		notify: withWebhook(globalDebug.extend(`notify:${namespace}`)),
		// info and verbose were not using withWebhook before, 
		// but we probably want them in the log buffer too
		info: withWebhook(debugInfo),
		verbose: withWebhook(debugVerbose)
	};
}
