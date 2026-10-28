// Dot Tournament Dashboard - Main App JavaScript
// Text rendering policy: user/API-supplied text is always inserted with
// textContent or via el(). No message string is ever interpolated into
// innerHTML (guide 6.5).

// API wrapper
const API = {
	csrfToken: null,

	readCsrfToken() {
		if (this.csrfToken) return this.csrfToken;
		const meta = document.querySelector('meta[name="csrf-token"]');
		this.csrfToken = meta ? meta.getAttribute('content') : null;
		return this.csrfToken;
	},

	async request(url, options = {}) {
		const headers = {
			'Content-Type': 'application/json',
			...options.headers
		};
		const method = (options.method || 'GET').toUpperCase();
		if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
			const token = this.readCsrfToken();
			if (token) headers['X-CSRF-Token'] = token;
		}

		let response;
		try {
			response = await fetch(url, { ...options, headers });
		} catch (error) {
			console.error('API request failed:', error);
			Toast.error('Network request failed. Check that the dashboard server is still running.');
			throw error;
		}

		// Unauthenticated API calls get JSON 401s, not redirects.
		if (response.status === 401) {
			let message = 'Your session has expired. Redirecting to login…';
			try {
				const body = await response.json();
				if (body && body.error) message = body.error;
			} catch {
				// response was not JSON; keep default message
			}
			Toast.error(message);
			window.setTimeout(() => {
				window.location.assign(`/login?redirect=${  encodeURIComponent(window.location.pathname)}`);
			}, 1200);
			const error = new Error(message);
			error.status = 401;
			throw error;
		}

		if (!response.ok) {
			const error = await response.json().catch(() => ({ error: 'Request failed' }));
			const message = (error && (error.error || error.message)) || 'Request failed';
			const thrown = new Error(message);
			thrown.status = response.status;
			thrown.payload = error;
			throw thrown;
		}

		return await response.json();
	},

	get(url) {
		return this.request(url);
	},

	post(url, data) {
		return this.request(url, {
			method: 'POST',
			body: JSON.stringify(data),
		});
	},

	put(url, data) {
		return this.request(url, {
			method: 'PUT',
			body: JSON.stringify(data),
		});
	},

	delete(url) {
		return this.request(url, {
			method: 'DELETE',
		});
	},
};

// Toast notifications.
// Rendered entirely with DOM nodes; the message is inserted via textContent so
// markup in an API response can never execute (guide 6.5). Error toasts stay
// on screen until dismissed so an actionable message is never lost (guide 19).
const Toast = {
	liveRegion: null,

	getLiveRegion() {
		if (!this.liveRegion) {
			const region = document.createElement('div');
			region.setAttribute('role', 'status');
			region.setAttribute('aria-live', 'polite');
			region.className = 'sr-only';
			document.body.appendChild(region);
			this.liveRegion = region;
		}
		return this.liveRegion;
	},

	announce(message) {
		const region = this.getLiveRegion();
		region.textContent = '';
		// Re-assign in the next frame so repeated identical messages are announced too.
		window.requestAnimationFrame(() => {
			region.textContent = message;
		});
	},

	show(message, type = 'info', duration = 5000) {
		const container = document.querySelector('.toast-container') || this.createContainer();
		const toast = document.createElement('div');
		toast.className = `toast toast-${type}`;
		toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

		const icon = document.createElement('div');
		icon.className = 'toast-icon';
		icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
		if (type === 'success') {
			icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
		} else if (type === 'error') {
			icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
		} else if (type === 'warning') {
			icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
		}

		const messageEl = document.createElement('div');
		messageEl.className = 'toast-message';
		messageEl.textContent = message; // textContent only — never innerHTML

		const closeBtn = document.createElement('button');
		closeBtn.className = 'toast-close';
		closeBtn.type = 'button';
		closeBtn.setAttribute('aria-label', 'Dismiss notification');
		closeBtn.textContent = '\u00d7';

		toast.appendChild(icon);
		toast.appendChild(messageEl);
		toast.appendChild(closeBtn);
		container.appendChild(toast);
		this.announce(message);

		let dismissed = false;
		const dismiss = () => {
			if (dismissed) return;
			dismissed = true;
			toast.classList.add('toast-out');
			window.setTimeout(() => toast.remove(), 300);
		};
		closeBtn.addEventListener('click', dismiss);

		// Errors are persistent until dismissed (guide 19); everything else auto-hides.
		if (duration > 0) {
			window.setTimeout(() => {
				if (dismissed) return;
				const onScreen = document.activeElement && toast.contains(document.activeElement);
				if (onScreen) {
					// A keyboard user is interacting with the toast; keep it until blur.
					closeBtn.addEventListener('blur', dismiss);
					return;
				}
				dismiss();
			}, duration);
		}
		return toast;
	},

	createContainer() {
		const container = document.createElement('div');
		container.className = 'toast-container';
		document.body.appendChild(container);
		return container;
	},

	success(message, duration) {
		this.show(message, 'success', duration);
	},

	error(message, duration = 0) {
		this.show(message, 'error', duration);
	},

	warning(message, duration) {
		this.show(message, 'warning', duration);
	},

	info(message, duration) {
		this.show(message, 'info', duration);
	},
};

// Modal helper with focus trapping, focus restoration, dialog semantics and
// Escape handling (guide 19).
const Modal = {
	stack: [],

	open(content, options = {}) {
		const overlay = document.createElement('div');
		overlay.className = 'modal-overlay';
		overlay.innerHTML = content;

		const dialog = overlay.querySelector('.modal');
		if (dialog) {
			dialog.setAttribute('role', 'dialog');
			dialog.setAttribute('aria-modal', 'true');
			dialog.setAttribute('aria-labelledby', options.labelledBy || (dialog.querySelector('.modal-title') ? dialog.querySelector('.modal-title').id : ''));
			if (options.label) dialog.setAttribute('aria-label', options.label);
		}

		const entry = {
			overlay,
			previouslyFocused: document.activeElement,
			keydownHandler: null
		};

		entry.keydownHandler = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close(overlay);
			} else if (event.key === 'Tab') {
				this.trapFocus(event, overlay);
			}
		};
		document.addEventListener('keydown', entry.keydownHandler);

		overlay.addEventListener('mousedown', (e) => {
			if (e.target === overlay) this.close(overlay);
		});

		document.body.appendChild(overlay);
		document.body.classList.add('modal-open');
		this.stack.push(entry);

		const focusTarget =
			overlay.querySelector('[data-autofocus]') ||
			overlay.querySelector('input:not([type="hidden"]), select, textarea, button.btn-primary, button');
		if (focusTarget) focusTarget.focus();

		return overlay;
	},

	trapFocus(event, overlay) {
		const focusables = Array.from(
			overlay.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
		).filter((el) => el.offsetParent !== null || el === document.activeElement);
		if (focusables.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	},

	close(overlay) {
		const target = overlay || (this.stack.length ? this.stack[this.stack.length - 1].overlay : document.querySelector('.modal-overlay'));
		if (!target) return;
		const index = this.stack.findIndex((entry) => entry.overlay === target);
		if (index !== -1) {
			const entry = this.stack.splice(index, 1)[0];
			document.removeEventListener('keydown', entry.keydownHandler);
			if (entry.previouslyFocused && entry.previouslyFocused.focus) {
				entry.previouslyFocused.focus();
			}
		}
		target.remove();
		if (this.stack.length === 0) document.body.classList.remove('modal-open');
	},

	closeTop() {
		if (this.stack.length) this.close(this.stack[this.stack.length - 1].overlay);
	},

	isOpen() {
		return this.stack.length > 0;
	},

	confirm(title, message, onConfirm, onCancel = null, options = {}) {
		const danger = options.danger !== false;
		const content = `
			<div class="modal" style="max-width: 400px;">
				<div class="modal-header">
					<h3 class="modal-title">${Utils.escapeHtml(title)}</h3>
					<button class="modal-close js-confirm-close" type="button" aria-label="Close dialog">&times;</button>
				</div>
				<div class="modal-body">
					<p class="modal-plain-message">${Utils.escapeHtml(message)}</p>
				</div>
				<div class="modal-footer">
					<button class="btn btn-secondary js-confirm-cancel" type="button">Cancel</button>
					<button class="btn ${danger ? 'btn-danger' : 'btn-primary'} js-confirm-ok" type="button" data-autofocus>${options.confirmLabel || 'Confirm'}</button>
				</div>
			</div>
		`;
		const overlay = this.open(content, { label: title });

		const handleCancel = () => {
			this.close(overlay);
			if (onCancel) onCancel();
		};

		overlay.querySelector('.js-confirm-close').addEventListener('click', handleCancel);
		overlay.querySelector('.js-confirm-cancel').addEventListener('click', handleCancel);

		overlay.querySelector('.js-confirm-ok').addEventListener('click', () => {
			this.close(overlay);
			if (onConfirm) onConfirm();
		});
	},

	alert(title, message, onOk = null) {
		const content = `
			<div class="modal" style="max-width: 400px;">
				<div class="modal-header">
					<h3 class="modal-title">${Utils.escapeHtml(title)}</h3>
					<button class="modal-close js-alert-close" type="button" aria-label="Close dialog">&times;</button>
				</div>
				<div class="modal-body">
					<p class="modal-plain-message">${Utils.escapeHtml(message)}</p>
				</div>
				<div class="modal-footer">
					<button class="btn btn-primary js-alert-ok" type="button" data-autofocus>OK</button>
				</div>
			</div>
		`;
		const overlay = this.open(content, { label: title });

		const handleClose = () => {
			this.close(overlay);
			if (onOk) onOk();
		};

		overlay.querySelector('.js-alert-close').addEventListener('click', handleClose);
		overlay.querySelector('.js-alert-ok').addEventListener('click', handleClose);
	}
};

// Utility functions
const Utils = {
	debounce(func, wait) {
		let timeout;
		return function executedFunction(...args) {
			const later = () => {
				clearTimeout(timeout);
				func(...args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		};
	},

	// Returns a plain-text string; callers that need HTML must escape explicitly.
	// 2099 sentinel dates render as "Not set" until the backend replaces them
	// with an explicit scheduling state (guide 15).
	formatScheduledTime(dateString) {
		if (!dateString) return 'Not set';
		const dateObj = new Date(dateString);
		if (isNaN(dateObj.getTime())) return 'Not set';
		if (dateObj.getFullYear() > 2090) return 'Not set';
		return dateObj.toLocaleString(undefined, {
			weekday: 'short', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	},

	formatRelativeTime(date) {
		if (!date) return 'never';
		const seconds = Math.floor((new Date() - new Date(date)) / 1000);
		if (seconds < 10) return 'just now';
		if (seconds < 60) return `${seconds}s ago`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		return `${Math.floor(seconds / 86400)}d ago`;
	},

	escapeHtml(text) {
		if (!text) return '';
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	},

	// Build an element with children. Strings become text nodes; Nodes are
	// appended as-is. Used everywhere that used to interpolate API text.
	el(tagName, attrs, ...children) {
		const element = document.createElement(tagName);
		if (attrs) {
			Object.keys(attrs).forEach((key) => {
				const value = attrs[key];
				if (value === null || value === undefined || value === false) return;
				if (key === 'class') element.className = value;
				else if (key === 'text') element.textContent = value;
				else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
				else element.setAttribute(key, value === true ? '' : String(value));
			});
		}
		children.forEach((child) => {
			if (child === null || child === undefined || child === false) return;
			element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
		});
		return element;
	}
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
	// Mobile navigation toggle (guide 19): the sidebar is fixed off-canvas under 768px.
	const navToggle = document.getElementById('nav-toggle');
	const sidebar = document.querySelector('.sidebar');
	if (navToggle && sidebar) {
		navToggle.addEventListener('click', () => {
			const open = sidebar.classList.toggle('open');
			navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
		document.addEventListener('click', (event) => {
			if (sidebar.classList.contains('open') && !sidebar.contains(event.target) && event.target !== navToggle) {
				sidebar.classList.remove('open');
				navToggle.setAttribute('aria-expanded', 'false');
			}
		});
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && sidebar.classList.contains('open')) {
				sidebar.classList.remove('open');
				navToggle.setAttribute('aria-expanded', 'false');
				navToggle.focus();
			}
		});
	}

	// Keyboard shortcut: "/" focuses the first search input on the page.
	document.addEventListener('keydown', (event) => {
		if (event.key !== '/' || Modal.isOpen()) return;
		const target = event.target;
		if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
		const search = document.querySelector('input[type="search"], input.search-input');
		if (search) {
			event.preventDefault();
			search.focus();
		}
	});
});

// Export for use in other scripts
window.Dot = { API, Toast, Modal, Utils };
