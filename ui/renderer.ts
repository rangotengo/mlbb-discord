// Type definitions for Electron API
export {};

interface BotConfig {
  version: string;
  discord: { token: string };
  challonge: { username: string; token: string };
  bot: {
    defaultPrefix: string;
    defaultToRole: string;
    participantRole?: string;
  };
  database: { type: string; path?: string; url?: string };
  web: {
    port: number;
    autoIncrement: boolean;
    password?: string;
  };
  logging: { webhook?: string; level: string };
}

interface BotStatus {
  running: boolean;
  connectedServers: number;
  port: number;
}

interface ElectronAPI {
  startBot: (config: BotConfig) => void;
  stopBot: () => void;
  getStatus: () => Promise<BotStatus>;
  getNetworkIP: () => Promise<{ local: string; network: string }>;
  onBotLog: (callback: (log: string) => void) => void;
  onBotStatus: (callback: (status: BotStatus) => void) => void;
  onBotError: (callback: (error: string) => void) => void;
  onConfigLoaded: (callback: (config: BotConfig) => void) => void;
  onPortDetected: (callback: (port: number) => void) => void;
  removeAllListeners?: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// DOM elements
const configScreen = document.getElementById('config-screen')!;
const dashboardScreen = document.getElementById('dashboard-screen')!;
const configForm = document.getElementById('config-form')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const logContainer = document.getElementById('log-container')!;
const localUrlElement = document.getElementById('local-url')!;
const networkUrlElement = document.getElementById('network-url')!;
const autoScrollCheckbox = document.getElementById('auto-scroll') as HTMLInputElement;

const webInterfaceScreen = document.getElementById('web-interface-screen')!;
const webIframe = document.getElementById('web-iframe') as HTMLIFrameElement;
const backToDashboardBtn = document.getElementById('back-to-dashboard-btn')!;
const backFromConfigBtn = document.getElementById('back-from-config-btn')!;
const startBtn = document.getElementById('start-btn')!;
const stopBtn = document.getElementById('stop-btn')!;

let autoScroll = true;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupIPCHandlers();
  loadNetworkInfo();
});

function setupEventListeners(): void {
  configForm.addEventListener('submit', handleConfigSubmit);
  document.getElementById('load-config')?.addEventListener('click', loadConfigFromFile);
  startBtn.addEventListener('click', handleStartBot);
  stopBtn.addEventListener('click', handleStopBot);
  document.getElementById('settings-btn')?.addEventListener('click', () => showConfigScreen());
  backFromConfigBtn.addEventListener('click', showDashboard);
  document.getElementById('web-interface-btn')?.addEventListener('click', openWebInterface);
  document.getElementById('export-logs-btn')?.addEventListener('click', exportLogs);
  backToDashboardBtn.addEventListener('click', hideWebInterface);
  autoScrollCheckbox?.addEventListener('change', (e) => {
    autoScroll = (e.target as HTMLInputElement).checked;
  });
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', handleCopyUrl);
  });
}

function setupIPCHandlers(): void {
  window.electronAPI.onBotLog((log: string) => {
    appendLog(log);
  });

  window.electronAPI.onBotStatus((status: BotStatus) => {
    updateStatus(status);
    // Only show dashboard when bot is actually running
    if (status.running) {
      showDashboard();
      // Clear stored config on successful start
      try {
        localStorage.removeItem('mlbb-bot-config');
      } catch (err) {
        console.warn('Could not clear config from localStorage:', err);
      }
    }
  });

  window.electronAPI.onBotError((error: string) => {
    appendLog(`ERROR: ${error}`, true);
    alert(`Bot error: ${error}\n\nYour configuration has been saved. Please check the logs and try again.`);
    // Restore form values from localStorage
    restoreFormFromStorage();
    // Reset submit button depending on status
    const submitBtn = configForm.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (submitBtn) {
      submitBtn.textContent = statusText.textContent === 'Running' ? 'Save and restart' : 'Save and start';
      submitBtn.disabled = false;
    }
  });

  window.electronAPI.onConfigLoaded((config: BotConfig) => {
    populateConfigForm(config);
    // Don't show dashboard yet - wait for bot status
  });

  window.electronAPI.onPortDetected?.((port: number) => {
    localUrlElement.textContent = `http://localhost:${port}`;
    const networkUrlText = networkUrlElement.textContent || '';
    const networkIP = networkUrlText.split('://')[1]?.split(':')[0] || 'localhost';
    networkUrlElement.textContent = `http://${networkIP}:${port}`;
  });
}

async function loadNetworkInfo(): Promise<void> {
  try {
    const ips = await window.electronAPI.getNetworkIP();
    localUrlElement.textContent = `http://${ips.local}:3000`;
    networkUrlElement.textContent = `http://${ips.network}:3000`;
  } catch (error) {
    console.error('Failed to get network IP:', error);
  }
}

function showConfigScreen(): void {
  configScreen.classList.remove('hidden');
  dashboardScreen.classList.add('hidden');
  webInterfaceScreen.classList.add('hidden');

  const submitBtn = configForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  const isRunning = statusText.textContent === 'Running';
  
  if (isRunning) {
    backFromConfigBtn.classList.remove('hidden');
    if (submitBtn) submitBtn.textContent = 'Save and restart';
  } else {
    backFromConfigBtn.classList.add('hidden');
    if (submitBtn) submitBtn.textContent = 'Save and start';
  }
}

function showDashboard(): void {
  configScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  webInterfaceScreen.classList.add('hidden');
}

function populateConfigForm(config: BotConfig): void {
  (document.getElementById('discord-token') as HTMLInputElement).value = config.discord.token;
  (document.getElementById('challonge-username') as HTMLInputElement).value = config.challonge.username;
  (document.getElementById('challonge-token') as HTMLInputElement).value = config.challonge.token;
  (document.getElementById('bot-prefix') as HTMLInputElement).value = config.bot.defaultPrefix;
  (document.getElementById('bot-to-role') as HTMLInputElement).value = config.bot.defaultToRole;
  (document.getElementById('web-password') as HTMLInputElement).value = config.web.password || '';
}

function restoreFormFromStorage(): void {
  try {
    const stored = localStorage.getItem('mlbb-bot-config');
    if (stored) {
      const config = JSON.parse(stored) as BotConfig;
      populateConfigForm(config);
    }
  } catch (err) {
    console.warn('Could not restore config from localStorage:', err);
  }
}

interface ValidationError {
  field: string;
  message: string;
}

function validateFormConfig(): ValidationError[] {
  const discordToken = (document.getElementById('discord-token') as HTMLInputElement).value;
  const challongeUsername = (document.getElementById('challonge-username') as HTMLInputElement).value;
  const challongeToken = (document.getElementById('challonge-token') as HTMLInputElement).value;
  const botPrefix = (document.getElementById('bot-prefix') as HTMLInputElement).value;
  const botToRole = (document.getElementById('bot-to-role') as HTMLInputElement).value;

  // Validation rules
  const errors: ValidationError[] = [];

  if (!discordToken) {
    errors.push({ field: 'discord-token', message: 'Discord token is required' });
  } else if (discordToken.length < 50) {
    errors.push({ field: 'discord-token', message: 'Discord token appears invalid (too short)' });
  }

  if (!challongeUsername) {
    errors.push({ field: 'challonge-username', message: 'Username is required' });
  }

  if (!challongeToken) {
    errors.push({ field: 'challonge-token', message: 'API key is required' });
  } else if (challongeToken.length < 20) {
    errors.push({ field: 'challonge-token', message: 'API key appears invalid (too short)' });
  }

  if (!botPrefix) {
    errors.push({ field: 'bot-prefix', message: 'Prefix is required' });
  } else if (botPrefix.length > 10) {
    errors.push({ field: 'bot-prefix', message: 'Prefix should be 10 characters or less' });
  }

  if (!botToRole) {
    errors.push({ field: 'bot-to-role', message: 'TO role name is required' });
  }

  return errors;
}

function handleConfigSubmit(e: Event): void {
  e.preventDefault();
  const submitBtn = configForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  const config: BotConfig = {
    version: '1.0.0',
    discord: { token: (document.getElementById('discord-token') as HTMLInputElement).value },
    challonge: {
      username: (document.getElementById('challonge-username') as HTMLInputElement).value,
      token: (document.getElementById('challonge-token') as HTMLInputElement).value
    },
    bot: {
      defaultPrefix: (document.getElementById('bot-prefix') as HTMLInputElement).value,
      defaultToRole: (document.getElementById('bot-to-role') as HTMLInputElement).value
    },
    database: { type: 'sqlite', path: 'C:/mlbb-data/database/dot.db' },
    web: {
      port: 3000,
      autoIncrement: true,
      password: (document.getElementById('web-password') as HTMLInputElement).value || undefined
    },
    logging: { level: 'info' }
  };

  // Validation
  const errors = validateFormConfig();
  if (errors.length > 0) {
    alert('Configuration errors:\n' + errors.map(e => `• ${e.message}`).join('\n'));
    return;
  }

  // Store form values in localStorage for recovery on error
  try {
    localStorage.setItem('mlbb-bot-config', JSON.stringify(config));
  } catch (err) {
    console.warn('Could not store config in localStorage:', err);
  }

  // Show loading state
  if (submitBtn) {
    submitBtn.textContent = statusText.textContent === 'Running' ? 'Restarting…' : 'Starting…';
    submitBtn.disabled = true;
  }

  // Don't show dashboard yet - wait for bot-status event
  window.electronAPI.startBot(config);
}

function handleStartBot(): void {
  // Use config from form to start bot
  const submitBtn = configForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  if (submitBtn) submitBtn.click();
}

function loadConfigFromFile(): void {
  // Config is auto-loaded by Electron, this button is for manual reload
  window.location.reload();
}

function handleStopBot(): void {
  if (confirm('Are you sure you want to stop the bot?')) {
    window.electronAPI.stopBot();
    // Status update will be handled by onBotStatus listener
  }
}

function updateStatus(status: BotStatus): void {
  if (status.running) {
    statusDot.classList.add('running');
    statusText.textContent = 'Running';
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');

    // Reset submit button if it was in loading state
    const submitBtn = document.querySelector('#config-form button[type="submit"]') as HTMLButtonElement;
    if (submitBtn && submitBtn.disabled) {
      submitBtn.textContent = 'Save and restart';
      submitBtn.disabled = false;
    }
  } else {
    statusDot.classList.remove('running');
    statusText.textContent = 'Stopped';
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    // If we're on config screen, also reset the submit button text
    const submitBtn = document.querySelector('#config-form button[type="submit"]') as HTMLButtonElement;
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.textContent = 'Save and start';
    }
  }
}

function appendLog(log: string, isError = false): void {
  const lines = log.trim().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      const div = document.createElement('div');
      div.className = `log-line ${isError ? 'log-error' : 'log-info'}`;
      div.textContent = line;
      logContainer.appendChild(div);

      // Keep only last 1000 lines
      while (logContainer.children.length > 1000) {
        logContainer.removeChild(logContainer.firstChild!);
      }

      if (autoScroll) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
  });
}

function openWebInterface(): void {
  dashboardScreen.classList.add('hidden');
  webInterfaceScreen.classList.remove('hidden');
  
  // Get port from local url element
  const localUrl = localUrlElement.textContent || 'http://localhost:3000';
  webIframe.src = localUrl;
}

function hideWebInterface(): void {
  webInterfaceScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  webIframe.src = 'about:blank'; // Clear iframe to save resources
}

function exportLogs(): void {
  const logs = logContainer.innerText;
  const blob = new Blob([logs], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mlbb-bot-logs-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleCopyUrl(e: Event): void {
  const target = (e.currentTarget as HTMLElement).dataset.target;
  if (target) {
    const urlElement = document.getElementById(target);
    if (urlElement) {
      navigator.clipboard.writeText(urlElement.textContent || '');
      const btn = e.currentTarget as HTMLElement;
      const originalText = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  }
}
