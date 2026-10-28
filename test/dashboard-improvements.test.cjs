const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

// Load isomorphic helper module
const DotHelpers = require('../src/web/public/js/dot-helpers.js');

// Helper for test fixtures and database
const { withDatabase, id, uuid } = require('./helpers/fixtures.cjs');
const { addTournament } = require('../dist/util/tournament');
const { EnrolledPlayer, MatchSchedule } = require('../dist/database/orm');

// Temporary env file for testing
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlbb-dashboard-test-'));
process.env.DOTENV_CONFIG_PATH = path.join(tempDir, '.env');

// Express routes
const configRoutes = require('../dist/web/routes/config').default;
const participantRoutes = require('../dist/web/routes/participants').default;
const scheduleRoutes = require('../dist/web/routes/schedules').default;
const playerRoutes = require('../dist/web/routes/players').default;
const systemRoutes = require('../dist/web/routes/system').default;

async function withDashboardServer(run) {
	const app = express();
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.use(expressLayouts);

	app.set('view engine', 'ejs');
	app.set('views', path.join(__dirname, '../src/web/views'));
	app.set('layout', 'layout');
	app.set('view cache', false);

	app.use((req, res, next) => {
		res.locals.path = req.path;
		res.locals.title = 'Test Admin';
		res.locals.csrfToken = 'test-csrf-token-12345';
		res.locals.csrfMetaName = 'csrf-token';
		next();
	});

	app.use(participantRoutes);
	app.use(scheduleRoutes);
	app.use(configRoutes);
	app.use(playerRoutes);
	app.use(systemRoutes);

	app.get('/privacy', (req, res) => {
		res.render('privacy', { title: 'Privacy & Retention', path: '/privacy' });
	});

	app.get('/support', (req, res) => {
		res.render('support', { title: 'Support & Diagnostics', path: '/support' });
	});

	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	const baseUrl = `http://127.0.0.1:${server.address().port}`;

	try {
		return await run((route, options = {}) => {
			const method = options.method || 'GET';
			const headers = { ...options.headers };
			let body;

			if (options.body !== undefined) {
				headers['Content-Type'] = 'application/json';
				body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
			}

			return fetch(baseUrl + route, {
				method,
				headers,
				body,
				redirect: 'manual'
			});
		});
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
}

// =========================================================================
// 1. Isomorphic Helpers Unit Tests (DotHelpers)
// =========================================================================

test('DotHelpers.parseCsv handles quoted fields, escaped quotes, and newlines', () => {
	const csv = 'team,name,email\r\n"Alpha, ""One""","Jane ""Captain"" Doe",jane@example.com\r\n"Beta\nTeam",Bob,bob@example.com\r\n';
	const parsed = DotHelpers.parseCsv(csv);

	assert.deepEqual(parsed.headers, ['team', 'name', 'email']);
	assert.equal(parsed.rows.length, 2);
	assert.equal(parsed.rows[0].values.team, 'Alpha, "One"');
	assert.equal(parsed.rows[0].values.name, 'Jane "Captain" Doe');
	assert.equal(parsed.rows[0].values.email, 'jane@example.com');
	assert.equal(parsed.rows[1].values.team, 'Beta\nTeam');
	assert.equal(parsed.rows[1].values.name, 'Bob');
});

test('DotHelpers.buildCsv exports RFC4180 escaped CSV rows', () => {
	const rows = [
		{ Team: 'Team "A"', Captain: 'Jane, Doe', Email: 'jane@example.com' },
		{ Team: 'Simple', Captain: 'Bob', Email: 'bob@example.com' }
	];
	const csv = DotHelpers.buildCsv(rows, ['Team', 'Captain', 'Email']);

	assert.ok(csv.includes('"Team ""A"""'));
	assert.ok(csv.includes('"Jane, Doe"'));
	assert.ok(csv.includes('Simple,Bob,bob@example.com'));
});

test('DotHelpers.classifyParticipantImport flags added, changed, unchanged, and rejected rows', () => {
	const existing = [
		{ email: 'alice@example.com', name: 'Alice A', team: 'Team Alpha', discordUsername: 'alice#1' },
		{ email: 'bob@example.com', name: 'Bob B', team: 'Team Beta', discordUsername: 'bob#2' }
	];

	const csv = [
		'email,name,team,discord',
		'alice@example.com,Alice A,Team Alpha,alice#1', // unchanged
		'bob@example.com,Robert B,Team Beta Renamed,bob#2', // changed
		'charlie@example.com,Charlie C,Team Charlie,charlie#3', // added
		'invalid-email,David,Team Delta,david#4', // rejected
		'missingname@example.com,,Team Echo,echo#5' // rejected
	].join('\n');

	const parsed = DotHelpers.parseCsv(csv);
	const classified = DotHelpers.classifyParticipantImport(parsed, existing);

	assert.equal(classified.summary.unchanged, 1);
	assert.equal(classified.summary.changed, 1);
	assert.equal(classified.summary.added, 1);
	assert.equal(classified.summary.rejected, 2);
	assert.equal(classified.rejected[0].reason, 'Invalid email address');
	assert.equal(classified.rejected[1].reason, 'Missing captain name');
});

test('DotHelpers.classifyScheduleImport validates UUIDs, times, and change states', () => {
	const validUuid1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
	const validUuid2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

	const existing = [
		{ matchId: validUuid1, scheduledTime: '2026-11-01T10:00:00Z' }
	];

	const csv = [
		'match_id,scheduled_time',
		`${validUuid1},2026-11-01 10:00:00`, // unchanged
		`${validUuid2},2026-11-02 14:00:00`, // added
		'non-uuid-match,2026-11-03 16:00:00', // rejected
		`${validUuid1},not-a-date` // rejected
	].join('\n');

	const parsed = DotHelpers.parseCsv(csv);
	const classified = DotHelpers.classifyScheduleImport(parsed, existing);

	assert.equal(classified.summary.unchanged, 1);
	assert.equal(classified.summary.added, 1);
	assert.equal(classified.summary.rejected, 2);
	assert.match(classified.rejected[0].reason, /not a UUID/);
	assert.match(classified.rejected[1].reason, /not a valid date/);
});

test('DotHelpers.formatDualTimezone handles scheduled times and guards sentinel unscheduled dates', () => {
	// Guard against year 2090+ sentinel dates
	const unscheduled = DotHelpers.formatDualTimezone('2099-12-31T23:59:59Z', 'America/New_York', 'UTC');
	assert.equal(unscheduled.isUnscheduled, true);
	assert.equal(unscheduled.mainFormatted, 'Not set');

	// Valid scheduled date
	const scheduled = DotHelpers.formatDualTimezone('2026-11-01T12:00:00Z', 'UTC', 'Europe/London');
	assert.equal(scheduled.isUnscheduled, false);
	assert.ok(scheduled.mainFormatted.includes('UTC'));
	assert.ok(scheduled.altFormatted.includes('Europe/London') || scheduled.altFormatted.includes('UTC'));
});

test('DotHelpers.generateIcs creates calendar entries and ignores unscheduled matches', () => {
	const tournament = { id: 'cup-101', name: 'MLBB Autumn Cup' };
	const schedules = [
		{
			matchId: '11111111-2222-3333-4444-555555555555',
			round: 1,
			player1Name: 'Team Fire',
			player2Name: 'Team Ice',
			scheduledTime: '2026-11-10T15:00:00Z'
		},
		{
			matchId: '99999999-8888-7777-6666-555555555555',
			round: 2,
			player1Name: 'TBD',
			player2Name: 'TBD',
			scheduledTime: '2099-12-31T23:59:59Z' // unscheduled sentinel
		}
	];

	const calendar = DotHelpers.generateIcs(tournament, schedules);
	assert.equal(calendar.count, 1);
	assert.ok(calendar.text.includes('BEGIN:VCALENDAR'));
	assert.ok(calendar.text.includes('UID:11111111-2222-3333-4444-555555555555@mlbb-tournament'));
	assert.ok(calendar.text.includes('SUMMARY:[MLBB Autumn Cup] Team Fire vs Team Ice'));
	assert.ok(!calendar.text.includes('99999999-8888-7777-6666-555555555555'));
});

test('DotHelpers.computeChecklist calculates tournament progress accurately', () => {
	const incompleteState = {
		connected: true,
		participantCount: 5,
		unmatchedTeams: 2, // 2 unmatched
		checkInDisabled: true,
		scheduleCount: 4,
		timesSet: 2, // only 2 of 4 have times
		readiness: 'partial'
	};

	const check = DotHelpers.computeChecklist(incompleteState);
	assert.equal(check.complete, false);
	assert.ok(check.steps.length >= 7);

	const unmatchedStep = check.steps.find(s => s.id === 'unmatched');
	assert.equal(unmatchedStep.done, false);
	assert.equal(unmatchedStep.blocked, true);

	const completeState = {
		connected: true,
		participantCount: 8,
		unmatchedTeams: 0,
		checkInDisabled: false,
		scheduleCount: 4,
		timesSet: 4,
		readiness: 'ok'
	};

	const completeCheck = DotHelpers.computeChecklist(completeState);
	assert.equal(completeCheck.complete, true);
	assert.equal(completeCheck.progress, '7/7');
});

test('DotHelpers.checkTeamReadiness verifies player roster completeness', () => {
	const readyPlayer = {
		team: 'Alpha',
		name: 'John',
		email: 'john@example.com',
		verified: true,
		discordUsername: 'john#1234'
	};
	const ready = DotHelpers.checkTeamReadiness(readyPlayer);
	assert.equal(ready.ready, true);
	assert.equal(ready.missing.length, 0);

	const incompletePlayer = {
		team: 'Beta',
		name: '',
		email: 'beta@example.com',
		verified: false,
		discordUsername: null
	};
	const notReady = DotHelpers.checkTeamReadiness(incompletePlayer);
	assert.equal(notReady.ready, false);
	assert.ok(notReady.missing.includes('Name'));
	assert.ok(notReady.missing.includes('Verification'));
	assert.ok(notReady.missing.includes('Discord Link'));
});

test('DotHelpers.maskEmail protects participant privacy', () => {
	assert.equal(DotHelpers.maskEmail('captain@example.com'), 'c••••••@example.com');
	assert.equal(DotHelpers.maskEmail('a@b.com'), 'a••@b.com');
	assert.equal(DotHelpers.maskEmail(''), '');
});

// =========================================================================
// 2. View Template Contracts & Render Tests
// =========================================================================

test('Views contain critical usability, security, and accessibility elements', () => {
	const layoutHtml = fs.readFileSync(path.join(__dirname, '../src/web/views/layout.ejs'), 'utf8');
	assert.ok(layoutHtml.includes('csrf-token'), 'Layout contains CSRF meta tag');
	assert.ok(layoutHtml.includes('skip-link'), 'Layout contains accessibility skip link');
	assert.ok(layoutHtml.includes('health-indicator'), 'Layout contains live server health indicator');
	assert.ok(layoutHtml.includes('/privacy'), 'Layout contains navigation link to /privacy');
	assert.ok(layoutHtml.includes('/support'), 'Layout contains navigation link to /support');

	const configHtml = fs.readFileSync(path.join(__dirname, '../src/web/views/config/index.ejs'), 'utf8');
	assert.ok(configHtml.includes('secret-configured'), 'Config view displays configured badge for masked secrets');
	assert.ok(configHtml.includes('restart required'), 'Config view alerts that restart is required on changes');

	const systemHtml = fs.readFileSync(path.join(__dirname, '../src/web/views/system.ejs'), 'utf8');
	assert.ok(systemHtml.includes('Upcoming matches'), 'System view displays upcoming match overview');
	assert.ok(systemHtml.includes('Sync Freshness') || systemHtml.includes('stale-list') || systemHtml.includes('Sync'), 'System view exposes sync state');

	const detailHtml = fs.readFileSync(path.join(__dirname, '../src/web/views/tournaments/detail.ejs'), 'utf8');
	assert.ok(detailHtml.includes('tournament-checklist-card'), 'Tournament detail includes setup checklist');
	assert.ok(detailHtml.includes('schedule-match-select'), 'Tournament detail has match dropdown selector');
	assert.ok(detailHtml.includes('toggleManualMatchInput'), 'Tournament detail provides manual match UUID fallback');
	assert.ok(detailHtml.includes('exportSchedulesIcs'), 'Tournament detail supports .ics calendar export');
	assert.ok(detailHtml.includes('csv-diff-badges'), 'Tournament detail has CSV diff preview badges');
	assert.ok(detailHtml.includes('csv-rejection-bar'), 'Tournament detail has rejected rows download bar');
	assert.ok(detailHtml.includes('all-or-nothing'), 'Tournament detail supports all-or-nothing import mode');

	const playersHtml = fs.readFileSync(path.join(__dirname, '../src/web/views/players/index.ejs'), 'utf8');
	assert.ok(playersHtml.includes('pagination-bar'), 'Player view has pagination bar');
	assert.ok(playersHtml.includes('filter-team'), 'Player view has team filter');
	assert.ok(playersHtml.includes('filter-verified'), 'Player view has verification filter');
	assert.ok(playersHtml.includes('email-masked-notice'), 'Player view announces masked emails');
});

// =========================================================================
// 3. Web Endpoints Integration Tests (Express Server)
// =========================================================================

test('GET /privacy renders privacy and data retention view with HTTP 200', async () => {
	await withDashboardServer(async (request) => {
		const res = await request('/privacy');
		assert.equal(res.status, 200);
		const html = await res.text();
		assert.ok(html.includes('Privacy &amp; Retention') || html.includes('Privacy & Retention'));
		assert.ok(html.includes('What is collected'));
		assert.ok(html.includes('Retention') && html.includes('retention-rules'));
	});
});

test('GET /support renders diagnostics view with HTTP 200', async () => {
	await withDashboardServer(async (request) => {
		const res = await request('/support');
		assert.equal(res.status, 200);
		const html = await res.text();
		assert.ok(html.includes('Support &amp; Diagnostics') || html.includes('Support & Diagnostics'));
		assert.ok(html.includes('Dependency Readiness'));
		assert.ok(html.includes('Test Email Delivery'));
	});
});

test('GET /api/players/search enforces bounded pagination and masks emails', async () => {
	await withDatabase(async () => {
		await withDashboardServer(async (request) => {
			await addTournament(id, 'cup-players', 'guild-1', 'host-1');

			// Add sample enrolled players
			await EnrolledPlayer.create({
				tournamentId: 'cup-players',
				team: 'Alpha Team',
				name: 'Player One',
				email: 'player.one@example.com',
				discordUsername: 'player1#1111',
				verified: true
			}).save();

			await EnrolledPlayer.create({
				tournamentId: 'cup-players',
				team: 'Beta Team',
				name: 'Player Two',
				email: 'player.two@example.com',
				discordUsername: 'player2#2222',
				verified: false
			}).save();

			const res = await request('/api/players/search?page=1&limit=10');
			assert.equal(res.status, 200);
			const json = await res.json();

			assert.equal(json.success, true);
			assert.equal(json.emailMasked, true);
			assert.equal(json.total, 2);
			assert.equal(json.page, 1);
			assert.equal(json.data.length, 2);

			// Check that emails are masked in API output
			assert.ok(!json.data[0].email.includes('player.one@'));
			assert.ok(json.data[0].email.includes('***'));

			// Test team filter
			const teamRes = await request('/api/players/search?team=Alpha');
			assert.equal(teamRes.status, 200);
			const teamJson = await teamRes.json();
			assert.equal(teamJson.total, 1);
			assert.equal(teamJson.data[0].name, 'Player One');

			// Test verification filter
			const verRes = await request('/api/players/search?verified=false');
			assert.equal(verRes.status, 200);
			const verJson = await verRes.json();
			assert.equal(verJson.total, 1);
			assert.equal(verJson.data[0].name, 'Player Two');
		});
	});
});

test('POST /api/tournaments/:id/participants/preview computes diff statistics', async () => {
	await withDatabase(async () => {
		await withDashboardServer(async (request) => {
			await addTournament(id, 'cup-preview', 'guild-1', 'host-1');

			await EnrolledPlayer.create({
				tournamentId: 'cup-preview',
				team: 'Existing Team',
				name: 'Existing Captain',
				email: 'existing@example.com'
			}).save();

			await EnrolledPlayer.create({
				tournamentId: 'cup-preview',
				team: 'Second Team',
				name: 'Second Captain',
				email: 'second@example.com'
			}).save();

			const csv = [
				'team,name,email',
				'Existing Team,Existing Captain,existing@example.com', // unchanged
				'Second Team,Updated Captain,second@example.com', // changed
				'Brand New Team,Fresh Captain,new@example.com', // added
				'Broken Team,Missing Email,' // rejected
			].join('\n');

			const res = await request('/api/tournaments/cup-preview/participants/preview', {
				method: 'POST',
				body: { csv }
			});

			assert.equal(res.status, 200);
			const json = await res.json();
			assert.equal(json.success, true);
			assert.equal(json.data.unchanged, 1);
			assert.equal(json.data.changed, 1);
			assert.equal(json.data.added, 1);
			assert.equal(json.data.rejected, 1);
		});
	});
});
