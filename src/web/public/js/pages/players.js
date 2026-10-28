/* global DotHelpers */
// Player Search Page with Pagination, URL Filters, and Masked Email Support
(function() {
	'use strict';

	let players = [];
	let currentPage = 1;
	let currentLimit = 25;
	let currentTotal = 0;
	let totalPages = 1;
	let searchQuery = '';
	let teamFilter = '';
	let verifiedFilter = '';
	let searchTimeout = null;

	// Parse state from URL search params
	function syncStateFromUrl() {
		const params = new URLSearchParams(window.location.search);
		currentPage = Math.max(1, parseInt(params.get('page'), 10) || 1);
		currentLimit = Math.min(100, Math.max(1, parseInt(params.get('limit'), 10) || 25));

		searchQuery = (params.get('q') || params.get('discordUsername') || params.get('email') || '').trim();
		teamFilter = (params.get('team') || '').trim();
		verifiedFilter = (params.get('verified') || '').trim();

		// Sync form controls
		const searchInput = document.getElementById('search-input');
		if (searchInput) searchInput.value = searchQuery;

		const teamInput = document.getElementById('filter-team');
		if (teamInput) teamInput.value = teamFilter;

		const verifiedSelect = document.getElementById('filter-verified');
		if (verifiedSelect) verifiedSelect.value = verifiedFilter;

		const limitSelect = document.getElementById('filter-limit');
		if (limitSelect) limitSelect.value = String(currentLimit);
	}

	// Update browser URL query string without reloading
	function updateUrl(push = false) {
		const params = new URLSearchParams();
		if (currentPage > 1) params.set('page', String(currentPage));
		if (currentLimit !== 25) params.set('limit', String(currentLimit));
		if (searchQuery) params.set('q', searchQuery);
		if (teamFilter) params.set('team', teamFilter);
		if (verifiedFilter) params.set('verified', verifiedFilter);

		const qs = params.toString();
		const newUrl = window.location.pathname + (qs ? `?${qs}` : '');

		if (push) {
			window.history.pushState(null, '', newUrl);
		} else {
			window.history.replaceState(null, '', newUrl);
		}
	}

	// Load players from API
	async function loadPlayers(pushToHistory = false) {
		const tbody = document.getElementById('players-body');
		const statsEl = document.getElementById('players-stats');
		const maskedEl = document.getElementById('email-masked-notice');

		try {
			const params = new URLSearchParams();
			params.set('page', String(currentPage));
			params.set('limit', String(currentLimit));

			if (searchQuery) {
				if (searchQuery.includes('@')) {
					params.set('email', searchQuery);
				} else if (/^\d{16,20}$/.test(searchQuery)) {
					params.set('discordId', searchQuery);
				} else {
					params.set('discordUsername', searchQuery);
				}
			}

			if (teamFilter) {
				params.set('team', teamFilter);
			}

			if (verifiedFilter === 'true' || verifiedFilter === 'false') {
				params.set('verified', verifiedFilter);
			}

			updateUrl(pushToHistory);

			const url = `/api/players/search?${params.toString()}`;
			const response = await Dot.API.get(url);
			const payload = response.data || {};

			players = payload.data || [];
			currentTotal = typeof payload.total === 'number' ? payload.total : players.length;
			totalPages = typeof payload.pages === 'number' ? payload.pages : Math.max(1, Math.ceil(currentTotal / currentLimit));
			currentPage = typeof payload.page === 'number' ? payload.page : currentPage;

			if (maskedEl) {
				maskedEl.style.display = payload.emailMasked ? 'block' : 'none';
			}

			if (statsEl) {
				if (currentTotal === 0) {
					statsEl.textContent = '0 players found';
				} else {
					const start = (currentPage - 1) * currentLimit + 1;
					const end = Math.min(currentPage * currentLimit, currentTotal);
					statsEl.textContent = `Showing ${start}–${end} of ${currentTotal} player(s)`;
				}
			}

			updatePaginationControls();
			renderPlayers();
		} catch (error) {
			console.error('Failed to load players:', error);
			if (tbody) {
				tbody.innerHTML = `
					<tr>
						<td colspan="6" class="empty-state">
							<div class="empty-state-text">Failed to load players</div>
							<div class="empty-state-help">${escapeHtml(error.message || 'Please check your connection and try again.')}</div>
						</td>
					</tr>
				`;
			}
			if (statsEl) statsEl.textContent = 'Failed to load players';
		}
	}

	function updatePaginationControls() {
		const prevBtn = document.getElementById('btn-prev-page');
		const nextBtn = document.getElementById('btn-next-page');
		const pageIndicator = document.getElementById('pagination-page-indicator');
		const summary = document.getElementById('pagination-summary');

		if (prevBtn) prevBtn.disabled = currentPage <= 1;
		if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
		if (pageIndicator) pageIndicator.textContent = String(currentPage);
		if (summary) summary.textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
	}

	function changePage(delta) {
		const next = currentPage + delta;
		if (next >= 1 && next <= totalPages) {
			currentPage = next;
			loadPlayers(true);
		}
	}

	function applySearchFilters() {
		const searchInput = document.getElementById('search-input');
		const teamInput = document.getElementById('filter-team');
		const verifiedSelect = document.getElementById('filter-verified');
		const limitSelect = document.getElementById('filter-limit');

		searchQuery = searchInput ? searchInput.value.trim() : '';
		teamFilter = teamInput ? teamInput.value.trim() : '';
		verifiedFilter = verifiedSelect ? verifiedSelect.value : '';
		currentLimit = limitSelect ? (parseInt(limitSelect.value, 10) || 25) : 25;

		currentPage = 1;
		loadPlayers(true);
	}

	function clearAllFilters() {
		searchQuery = '';
		teamFilter = '';
		verifiedFilter = '';
		currentLimit = 25;
		currentPage = 1;

		const searchInput = document.getElementById('search-input');
		if (searchInput) searchInput.value = '';

		const teamInput = document.getElementById('filter-team');
		if (teamInput) teamInput.value = '';

		const verifiedSelect = document.getElementById('filter-verified');
		if (verifiedSelect) verifiedSelect.value = '';

		const limitSelect = document.getElementById('filter-limit');
		if (limitSelect) limitSelect.value = '25';

		loadPlayers(true);
	}

	// Render players table
	function renderPlayers() {
		const tbody = document.getElementById('players-body');
		if (!tbody) return;

		if (players.length === 0) {
			const hasFilters = searchQuery || teamFilter || verifiedFilter;
			const message = hasFilters
				? 'No players found matching your criteria'
				: 'No players in the system yet';

			tbody.innerHTML = `
				<tr>
					<td colspan="6" class="empty-state">
						<div class="empty-state-text">${message}</div>
						${hasFilters ? '<div class="empty-state-help">Try broadening your search term or clearing filters.</div>' : ''}
					</td>
				</tr>
			`;
			return;
		}

		tbody.innerHTML = players.map(p => {
			const tournamentId = p.tournament ? p.tournament.id : '';
			const tournamentName = p.tournament ? p.tournament.name : 'No Tournament';
			const displayName = p.name || '—';
			const displayDiscord = p.discordUsername || (p.discordId ? `ID: ${p.discordId}` : '—');

			return `
				<tr data-player-id="${p.id}" ${tournamentId ? `onclick="navigateToTournament('${tournamentId}')"` : ''}>
					<td><strong>${escapeHtml(displayName)}</strong></td>
					<td><code>${escapeHtml(p.email || '—')}</code></td>
					<td>${escapeHtml(p.team || '—')}</td>
					<td>
						${p.verified
							? `<span class="verified-badge">
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
									${escapeHtml(displayDiscord)}
								</span>`
							: `<span class="unverified-badge">${escapeHtml(displayDiscord)}</span>`
						}
					</td>
					<td>
						${tournamentId
							? `<a href="/tournaments/${tournamentId}" class="tournament-link" onclick="event.stopPropagation()">${escapeHtml(tournamentName)}</a>`
							: `<span class="tournament-link">${escapeHtml(tournamentName)}</span>`
						}
					</td>
					<td onclick="event.stopPropagation()">
						<div class="action-buttons">
							<button class="btn btn-sm btn-secondary btn-icon" onclick="openEditModal(${p.id})">Edit</button>
							<button class="btn btn-sm btn-danger btn-icon" onclick="deletePlayer(${p.id}, '${escapeJs(displayName)}', '${escapeJs(tournamentName)}')">Delete</button>
						</div>
					</td>
				</tr>
			`;
		}).join('');
	}

	// Navigate to tournament
	function navigateToTournament(tournamentId) {
		window.location.href = `/tournaments/${tournamentId}`;
	}

	// Open edit modal
	function openEditModal(playerId) {
		const player = players.find(p => p.id === playerId);
		if (!player) return;

		if (!player.tournament) {
			Dot.Toast.error('Cannot edit player without a tournament');
			return;
		}

		document.getElementById('edit-player-id').value = player.id;
		document.getElementById('edit-tournament-id').value = player.tournament.id;
		document.getElementById('edit-tournament-name').value = player.tournament.name;
		document.getElementById('edit-name').value = player.name || '';
		document.getElementById('edit-email').value = player.email || '';
		document.getElementById('edit-team').value = player.team || '';
		document.getElementById('edit-discord-username').value = player.discordUsername || '';
		document.getElementById('edit-verified').checked = !!player.verified;

		document.getElementById('edit-modal').style.display = 'flex';
	}

	// Close edit modal
	function closeEditModal() {
		document.getElementById('edit-modal').style.display = 'none';
	}

	// Save player
	async function savePlayer() {
		const playerId = parseInt(document.getElementById('edit-player-id').value, 10);
		const tournamentId = document.getElementById('edit-tournament-id').value;
		const name = document.getElementById('edit-name').value.trim();
		const team = document.getElementById('edit-team').value.trim();
		const discordUsername = document.getElementById('edit-discord-username').value.trim();
		const verified = document.getElementById('edit-verified').checked;

		if (!name || !team) {
			Dot.Toast.error('Name and Team are required');
			return;
		}

		if (!tournamentId) {
			Dot.Toast.error('Cannot update player without a tournament');
			return;
		}

		try {
			await Dot.API.put(`/api/tournaments/${tournamentId}/participants/${playerId}`, {
				name,
				team,
				discordUsername: discordUsername || null,
				verified
			});

			Dot.Toast.success('Player updated successfully');
			closeEditModal();
			loadPlayers(false);
		} catch (error) {
			console.error('Failed to update player:', error);
			Dot.Toast.error(error.message || 'Failed to update player');
		}
	}

	// Delete player
	function deletePlayer(playerId, playerName, tournamentName) {
		const player = players.find(p => p.id === playerId);
		if (!player) return;

		if (!player.tournament) {
			Dot.Toast.error('Cannot delete player without a tournament');
			return;
		}

		Dot.Modal.confirm(
			'Delete Player',
			`Are you sure you want to delete ${playerName} from ${tournamentName}? This action cannot be undone.`,
			async () => {
				try {
					await Dot.API.delete(`/api/tournaments/${player.tournament.id}/participants/${playerId}`);
					Dot.Toast.success('Player deleted successfully');
					loadPlayers(false);
				} catch (error) {
					console.error('Failed to delete player:', error);
					Dot.Toast.error(error.message || 'Failed to delete player');
				}
			}
		);
	}

	// Export Modal Functions
	function openExportModal() {
		const teamsByTournament = {};

		players.forEach(p => {
			const tournamentName = p.tournament ? p.tournament.name : 'No Tournament';
			const teamName = p.team || 'No Team';
			const key = `${tournamentName}|||${teamName}`;

			if (!teamsByTournament[key]) {
				teamsByTournament[key] = {
					team: teamName,
					tournament: tournamentName
				};
			}
		});

		const sortedTeams = Object.values(teamsByTournament).sort((a, b) => {
			if (a.tournament !== b.tournament) {
				return a.tournament.localeCompare(b.tournament);
			}
			return a.team.localeCompare(b.team);
		});

		const container = document.getElementById('export-teams-list');
		let currentTournament = null;
		let html = '';

		sortedTeams.forEach(item => {
			if (currentTournament !== item.tournament) {
				if (currentTournament !== null) {
					html += '</div>';
				}
				html += `<div class="export-team-group">
					<div class="export-team-group-header">${escapeHtml(item.tournament)}</div>`;
				currentTournament = item.tournament;
			}
			html += `
				<label class="export-team-item">
					<input type="checkbox" class="export-team-checkbox" data-team="${escapeHtml(item.team)}">
					<span class="export-team-name">${escapeHtml(item.team)}</span>
				</label>`;
		});

		if (sortedTeams.length > 0) {
			html += '</div>';
		}

		if (container) {
			container.innerHTML = html || '<div class="export-team-item">No teams available on this page</div>';
		}

		const selectAll = document.getElementById('export-select-all');
		if (selectAll) selectAll.checked = false;

		document.getElementById('export-modal').style.display = 'flex';
	}

	function closeExportModal() {
		document.getElementById('export-modal').style.display = 'none';
	}

	function toggleSelectAll() {
		const selectAll = document.getElementById('export-select-all').checked;
		const checkboxes = document.querySelectorAll('.export-team-checkbox');
		checkboxes.forEach(cb => cb.checked = selectAll);
	}

	function exportToCSV() {
		const checkboxes = document.querySelectorAll('.export-team-checkbox:checked');
		const selectedTeams = Array.from(checkboxes).map(cb => cb.dataset.team);

		if (selectedTeams.length === 0) {
			Dot.Toast.error('Please select at least one team');
			return;
		}

		const filteredPlayers = players.filter(p => selectedTeams.includes(p.team));
		if (filteredPlayers.length === 0) {
			Dot.Toast.error('No players found for selected teams');
			return;
		}

		const headers = ['Name', 'Email', 'Team', 'Discord Username', 'Discord ID', 'Verified', 'Tournament'];
		const rows = filteredPlayers.map(p => ({
			Name: p.name || '',
			Email: p.email || '',
			Team: p.team || '',
			'Discord Username': p.discordUsername || '',
			'Discord ID': p.discordId || '',
			Verified: p.verified ? 'true' : 'false',
			Tournament: p.tournament ? p.tournament.name : ''
		}));

		const csvContent = window.DotHelpers
			? DotHelpers.buildCsv(rows, headers)
			: [headers.join(','), ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		const today = new Date().toISOString().split('T')[0];
		link.setAttribute('href', url);
		link.setAttribute('download', `player-export-${today}.csv`);
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		Dot.Toast.success(`Exported ${filteredPlayers.length} players from ${selectedTeams.length} team(s)`);
		closeExportModal();
	}

	// Utility functions
	function escapeHtml(text) {
		if (text == null) return '';
		const div = document.createElement('div');
		div.textContent = String(text);
		return div.innerHTML;
	}

	function escapeJs(text) {
		if (text == null) return '';
		return String(text).replace(/'/g, "\\'").replace(/"/g, '\\"');
	}

	// Set up event listeners
	document.addEventListener('DOMContentLoaded', () => {
		syncStateFromUrl();

		const searchInput = document.getElementById('search-input');
		if (searchInput) {
			searchInput.addEventListener('input', (e) => {
				searchQuery = e.target.value.trim();
				clearTimeout(searchTimeout);
				searchTimeout = setTimeout(() => {
					currentPage = 1;
					loadPlayers(false);
				}, 350);
			});
			searchInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					applySearchFilters();
				}
			});
		}

		const teamInput = document.getElementById('filter-team');
		if (teamInput) {
			teamInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					applySearchFilters();
				}
			});
		}

		const verifiedSelect = document.getElementById('filter-verified');
		if (verifiedSelect) {
			verifiedSelect.addEventListener('change', () => {
				applySearchFilters();
			});
		}

		const limitSelect = document.getElementById('filter-limit');
		if (limitSelect) {
			limitSelect.addEventListener('change', () => {
				applySearchFilters();
			});
		}

		// Handle browser Back / Forward buttons
		window.addEventListener('popstate', () => {
			syncStateFromUrl();
			loadPlayers(false);
		});

		loadPlayers(false);
	});

	// Global window exports
	window.navigateToTournament = navigateToTournament;
	window.applySearchFilters = applySearchFilters;
	window.clearAllFilters = clearAllFilters;
	window.clearSearch = clearAllFilters;
	window.changePage = changePage;
	window.openEditModal = openEditModal;
	window.closeEditModal = closeEditModal;
	window.savePlayer = savePlayer;
	window.deletePlayer = deletePlayer;
	window.openExportModal = openExportModal;
	window.closeExportModal = closeExportModal;
	window.toggleSelectAll = toggleSelectAll;
	window.exportToCSV = exportToCSV;
})();
