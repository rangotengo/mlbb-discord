export {};

interface PublicConfig {
  version: string;
  schemaVersion: number;
  discord: { tokenConfigured: boolean };
  challengermode: { refreshKeyConfigured: boolean };
  bot: { defaultPrefix: string; defaultToRole: string; participantRole?: string };
  database: { type: 'sqlite' | 'postgresql'; path?: string; url?: string };
  web: { port: number; autoIncrement: boolean; passwordConfigured: boolean; allowNetwork: boolean };
  logging: { level: string; webhookConfigured: boolean };
  email: { configured: boolean; sender?: string };
  setup?: { step: string; completed: string[]; updatedAt: string };
  secretStorage: { secure: boolean; warning?: string };
  restartRequired: string[];
}

interface SetupCheck {
  id: string;
  label: string;
  state: 'pass' | 'fail' | 'unavailable' | 'not-checked';
  message: string;
  recovery?: string;
}

interface BotStatus {
  running: boolean;
  connectedServers: number;
  port: number;
}

interface ElectronAPI {
  startBot: (config: unknown) => void;
  stopBot: () => void;
  getStatus: () => Promise<BotStatus>;
  getNetworkIP: () => Promise<{ local: string; network: string }>;
  getPublicConfig: () => Promise<PublicConfig>;
  validateSetup: (draft: unknown) => Promise<{ errors: { field: string; message: string; recovery?: string }[]; checks: SetupCheck[] }>;
  saveSetup: (draft: unknown) => Promise<{ publicConfig: PublicConfig; restartRequired: string[] }>;
  saveEmail: (email: unknown) => Promise<{ publicConfig: PublicConfig }>;
  runChecks: () => Promise<SetupCheck[]>;
  sendTestEmail: (to: string) => Promise<SetupCheck>;
  listBackups: () => Promise<{ id: string; createdAt: string; engine: string; from: string; to: string }[]>;
  createBackup: () => Promise<{ created: boolean; backups: { id: string; createdAt: string; engine: string }[] }>;
  supportBundle: () => Promise<{ fileName: string; text: string }>;
  openDashboard: () => Promise<{ ok: boolean; url?: string; message: string }>;
  onBotLog: (callback: (log: string) => void) => void;
  onBotStatus: (callback: (status: BotStatus) => void) => void;
  onBotError: (callback: (error: string) => void) => void;
  onConfigLoaded: (callback: (config: PublicConfig) => void) => void;
  onPortDetected: (callback: (port: number) => void) => void;
  onSetupChecks: (callback: (checks: SetupCheck[]) => void) => void;
  onAppInfo: (callback: (info: AppInfo) => void) => void;
}

interface AppInfo {
  version: string;
  secretStorage: { secure: boolean; warning?: string };
  upgradeBackup: { id: string; directory?: string } | null;
  backups: { id: string; createdAt: string; engine: string; from: string; to: string }[];
  signing: { configured: boolean; verified: false; blocker: string };
  releaseNotes: string[];
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const STEPS = ['discord', 'server', 'challengermode', 'email', 'storage', 'dashboard', 'review'] as const;
type StepId = typeof STEPS[number];

const configScreen = document.getElementById('config-screen')!;
const dashboardScreen = document.getElementById('dashboard-screen')!;
const webInterfaceScreen = document.getElementById('web-interface-screen')!;
const statusText = document.getElementById('status-text')!;
const statusDot = document.getElementById('status-dot')!;
const logContainer = document.getElementById('log-container')!;
const localUrlElement = document.getElementById('local-url')!;
const networkUrlElement = document.getElementById('network-url')!;
const statusRegion = document.getElementById('status-region')!;
const stepNav = document.getElementById('step-nav')!;

let autoScroll = true;
let publicConfig: PublicConfig | null = null;
let currentStep: StepId = 'discord';
let completed = new Set<StepId>();
let networkIP = '127.0.0.1';

document.addEventListener('DOMContentLoaded', () => {
  renderStepNav();
  bind();
  setupIPC();
  void refreshPublic();
  void loadNetwork();
});

function populateConfigForm(config: { discord?: { token?: string }; challengermode?: { refreshKey?: string }; bot?: { defaultPrefix?: string; defaultToRole?: string; participantRole?: string }; database?: { type?: string; path?: string; url?: string }; web?: { port?: number; autoIncrement?: boolean; password?: string; allowNetwork?: boolean }; logging?: { level?: string } }): void {
  input('discord-token').value = config.discord?.token || '';
  input('challengermode-refresh-key').value = config.challengermode?.refreshKey || '';
  input('bot-prefix').value = config.bot?.defaultPrefix || '!';
  input('bot-to-role').value = config.bot?.defaultToRole || 'Organizer';
  input('participant-role').value = config.bot?.participantRole || 'Participant';
  input('database-path').value = config.database?.path || '';
  input('database-url').value = config.database?.url || '';
  (document.getElementById('database-type') as HTMLSelectElement).value = config.database?.type || 'sqlite';
  input('web-port').value = String(config.web?.port ?? 3000);
  (document.getElementById('web-auto') as HTMLInputElement).checked = config.web?.autoIncrement !== false;
  (document.getElementById('web-network') as HTMLInputElement).checked = config.web?.allowNetwork === true;
  input('web-password').value = config.web?.password || '';
  publicConfig = {
    ...(publicConfig || {} as PublicConfig),
    logging: { level: config.logging?.level || publicConfig?.logging.level || 'info', webhookConfigured: false }
  } as PublicConfig;
}

function handleConfigSubmit(event: Event): void {
  event.preventDefault();
  window.electronAPI.startBot(draftFromForm());
}

Object.assign(globalThis, { populateConfigForm, handleConfigSubmit });

function bind(): void {
  document.getElementById('wizard-next')!.addEventListener('click', () => void move(1));
  document.getElementById('wizard-back')!.addEventListener('click', () => void move(-1));
  document.getElementById('start-from-wizard')!.addEventListener('click', () => void startFromWizard());
  document.getElementById('recheck-btn')!.addEventListener('click', () => void renderChecks());
  document.getElementById('save-email-btn')!.addEventListener('click', () => void saveEmail());
  document.getElementById('test-email-btn')!.addEventListener('click', () => void testEmail());
  document.getElementById('create-backup-btn')!.addEventListener('click', () => void createBackup());
  document.getElementById('web-network')!.addEventListener('change', toggleNetworkWarning);
  document.getElementById('settings-btn')!.addEventListener('click', () => showConfig());
  document.getElementById('back-from-config-btn')!.addEventListener('click', showDashboard);
  document.getElementById('start-btn')!.addEventListener('click', () => void startFromWizard());
  document.getElementById('stop-btn')!.addEventListener('click', () => window.electronAPI.stopBot());
  document.getElementById('web-interface-btn')!.addEventListener('click', () => void openDashboard());
  document.getElementById('back-to-dashboard-btn')!.addEventListener('click', hideWeb);
  document.getElementById('export-logs-btn')!.addEventListener('click', exportLogs);
  document.getElementById('support-bundle-btn')!.addEventListener('click', () => void saveSupport());
  document.getElementById('auto-scroll')!.addEventListener('change', event => {
    autoScroll = (event.target as HTMLInputElement).checked;
  });
  document.querySelectorAll('.copy-btn').forEach(button => button.addEventListener('click', copyUrl));
}

function setupIPC(): void {
  window.electronAPI.onBotLog(log => appendLog(log));
  window.electronAPI.onBotStatus(status => updateStatus(status));
  window.electronAPI.onBotError(error => {
    appendLog(error, true);
    say(error);
  });
  window.electronAPI.onConfigLoaded(config => applyPublic(config));
  window.electronAPI.onPortDetected(port => setUrls(port));
  window.electronAPI.onSetupChecks(checks => paintChecks(checks));
  window.electronAPI.onAppInfo(showAppInfo);
}

async function refreshPublic(): Promise<void> {
  try {
    applyPublic(await window.electronAPI.getPublicConfig());
  } catch {
    say('Saved settings could not be read. You can enter them again; existing secrets stay stored.');
  }
}

function applyPublic(config: PublicConfig): void {
  publicConfig = config;
  input('bot-prefix').value = config.bot.defaultPrefix || '!';
  input('bot-to-role').value = config.bot.defaultToRole || 'Organizer';
  input('participant-role').value = config.bot.participantRole || 'Participant';
  input('database-path').value = config.database.path || '';
  (document.getElementById('database-type') as HTMLSelectElement).value = config.database.type;
  input('web-port').value = String(config.web.port || 3000);
  (document.getElementById('web-auto') as HTMLInputElement).checked = config.web.autoIncrement;
  (document.getElementById('web-network') as HTMLInputElement).checked = config.web.allowNetwork;
  text('discord-token-state', config.discord.tokenConfigured ? 'A Discord token is already stored. Leave this blank to keep it, or paste a new token to replace it.' : 'No Discord token is stored yet.');
  text('challengermode-state', config.challengermode.refreshKeyConfigured ? 'A Challengermode refresh key is already stored. Leave this blank to keep it.' : 'No Challengermode refresh key is stored yet.');
  text('password-state', config.web.passwordConfigured ? 'A dashboard password is stored. Leave this blank to keep it.' : 'No dashboard password is stored.');
  text('email-result', config.email.configured ? 'Email credentials are stored. Send a test only after the bot is running.' : 'Email credentials are not stored.');
  if (config.secretStorage.warning) {
    const box = document.getElementById('storage-warning')!;
    box.textContent = config.secretStorage.warning;
    box.classList.remove('hidden');
  }
  if (config.setup) {
    currentStep = (STEPS as readonly string[]).includes(config.setup.step) ? config.setup.step as StepId : 'discord';
    completed = new Set(config.setup.completed.filter((step): step is StepId => (STEPS as readonly string[]).includes(step)));
  }
  toggleNetworkWarning();
  showStep(currentStep);
  if (config.restartRequired.length) say(`Restart the bot to apply: ${config.restartRequired.join(', ')}.`);
}

function draftFromForm(): Record<string, unknown> {
  const databaseType = (document.getElementById('database-type') as HTMLSelectElement).value;
  return {
    version: publicConfig?.version,
    schemaVersion: publicConfig?.schemaVersion,
    discord: { token: input('discord-token').value },
    challengermode: { refreshKey: input('challengermode-refresh-key').value },
    bot: {
      defaultPrefix: input('bot-prefix').value,
      defaultToRole: input('bot-to-role').value,
      participantRole: input('participant-role').value
    },
    database: {
      type: databaseType,
      path: databaseType === 'sqlite' ? input('database-path').value : undefined,
      url: input('database-url').value || undefined
    },
    web: {
      port: Number(input('web-port').value),
      autoIncrement: (document.getElementById('web-auto') as HTMLInputElement).checked,
      allowNetwork: (document.getElementById('web-network') as HTMLInputElement).checked,
      password: input('web-password').value
    },
    logging: { level: publicConfig?.logging.level || 'info', webhook: undefined },
    email: { configured: publicConfig?.email?.configured === true, sender: publicConfig?.email?.sender },
    setup: { step: currentStep, completed: [...completed], updatedAt: new Date().toISOString() }
  };
}

async function move(direction: number): Promise<void> {
  if (direction > 0) {
    const result = await window.electronAPI.validateSetup(draftFromForm());
    const stepErrors = result.errors.filter(error => fieldMatchesStep(error.field, currentStep));
    if (stepErrors.length && currentStep !== 'review' && currentStep !== 'email' && currentStep !== 'server') {
      say(stepErrors.map(error => `${error.message}. ${error.recovery || ''}`).join(' '));
      return;
    }
    completed.add(currentStep);
    const saved = await window.electronAPI.saveSetup(draftFromForm());
    publicConfig = saved.publicConfig;
    clearSecretInputs();
    if (saved.restartRequired.length) say(`Saved. Restart the bot to apply: ${saved.restartRequired.join(', ')}.`);
  }
  const index = Math.min(STEPS.length - 1, Math.max(0, STEPS.indexOf(currentStep) + direction));
  showStep(STEPS[index]);
  if (STEPS[index] === 'review') await renderChecks();
  if (STEPS[index] === 'storage') await renderBackups();
}

function fieldMatchesStep(field: string, step: StepId): boolean {
  const map: Record<StepId, string[]> = {
    discord: ['discord-token'],
    server: ['bot-prefix', 'bot-to-role'],
    challengermode: ['challengermode-refresh-key'],
    email: [],
    storage: ['database-type', 'database-url', 'database-path'],
    dashboard: ['web-port', 'web-password', 'web-network'],
    review: []
  };
  return map[step].includes(field);
}

function showStep(step: StepId): void {
  currentStep = step;
  document.querySelectorAll('.wizard-step').forEach(section => {
    section.classList.toggle('hidden', (section as HTMLElement).dataset.step !== step);
  });
  renderStepNav();
  document.getElementById('wizard-back')!.toggleAttribute('disabled', step === 'discord');
  document.getElementById('wizard-next')!.classList.toggle('hidden', step === 'review');
}

function renderStepNav(): void {
  stepNav.replaceChildren();
  const labels: Record<StepId, string> = {
    discord: 'Discord',
    server: 'Server',
    challengermode: 'Challengermode',
    email: 'Email',
    storage: 'Storage',
    dashboard: 'Dashboard',
    review: 'Checklist'
  };
  for (const step of STEPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labels[step];
    if (step === currentStep) button.setAttribute('aria-current', 'step');
    if (completed.has(step)) button.classList.add('done');
    button.addEventListener('click', () => showStep(step));
    stepNav.appendChild(button);
  }
}

async function renderChecks(): Promise<void> {
  paintChecks(await window.electronAPI.runChecks());
}

function paintChecks(checks: SetupCheck[]): void {
  const list = document.getElementById('check-list')!;
  list.replaceChildren();
  for (const check of checks) {
    const item = document.createElement('li');
    const state = document.createElement('span');
    state.className = `state state-${check.state}`;
    state.textContent = labelFor(check.state);
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = check.label;
    const message = document.createElement('p');
    message.textContent = check.message;
    body.append(title, message);
    if (check.recovery) {
      const recovery = document.createElement('p');
      recovery.className = 'recovery';
      recovery.textContent = check.recovery;
      body.append(recovery);
    }
    item.append(state, body);
    list.appendChild(item);
  }
}

function labelFor(state: SetupCheck['state']): string {
  if (state === 'pass') return 'Passed';
  if (state === 'fail') return 'Needs action';
  if (state === 'unavailable') return 'Not available';
  return 'Not checked';
}

async function startFromWizard(): Promise<void> {
  const button = document.getElementById('start-from-wizard') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    const saved = await window.electronAPI.saveSetup({ ...draftFromForm(), setup: { step: 'review', completed: [...completed, currentStep], updatedAt: new Date().toISOString() } });
    publicConfig = saved.publicConfig;
    clearSecretInputs();
    window.electronAPI.startBot(draftFromForm());
    say(saved.restartRequired.length ? `Starting. These changes apply on this start: ${saved.restartRequired.join(', ')}.` : 'Starting the bot.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveEmail(): Promise<void> {
  const result = await window.electronAPI.saveEmail({
    clientId: input('google-client-id').value,
    clientSecret: input('google-client-secret').value,
    refreshToken: input('google-refresh-token').value,
    tokenUri: input('google-token-uri').value,
    sender: publicConfig?.email.sender
  });
  publicConfig = result.publicConfig;
  input('google-client-id').value = '';
  input('google-client-secret').value = '';
  input('google-refresh-token').value = '';
  text('email-result', result.publicConfig.email.configured ? 'Email credentials stored. Restart the bot, then send a test.' : 'Email credentials were not complete, so delivery stays unavailable.');
}

async function testEmail(): Promise<void> {
  const check = await window.electronAPI.sendTestEmail(input('email-test-to').value);
  text('email-result', `${labelFor(check.state)}: ${check.message}${check.recovery ? ` ${check.recovery}` : ''}`);
}

async function createBackup(): Promise<void> {
  await window.electronAPI.saveSetup(draftFromForm());
  const result = await window.electronAPI.createBackup();
  say(result.created ? 'Backup created. Restore is a manual file copy while the bot is stopped.' : 'No backup was created.');
  await renderBackups();
}

async function renderBackups(): Promise<void> {
  const backups = await window.electronAPI.listBackups();
  const list = document.getElementById('backup-list')!;
  list.replaceChildren();
  if (!backups.length) {
    const item = document.createElement('li');
    item.textContent = 'No desktop backups yet. One is created automatically when the app version changes.';
    list.appendChild(item);
    return;
  }
  for (const backup of backups) {
    const item = document.createElement('li');
    item.textContent = `${backup.createdAt}: ${backup.engine} data from ${backup.from} to ${backup.to}. Restore manually while the bot is stopped.`;
    list.appendChild(item);
  }
}

function clearSecretInputs(): void {
  for (const id of ['discord-token', 'challengermode-refresh-key', 'web-password', 'database-url']) input(id).value = '';
}

function toggleNetworkWarning(): void {
  document.getElementById('network-warning')!.classList.toggle('hidden', !(document.getElementById('web-network') as HTMLInputElement).checked);
}

function showConfig(): void {
  configScreen.classList.remove('hidden');
  dashboardScreen.classList.add('hidden');
  webInterfaceScreen.classList.add('hidden');
  document.getElementById('back-from-config-btn')!.classList.toggle('hidden', statusText.textContent !== 'Running');
}

function showDashboard(): void {
  configScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  webInterfaceScreen.classList.add('hidden');
}

function updateStatus(status: BotStatus): void {
  const running = status.running;
  statusDot.classList.toggle('running', running);
  statusText.textContent = running ? 'Running' : 'Stopped';
  document.getElementById('start-btn')!.classList.toggle('hidden', running);
  document.getElementById('stop-btn')!.classList.toggle('hidden', !running);
  setUrls(status.port);
  if (running) showDashboard();
}

function setUrls(port: number): void {
  localUrlElement.textContent = `http://127.0.0.1:${port}`;
  const networkEnabled = publicConfig?.web.allowNetwork === true;
  networkUrlElement.textContent = networkEnabled ? `http://${networkIP}:${port}` : 'Network access is off';
  document.getElementById('network-row')!.classList.toggle('hidden', !networkEnabled);
}

async function loadNetwork(): Promise<void> {
  try {
    const ips = await window.electronAPI.getNetworkIP();
    networkIP = ips.network;
    setUrls(publicConfig?.web.port || 3000);
  } catch {
    networkIP = '127.0.0.1';
  }
}

async function openDashboard(): Promise<void> {
  const result = await window.electronAPI.openDashboard();
  text('dashboard-message', result.message);
  if (!result.url) return;
  dashboardScreen.classList.add('hidden');
  webInterfaceScreen.classList.remove('hidden');
  (document.getElementById('web-iframe') as HTMLIFrameElement).src = result.url;
}

function hideWeb(): void {
  webInterfaceScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  (document.getElementById('web-iframe') as HTMLIFrameElement).src = 'about:blank';
}

function appendLog(log: string, isError = false): void {
  for (const line of log.trim().split('\n')) {
    if (!line.trim()) continue;
    const row = document.createElement('div');
    row.className = `log-line ${isError ? 'log-error' : 'log-info'}`;
    row.textContent = line;
    logContainer.appendChild(row);
    while (logContainer.children.length > 1000) logContainer.removeChild(logContainer.firstChild!);
  }
  if (autoScroll) logContainer.scrollTop = logContainer.scrollHeight;
}

function exportLogs(): void {
  download(logContainer.innerText, `mlbb-bot-logs-${new Date().toISOString().slice(0, 10)}.txt`);
}

async function saveSupport(): Promise<void> {
  const bundle = await window.electronAPI.supportBundle();
  download(bundle.text, bundle.fileName);
}

function download(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function copyUrl(event: Event): void {
  const target = (event.currentTarget as HTMLElement).dataset.target;
  const value = target ? document.getElementById(target)?.textContent || '' : '';
  if (!value || value.startsWith('Network access')) return;
  void navigator.clipboard.writeText(value);
}

function showAppInfo(info: AppInfo): void {
  text('version-line', `Version ${info.version}`);
  text('signing-note', info.signing.blocker);
  const notes = document.getElementById('release-notes')!;
  notes.replaceChildren();
  for (const note of info.releaseNotes) {
    const item = document.createElement('li');
    item.textContent = note;
    notes.appendChild(item);
  }
  if (info.upgradeBackup) say('An upgrade backup was created before this version started. Restore it manually if the new version fails.');
  if (!info.secretStorage.secure && info.secretStorage.warning) {
    const box = document.getElementById('storage-warning')!;
    box.textContent = info.secretStorage.warning;
    box.classList.remove('hidden');
  }
}

function say(message: string): void {
  statusRegion.textContent = message;
}

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function text(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}
