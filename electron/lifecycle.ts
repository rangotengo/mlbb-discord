import { ChildProcess } from 'child_process';

/**
 * Process lifecycle helpers that do not import Electron, so tests can exercise
 * them without launching a desktop runtime (guides 7.3 and 25).
 */

export interface ShutdownResult {
	signalled: 'SIGTERM' | 'SIGKILL' | 'none';
	reason: string;
}

/**
 * Asks a child to exit. SIGTERM first — the bot handles it in src/index.ts.
 * The caller arms a timer and invokes `forceKill` if the child is still alive.
 */
export function requestShutdown(child: ChildProcess | null, forceKill: (child: ChildProcess) => void, graceMs = 5000): ShutdownResult {
	if (!child || child.killed || child.exitCode !== null) {
		return { signalled: 'none', reason: 'No bot process is running.' };
	}
	try {
		child.kill('SIGTERM');
	} catch {
		return { signalled: 'none', reason: 'The bot process could not be signalled.' };
	}
	const timer = setTimeout(() => {
		if (child.exitCode === null && !child.killed) {
			try {
				forceKill(child);
			} catch {
				// Already gone.
			}
		}
	}, graceMs);
	child.once('exit', () => clearTimeout(timer));
	return { signalled: 'SIGTERM', reason: `Stop requested. The process is forced to exit after ${graceMs}ms if it does not stop.` };
}

export interface SingleInstanceDecision {
	proceed: boolean;
	focusExisting: boolean;
	message: string;
}

/** A second OS process must not open the same SQLite file (guide 7.3 / 25). */
export function decideSingleInstance(gotLock: boolean): SingleInstanceDecision {
	if (gotLock) {
		return {
			proceed: true,
			focusExisting: false,
			message: 'This is the only desktop instance.'
		};
	}
	return {
		proceed: false,
		focusExisting: true,
		message: 'MLBB Tournament Bot is already running. The existing window was focused so a second bot cannot open the same local database.'
	};
}

export type CloseAction = 'hide' | 'quit' | 'ignore';

/**
 * Window close is not shutdown. On macOS the window hides and the bot keeps
 * running; Quit (before-quit) stops the bot. A programmatic shutdown sets
 * `quitting` so the window can close.
 */
export function decideWindowClose(platform: NodeJS.Platform, quitting: boolean): CloseAction {
	if (quitting) return 'quit';
	if (platform === 'darwin') return 'hide';
	return 'quit';
}
