/* global module */
// Dot Tournament Dashboard - pure helper logic
// This file intentionally avoids DOM access so it can also run in tests.
// It is loaded before app.js in the browser and exposed as Dot.Helpers.

(function (global) {
	'use strict';

	// ── CSV parsing (RFC4180-ish: quoted fields, escaped quotes, embedded newlines) ──

	function parseCsv(text) {
		if (typeof text !== 'string' || text.length === 0) return { headers: [], rows: [] };
		const records = [];
		let field = '';
		let record = [];
		let inQuotes = false;

		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			if (inQuotes) {
				if (char === '"') {
					if (text[i + 1] === '"') {
						field += '"';
						i++;
					} else {
						inQuotes = false;
					}
				} else {
					field += char;
				}
			} else if (char === '"') {
				inQuotes = true;
			} else if (char === ',') {
				record.push(field);
				field = '';
			} else if (char === '\n') {
				record.push(field);
				records.push(record);
				record = [];
				field = '';
			} else if (char === '\r') {
				// ignore: handle \r\n
			} else {
				field += char;
			}
		}
		record.push(field);
		records.push(record);

		// Drop fully empty trailing records (trailing newline)
		while (records.length > 0 && records[records.length - 1].every((c) => c.trim() === '')) {
			records.pop();
		}

		const headers = (records.shift() || []).map((h) => h.trim());
		const rows = records.map((r, idx) => ({
			number: idx + 2, // 1-based file line for humans (header is line 1)
			cells: r,
			values: toObject(headers, r)
		}));
		return { headers, rows };
	}

	function toObject(headers, cells) {
		const obj = {};
		headers.forEach((h, i) => {
			obj[h.toLowerCase()] = (cells[i] !== undefined ? cells[i] : '').trim();
		});
		return obj;
	}

	function csvEscape(value) {
		if (value === null || value === undefined) return '';
		const str = String(value);
		if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
			return `"${  str.replace(/"/g, '""')  }"`;
		}
		return str;
	}

	function buildCsv(a, b) {
		let headers = [];
		let rows = [];

		if (Array.isArray(a) && a.length > 0 && typeof a[0] === 'object' && !Array.isArray(a[0])) {
			rows = a;
			headers = Array.isArray(b) ? b : Object.keys(rows[0]);
			const arrayRows = rows.map((r) => headers.map((h) => (r[h] !== undefined ? r[h] : '')));
			return [headers.map(csvEscape).join(',')].concat(arrayRows.map((r) => r.map(csvEscape).join(','))).join('\r\n');
		} else if (Array.isArray(a)) {
			headers = a;
			rows = Array.isArray(b) ? b : [];
			if (rows.length > 0 && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
				const arrayRows = rows.map((r) => headers.map((h) => (r[h] !== undefined ? r[h] : '')));
				return [headers.map(csvEscape).join(',')].concat(arrayRows.map((r) => r.map(csvEscape).join(','))).join('\r\n');
			}
			return [headers.map(csvEscape).join(',')].concat(rows.map((r) => r.map(csvEscape).join(','))).join('\r\n');
		}
		return '';
	}

	// ── Import preview classification (guide 13) ──
	// existing: array of participant records {email,name,team,discordUsername,verified}
	// Returns { added, changed, unchanged, rejected:[{row,reason}], rows:[{row,status,...}] }

	function classifyParticipantImport(parsed, existing) {
		const byEmail = new Map();
		(existing || []).forEach((p) => {
			if (p && p.email) byEmail.set(p.email.toLowerCase(), p);
		});

		const rejected = [];
		const summary = { added: 0, changed: 0, unchanged: 0, rejected: 0 };
		const rows = (parsed.rows || []).map((r) => {
			const v = r.values;
			const email = (v['email'] || '').toLowerCase();
			if (!v['email']) {
				rejected.push({ row: r.number, reason: 'Missing email' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'Missing email' };
			}
			if (!v['name']) {
				rejected.push({ row: r.number, reason: 'Missing captain name' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'Missing captain name' };
			}
			if (!v['team']) {
				rejected.push({ row: r.number, reason: 'Missing team name' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'Missing team name' };
			}
			if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v['email'])) {
				rejected.push({ row: r.number, reason: 'Invalid email address' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'Invalid email address' };
			}
			const prev = byEmail.get(email);
			if (!prev) {
				summary.added++;
				return { ...r, status: 'added', email, team: v['team'], name: v['name'] };
			}
			const changed =
				(prev.name || '') !== v['name'] ||
				(prev.team || '') !== v['team'] ||
				(prev.discordUsername || '') !== (v['discord username'] || v['discordusername'] || v['discord'] || '');
			if (changed) summary.changed++;
			else summary.unchanged++;
			return { ...r, status: changed ? 'changed' : 'unchanged', email, team: v['team'], name: v['name'] };
		});

		return { summary, rows, rejected };
	}

	function classifyScheduleImport(parsed, existing) {
		const byMatch = new Map();
		(existing || []).forEach((s) => {
			if (s && s.matchId) byMatch.set(String(s.matchId).toLowerCase(), s);
		});

		const rejected = [];
		const summary = { added: 0, changed: 0, unchanged: 0, rejected: 0 };
		const rows = (parsed.rows || []).map((r) => {
			const v = r.values;
			const matchId = (v['match_id'] || v['matchid'] || '').toLowerCase();
			const time = v['scheduled_time'] || v['scheduledtime'] || v['time'] || v['date'] || '';
			if (!matchId) {
				rejected.push({ row: r.number, reason: 'Missing match_id' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'Missing match_id' };
			}
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(matchId)) {
				rejected.push({ row: r.number, reason: 'match_id is not a UUID' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'match_id is not a UUID' };
			}
			if (!time) {
				rejected.push({ row: r.number, reason: 'Missing scheduled_time' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'Missing scheduled_time' };
			}
			const isoTime = time.includes('T') ? time : time.replace(' ', 'T');
			const parsedTimeStr = (isoTime.endsWith('Z') || /[+-]\d{2}(?::?\d{2})?$/.test(isoTime)) ? isoTime : `${isoTime  }Z`;
			const next = new Date(parsedTimeStr);
			if (isNaN(next.getTime())) {
				rejected.push({ row: r.number, reason: 'scheduled_time is not a valid date/time' });
				summary.rejected++;
				return { ...r, status: 'rejected', reason: 'scheduled_time is not a valid date/time' };
			}
			const prev = byMatch.get(matchId);
			if (!prev) {
				summary.added++;
				return { ...r, status: 'added', matchId };
			}
			const prevTime = prev.scheduledTime ? new Date(prev.scheduledTime) : null;
			const changed = !prevTime || prevTime.getTime() !== next.getTime();
			if (changed) summary.changed++;
			else summary.unchanged++;
			return { ...r, status: changed ? 'changed' : 'unchanged', matchId };
		});

		return { summary, rows, rejected };
	}

	// ── Timezones and scheduling labels (guide 14) ──

	const UNSCHEDULED_YEAR = 2090; // sentinel guard: dates beyond this are "not set"

	function isUnscheduled(value) {
		if (!value) return true;
		const d = value instanceof Date ? value : new Date(value);
		if (isNaN(d.getTime())) return true;
		return d.getUTCFullYear() >= UNSCHEDULED_YEAR;
	}

	function offsetLabel(timeZone, at) {
		try {
			const date = at ? new Date(at) : new Date();
			const formatted = new Intl.DateTimeFormat('en-AU', {
				timeZone,
				timeZoneName: 'shortOffset'
			}).format(date);
			const match = formatted.match(/GMT[+-]?\d*(?::\d+)?/);
			return (match ? match[0] : '').replace('GMT', 'UTC') || 'UTC';
		} catch {
			return 'UTC';
		}
	}

	function formatInstant(value, options) {
		if (isUnscheduled(value)) return null;
		const opts = options || {};
		const d = value instanceof Date ? value : new Date(value);
		try {
			return new Intl.DateTimeFormat(opts.locale || 'default', {
				timeZone: opts.timeZone,
				weekday: opts.weekday === false ? undefined : 'short',
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit',
				year: opts.year === false ? undefined : 'numeric'
			}).format(d);
		} catch {
			return d.toISOString();
		}
	}

	// ── Calendar export (guide 31, client-side .ics) ──

	function icsEscape(text) {
		return String(text === null || text === undefined ? '' : text)
			.replace(/\\/g, '\\\\')
			.replace(/;/g, '\\;')
			.replace(/,/g, '\\,')
			.replace(/\r?\n/g, '\\n');
	}

	function icsStamp(date) {
		return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	}

	function generateIcs(tournament, schedules) {
		const now = new Date();
		const lines = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//MLBB Tournament Bot//Dashboard//EN',
			'CALSCALE:GREGORIAN',
			`X-WR-CALNAME:${icsEscape(tournament.name || tournament.id)}`
		];
		let emitted = 0;
		(schedules || []).forEach((s) => {
			if (isUnscheduled(s.scheduledTime)) return;
			const start = new Date(s.scheduledTime);
			const end = new Date(start.getTime() + 60 * 60 * 1000);
			const title = `${s.player1Name || 'TBD'} vs ${s.player2Name || 'TBD'}`;
			lines.push(
				'BEGIN:VEVENT',
				// Stable identifier per match: re-importing updates the same event
				`UID:${icsEscape(s.matchId)}@mlbb-tournament`,
				`DTSTAMP:${icsStamp(now)}`,
				`DTSTART:${icsStamp(start)}`,
				`DTEND:${icsStamp(end)}`,
				`SUMMARY:${icsEscape(`[${tournament.name || tournament.id}] ${title}`)}`,
				`DESCRIPTION:${icsEscape(`Round ${s.round || '?'} match ${s.matchId}. Managed by the tournament dashboard; times are UTC in the calendar.`)}`,
				'END:VEVENT'
			);
			emitted++;
		});
		lines.push('END:VCALENDAR');
		return { text: lines.join('\r\n'), count: emitted };
	}

	// ── Setup checklist (guide 11) ──
	// state: { connected, participantCount, unverifiedCount, unmatchedTeams,
	//          checkInDisabled, scheduleCount, timesSet, roundsAvailable, readiness }

	function computeChecklist(state) {
		const s = state || {};
		const steps = [
			{
				id: 'connect',
				label: 'Connect tournament',
				detail: s.connected ? 'Tournament is connected to Challengermode.' : 'Create the tournament from a Challengermode URL.',
				action: '/tournaments',
				done: !!s.connected
			},
			{
				id: 'teams',
				label: 'Review teams',
				detail: s.participantCount > 0 ? `${s.participantCount} enrolment(s) loaded.` : 'Import enrolments or sync to review teams.',
				action: '#participants',
				done: s.participantCount > 0
			},
			{
				id: 'enrolments',
				label: 'Import enrolments',
				detail: s.participantCount > 0 ? 'Enrolments present.' : 'No enrolments yet — import the participants CSV.',
				action: '#participants',
				done: s.participantCount > 0
			},
			{
				id: 'unmatched',
				label: 'Resolve unmatched teams',
				detail: (s.unmatchedTeams || 0) === 0 ? 'All enrolled teams matched a Challengermode team.' : `${s.unmatchedTeams} enrolled team(s) have no matching Challengermode team name.`,
				action: '#participants',
				done: (s.unmatchedTeams || 0) === 0,
				blocked: (s.unmatchedTeams || 0) > 0
			},
			{
				id: 'checkin',
				label: 'Configure check-in',
				detail: s.checkInDisabled === undefined ? 'Unknown check-in state.' : s.checkInDisabled ? 'Check-in is currently disabled.' : 'Check-in is open.',
				action: '#checkin',
				done: s.checkInDisabled !== undefined,
				warn: s.checkInDisabled === true
			},
			{
				id: 'schedule',
				label: 'Set channels and times',
				detail: s.timesSet > 0 ? `${s.timesSet} of ${s.scheduleCount || 0} match(es) have a start time.` : 'No match has a start time yet.',
				action: '#schedules',
				done: s.scheduleCount > 0 && s.scheduleCount === s.timesSet,
				blocked: s.scheduleCount > 0 && s.timesSet !== s.scheduleCount
			},
			{
				id: 'readiness',
				label: 'Run readiness check',
				detail: s.readiness === 'ok' ? 'All readiness checks passed.' : s.readiness === 'partial' ? 'Local checks passed. Discord permission checks are not available yet.' : 'Run the readiness check before opening check-in.',
				action: '#readiness',
				done: s.readiness === 'ok' || s.readiness === 'partial',
				warn: s.readiness === 'partial'
			}
		];
		const next = steps.find((st) => !st.done);
		return {
			steps,
			nextStep: next || null,
			complete: !next,
			progress: `${steps.filter((st) => st.done).length  }/${  steps.length}`
		};
	}

	// ── Team readiness (guide 30, minimal) ──
	// participants: [{team,name,verified,discordId}]; scheduleTeamNames: [string]; expectedRoster: number

	function teamReadiness(participants, scheduleTeamNames, expectedRoster) {
		const roster = expectedRoster && expectedRoster > 0 ? expectedRoster : null;
		const teams = new Map();
		(participants || []).forEach((p) => {
			if (!teams.has(p.team)) teams.set(p.team, []);
			teams.get(p.team).push(p);
		});
		const providerTeams = new Set((scheduleTeamNames || []).map((n) => String(n || '').toLowerCase()).filter(Boolean));

		const result = [];
		teams.forEach((members, team) => {
			const missingVerification = members.filter((m) => !m.verified).length;
			const missingDiscordLink = members.filter((m) => !m.discordId).length;
			const unmatched = providerTeams.size > 0 && !providerTeams.has(String(team).toLowerCase());
			const issues = [];
			if (missingVerification > 0) issues.push(`${missingVerification} member(s) awaiting verification`);
			if (missingDiscordLink > 0) issues.push(`${missingDiscordLink} member(s) without a linked Discord account`);
			if (roster && members.length < roster) issues.push(`${members.length}/${roster} members enrolled`);
			if (unmatched) issues.push('no matching Challengermode team');
			result.push({ team, members: members.length, missingVerification, missingDiscordLink, unmatched, ready: issues.length === 0, issues });
		});
		return result.sort((a, b) => (a.ready === b.ready ? a.team.localeCompare(b.team) : a.ready ? 1 : -1));
	}

	// ── Player search helpers (guide 20) ──

	function maskEmail(email) {
		if (!email || typeof email !== 'string' || !email.includes('@')) return email || '';
		const [local, domain] = email.split('@');
		const visible = local.slice(0, 1);
		return `${visible}${'•'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
	}

	function buildSearchUrl(params) {
		const search = new URLSearchParams();
		Object.keys(params || {}).forEach((key) => {
			const value = params[key];
			if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
		});
		const qs = search.toString();
		return `/players${  qs ? `?${  qs}` : ''}`;
	}

	function parseSearchUrl(href) {
		const out = { query: '', tournamentId: '', team: '', verified: '', discordId: '', page: 1 };
		try {
			const url = new URL(href, 'http://localhost');
			out.query = url.searchParams.get('q') || '';
			out.tournamentId = url.searchParams.get('tournament') || '';
			out.team = url.searchParams.get('team') || '';
			out.verified = url.searchParams.get('verified') || '';
			out.discordId = url.searchParams.get('discordId') || '';
			out.page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
		} catch {
			// keep defaults
		}
		return out;
	}

	// Normalise the two response shapes the search endpoint may use:
	// legacy {data:[...]} and paginated {data:{players:[...], total, page, limit}} (or {data:[...], total,...})
	function normaliseSearchResponse(payload) {
		const body = payload && payload.data !== undefined ? payload.data : payload;
		if (Array.isArray(body)) {
			const total = payload && payload.total !== undefined ? payload.total : body.length;
			return {
				players: body,
				total,
				page: payload && payload.page !== undefined ? payload.page : 1,
				limit: payload && payload.limit !== undefined ? payload.limit : body.length,
				pages: payload && payload.pages !== undefined ? payload.pages : 1,
				emailMasked: !!(payload && payload.emailMasked),
				paginated: payload && payload.total !== undefined
			};
		}
		const players = body && Array.isArray(body.players) ? body.players : Array.isArray(body) ? body : [];
		return {
			players,
			total: body && body.total !== undefined ? body.total : players.length,
			page: body && body.page !== undefined ? body.page : 1,
			limit: body && body.limit !== undefined ? body.limit : players.length,
			pages: body && body.pages !== undefined ? body.pages : 1,
			emailMasked: !!(payload && payload.emailMasked),
			paginated: !!(body && body.total !== undefined)
		};
	}

	function formatDualTimezone(value, primaryTz, secondaryTz) {
		if (isUnscheduled(value)) {
			return { isUnscheduled: true, mainFormatted: 'Not set', altFormatted: '' };
		}
		const main = formatInstant(value, { timeZone: primaryTz || 'UTC' });
		const alt = formatInstant(value, { timeZone: secondaryTz || 'UTC' });
		const mainOffset = offsetLabel(primaryTz || 'UTC', value);
		const altOffset = offsetLabel(secondaryTz || 'UTC', value);
		return {
			isUnscheduled: false,
			mainFormatted: `${main} (${mainOffset})`,
			altFormatted: `${alt} (${altOffset})`
		};
	}

	function checkTeamReadiness(participant) {
		if (!participant) return { ready: false, missing: ['Data'] };
		const missing = [];
		if (!participant.team) missing.push('Team');
		if (!participant.name) missing.push('Name');
		if (!participant.email) missing.push('Email');
		if (!participant.verified) missing.push('Verification');
		if (!participant.discordUsername && !participant.discordId) missing.push('Discord Link');
		return {
			ready: missing.length === 0,
			missing
		};
	}

	function evaluateChecklist(state) {
		return computeChecklist(state).steps;
	}

	function generateIcsCalendar(schedules, tournamentName) {
		const t = typeof tournamentName === 'string' ? { name: tournamentName, id: tournamentName } : (tournamentName || {});
		return generateIcs(t, schedules).text;
	}

	const Helpers = {
		parseCsv,
		buildCsv,
		csvEscape,
		classifyParticipantImport,
		classifyScheduleImport,
		isUnscheduled,
		offsetLabel,
		formatInstant,
		formatDualTimezone,
		generateIcs,
		generateIcsCalendar,
		computeChecklist,
		evaluateChecklist,
		teamReadiness,
		checkTeamReadiness,
		maskEmail,
		buildSearchUrl,
		parseSearchUrl,
		normaliseSearchResponse
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = Helpers;
	}
	if (global) global.DotHelpers = Helpers;
})(typeof window !== 'undefined' ? window : undefined);
