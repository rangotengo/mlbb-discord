import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as os from 'os';
import { randomBytes } from 'crypto';
import * as Electron from 'electron';
import type { BrowserWindow as BrowserWindowType, Session } from 'electron';
import {
  APP_SCHEMA_VERSION,
  BotConfig,
  BotStatus,
  PublicConfig,
  configForValidation,
  configToEnv,
  defaultConfig,
  getConfigPath,
  loadConfig,
  materialiseConfig,
  saveConfig,
  saveEmailSecrets,
  toPublic
} from './config';
import { loadSecrets } from './secrets';
import { secretStoreStatus, secretsFilePath } from './secrets';
import { findAvailablePort } from './port-detector';
import { displayErrors, validateConfig } from './config-validator';
import { localChecks, interpretReadiness, interpretEmailTest, ReadinessPayload, SetupCheck } from './checks';
import { createPreUpgradeBackup, listBackups, BackupManifest } from './backup';
import { decideSingleInstance, decideWindowClose, requestShutdown } from './lifecycle';
import { signingStatus, smokePackage } from './smoke';

const { app, BrowserWindow, ipcMain } = Electron;

let mainWindow: BrowserWindowType | null = null;
let botProcess: ChildProcess | null = null;
let currentConfig: BotConfig | null = null;
let quitting = false;
let bootstrapToken = '';
let lastPort = 3000;

const VERSION_FILE = 'installed-version.json';

function userData(): string {
  return app.getPath('userData');
}

function installedVersionPath(): string {
  return path.join(userData(), VERSION_FILE);
}

function readInstalledVersion(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(installedVersionPath(), 'utf-8')) as { version?: string };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function writeInstalledVersion(version: string): void {
  const file = installedVersionPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version, schemaVersion: APP_SCHEMA_VERSION, writtenAt: new Date().toISOString() }, null, 2));
  fs.renameSync(temp, file);
}

function backupBeforeUpgrade(config: BotConfig | null): BackupManifest | null {
  const previous = readInstalledVersion();
  const current = app.getVersion();
  if (!previous || previous === current) {
    if (!previous) writeInstalledVersion(current);
    return null;
  }
  const result = createPreUpgradeBackup({
    userDataDir: userData(),
    appVersionFrom: previous,
    appVersionTo: current,
    schemaVersion: config?.schemaVersion ?? null,
    engine: config?.database.type === 'postgresql' ? 'postgresql' : 'sqlite',
    sqlitePath: config?.database.type === 'postgresql' ? undefined : config?.database.path,
    configPath: getConfigPath(),
    secretsPath: secretsFilePath(),
    reason: 'upgrade'
  });
  writeInstalledVersion(current);
  return result.manifest ?? null;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../../ui/index.html'));

  mainWindow.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Save File',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      buttonLabel: 'Save'
    });
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') Electron.shell.showItemInFolder(item.getSavePath());
    });
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const existing = loadConfig();
  const upgrade = backupBeforeUpgrade(existing);
  if (existing) currentConfig = existing;
  mainWindow.webContents.on('did-finish-load', () => {
    const storage = secretStoreStatus();
    if (existing && mainWindow) {
      mainWindow.webContents.send('config-loaded', toPublic(existing, storage));
    }
    mainWindow?.webContents.send('app-info', {
      version: app.getVersion(),
      secretStorage: storage,
      upgradeBackup: upgrade,
      backups: summariseBackups(),
      signing: signingStatus(readBuilderConfig()),
      releaseNotes: releaseNotes()
    });
  });

  mainWindow.on('close', event => {
    const action = decideWindowClose(process.platform, quitting);
    if (action === 'hide') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function readBuilderConfig(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'app', 'electron-builder.yml'),
    path.join(__dirname, '../../electron-builder.yml')
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf-8');
    } catch {
      // Try the next location.
    }
  }
  return '';
}

function releaseNotes(): string[] {
  return [
    'Setup is a guided checklist. Each integration is checked on its own.',
    'Dashboard access uses a one-time local session. Loopback alone is not a login.',
    'Credentials are stored in the operating system key store when that is available.',
    'Closing the window on macOS hides it. Quit stops the bot.',
    'A second copy of the app will not start another bot against the same database.',
    'Installers produced without signing credentials are not signed.'
  ];
}

function summariseBackups(): { id: string; createdAt: string; engine: string; from: string; to: string }[] {
  return listBackups(userData()).slice(0, 5).map(item => ({
    id: item.id,
    createdAt: item.createdAt,
    engine: item.engine,
    from: item.appVersionFrom,
    to: item.appVersionTo
  }));
}

function getNetworkIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function findNodeBinary(): string | null {
  const electronNodeBin = process.execPath.replace(/electron/i, 'node');
  if (electronNodeBin !== process.execPath && fs.existsSync(electronNodeBin)) return electronNodeBin;

  const commonPaths = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    path.join(os.homedir(), '.nvm/current/bin/node'),
    path.join(os.homedir(), '.local/share/fnm/aliases/default/bin/node')
  ];
  const nvmDir = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      for (const ver of fs.readdirSync(nvmDir).sort().reverse()) commonPaths.push(path.join(nvmDir, ver, 'bin/node'));
    } catch {
      // Ignore unreadable version directories.
    }
  }
  for (const nodePath of commonPaths) {
    if (fs.existsSync(nodePath)) return nodePath;
  }
  try {
    const whichResult = execSync('which node', {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${process.env.PATH || ''}:/usr/local/bin:/opt/homebrew/bin:/usr/bin` }
    }).trim();
    if (whichResult && fs.existsSync(whichResult)) return whichResult;
  } catch {
    // node is not on PATH.
  }
  return 'node';
}

function mergeDraft(draft: BotConfig): BotConfig {
  const stored = loadSecrets();
  const config = materialiseConfig(draft, {});
  const keep = (incoming: string | undefined, saved: string | undefined): string | undefined => incoming ? incoming : saved;
  config.discord.token = keep(draft.discord?.token, stored.discordToken) ?? '';
  config.challengermode.refreshKey = keep(draft.challengermode?.refreshKey, stored.challengermodeRefreshKey) ?? '';
  config.web.password = keep(draft.web?.password, stored.webPassword);
  config.database.url = keep(draft.database?.url, stored.databaseUrl);
  return config;
}

function publicConfig(): PublicConfig {
  const config = currentConfig ?? loadConfig() ?? defaultConfig();
  return toPublic(config, secretStoreStatus());
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function startBot(incoming: BotConfig): Promise<void> {
  const merged = mergeDraft(incoming);
  const saved = saveConfig(merged);
  currentConfig = loadConfig() ?? merged;

  const errors = validateConfig(configForValidation(currentConfig));
  if (errors.length) {
    send('setup-checks', localChecks(configForValidation(currentConfig)));
    send('bot-error', displayErrors(errors));
    return;
  }
  if (botProcess) stopBot();

  let port = currentConfig.web.port;
  if (currentConfig.web.autoIncrement) {
    try {
      port = await findAvailablePort(port);
    } catch {
      send('bot-error', 'Could not find an available port. Stop the program using the port, or choose another one.');
      return;
    }
  }
  currentConfig = { ...currentConfig, web: { ...currentConfig.web, port } };
  saveConfig(currentConfig);
  lastPort = port;
  send('port-detected', { port });

  bootstrapToken = randomBytes(32).toString('hex');
  const env = configToEnv(currentConfig, {
    MLBB_CONFIG_PATH: getConfigPath(),
    MLBB_DESKTOP_BOOTSTRAP: bootstrapToken,
    WEB_PORT: port.toString(),
    WEB_BIND: currentConfig.web.allowNetwork ? '0.0.0.0' : '127.0.0.1'
  });

  const nodeExec = findNodeBinary();
  if (!nodeExec) {
    send('bot-error', 'Could not find Node.js. Install Node.js 24 or newer, then start the bot again.');
    return;
  }

  const botPath = path.join(__dirname, '../index.js');
  botProcess = spawn(nodeExec, [botPath], {
    env: { ...process.env, ...env },
    stdio: 'pipe',
    windowsHide: true,
    cwd: path.dirname(botPath)
  });

  botProcess.stdout?.on('data', (data: Buffer) => {
    send('bot-log', redactSecrets(data.toString()));
  });
  botProcess.stderr?.on('data', (data: Buffer) => {
    send('bot-log', redactSecrets(data.toString()));
  });
  botProcess.on('error', (error: Error) => {
    send('bot-error', `The bot could not start: ${error.message}`);
  });
  botProcess.on('exit', (code, signal) => {
    send('bot-status', { running: false, connectedServers: 0, port, pid: undefined } satisfies BotStatus);
    botProcess = null;
    if (code !== 0 && code !== null && !quitting) {
      send('bot-error', signal ? `The bot was stopped by signal ${signal}.` : `The bot stopped with code ${code}. Your settings were kept. Read the log, fix the reported step, and start again.`);
    }
  });

  setTimeout(() => {
    if (botProcess) send('bot-status', { running: true, connectedServers: 0, port, pid: botProcess.pid } satisfies BotStatus);
  }, 1000);

  void saved;
}

function redactSecrets(text: string): string {
  const secrets = [
    currentConfig?.discord.token,
    currentConfig?.challengermode.refreshKey,
    currentConfig?.web.password,
    bootstrapToken
  ].filter((value): value is string => typeof value === 'string' && value.length > 8);
  let output = text;
  for (const secret of secrets) output = output.split(secret).join('[redacted]');
  return output;
}

function stopBot(): void {
  requestShutdown(botProcess, child => child.kill('SIGKILL'), 5000);
  botProcess = null;
}

async function openDashboard(session: Session): Promise<{ ok: boolean; url?: string; message: string }> {
  const port = currentConfig?.web.port || lastPort;
  const base = `http://127.0.0.1:${port}`;
  const healthy = await waitForHealth(base);
  if (!healthy) {
    return { ok: false, message: 'The dashboard is not responding yet. Wait for the bot log to say it is listening, then try Web Interface again.' };
  }
  if (!bootstrapToken) {
    return { ok: false, url: `${base}/login`, message: 'This start did not create a dashboard session. Sign in with the access password, or restart the bot.' };
  }
  const token = bootstrapToken;
  bootstrapToken = '';
  try {
    const response = await session.fetch(`${base}/login/desktop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, path: '/tournaments' }),
      redirect: 'manual'
    });
    if (response.status === 303 || response.status === 302 || response.ok) {
      return { ok: true, url: `${base}/tournaments`, message: 'Dashboard session started.' };
    }
    return { ok: false, url: `${base}/login`, message: `The dashboard rejected the local session (HTTP ${response.status}). Sign in with the access password.` };
  } catch (error) {
    return { ok: false, url: `${base}/login`, message: `Could not open the dashboard: ${error instanceof Error ? error.message : 'connection failed'}.` };
  }
}

async function waitForHealth(base: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return true;
    } catch {
      // The listener may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function dashboardSession(): Session | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.session : null;
}

async function readCsrf(session: Session, base: string): Promise<string | null> {
  try {
    const response = await session.fetch(`${base}/api/csrf`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const body = await response.json() as { data?: { token?: string } };
    return typeof body.data?.token === 'string' ? body.data.token : null;
  } catch {
    return null;
  }
}

async function probeJson(pathname: string, init?: RequestInit): Promise<{ available: boolean; status: number; body: unknown }> {
  const session = dashboardSession();
  const port = currentConfig?.web.port || lastPort;
  const base = `http://127.0.0.1:${port}`;
  if (!session) return { available: false, status: 0, body: null };
  try {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    if (init?.method && init.method !== 'GET') {
      const token = await readCsrf(session, base);
      if (!token) return { available: false, status: 401, body: { success: false, error: 'Dashboard session is not ready.' } };
      headers.set('X-CSRF-Token', token);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const response = await session.fetch(`${base}${pathname}`, { ...init, headers });
    const body = await response.json().catch(() => null);
    if (response.status === 404) return { available: false, status: 404, body };
    return { available: true, status: response.status, body };
  } catch {
    return { available: false, status: 0, body: null };
  }
}

async function liveChecks(): Promise<SetupCheck[]> {
  const local = currentConfig ? localChecks(configForValidation(currentConfig)) : [];
  const probe = await probeJson('/api/system/readiness');
  if (probe.status === 401) {
    return [...local, {
      id: 'readiness',
      label: 'Live readiness',
      state: 'fail' as const,
      message: 'The dashboard is running, but this app has not opened an authenticated session yet.',
      recovery: 'Use Open dashboard once. Live checks then use that session and do not call Challengermode on their own.'
    }];
  }
  const payload = probe.available && isRecord(probe.body) && isRecord((probe.body as { data?: unknown }).data)
    ? (probe.body as { data: ReadinessPayload }).data
    : null;
  return [...local, ...interpretReadiness(payload, probe.status === 200 && payload !== null)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function supportBundle(): { fileName: string; text: string } {
  const storage = secretStoreStatus();
  const checks = currentConfig ? localChecks(configForValidation(currentConfig)) : [];
  const text = [
    `MLBB Tournament Bot support bundle`,
    `App version: ${app.getVersion()}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Electron: ${process.versions.electron}`,
    `Secret storage: ${storage.backend}${storage.secure ? '' : ' (fallback file)'}`,
    `Bot running: ${botProcess !== null}`,
    `Dashboard bind: ${currentConfig?.web.allowNetwork ? '0.0.0.0' : '127.0.0.1'}`,
    `Port: ${currentConfig?.web.port ?? 'unset'}`,
    `Database: ${currentConfig?.database.type ?? 'unset'}`,
    '',
    'Local checks:',
    ...checks.map(check => `- ${check.id}: ${check.state} — ${check.message}`),
    '',
    'No tokens, passwords, refresh keys, or participant emails are included.',
    'Signing: not verified in this environment.'
  ].join('\n');
  return { fileName: `mlbb-support-${new Date().toISOString().slice(0, 10)}.txt`, text };
}

function registerIpcHandlers(): void {
  ipcMain.handle('get-status', (): BotStatus => ({
    running: botProcess !== null,
    connectedServers: 0,
    port: currentConfig?.web.port || 3000,
    pid: botProcess?.pid
  }));

  ipcMain.handle('get-network-ip', () => ({ local: '127.0.0.1', network: getNetworkIP() }));

  ipcMain.handle('get-public-config', () => publicConfig());

  ipcMain.handle('validate-setup', (_event, draft: BotConfig) => {
    const config = mergeDraft(draft);
    const errors = validateConfig(config);
    return { errors, checks: localChecks(config) };
  });

  ipcMain.handle('save-setup', (_event, draft: BotConfig) => {
    const config = mergeDraft(draft);
    const saved = saveConfig(config);
    currentConfig = loadConfig();
    return { publicConfig: publicConfig(), restartRequired: saved.restartRequired };
  });

  ipcMain.handle('save-email', (_event, email: { clientId?: string; clientSecret?: string; refreshToken?: string; tokenUri?: string; sender?: string }) => {
    saveEmailSecrets({
      googleClientId: email.clientId,
      googleClientSecret: email.clientSecret,
      googleRefreshToken: email.refreshToken,
      googleTokenUri: email.tokenUri
    });
    if (currentConfig) {
      currentConfig.email = {
        configured: Boolean(email.clientId && email.clientSecret && email.refreshToken) || currentConfig.email?.configured === true,
        sender: email.sender || currentConfig.email?.sender,
        tokenUri: email.tokenUri || currentConfig.email?.tokenUri
      };
      saveConfig(currentConfig);
    }
    return { publicConfig: publicConfig() };
  });

  ipcMain.handle('run-checks', async () => liveChecks());

  ipcMain.handle('send-test-email', async (_event, to: string) => {
    const probe = await probeJson('/api/system/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to })
    });
    const data = probe.available && isRecord(probe.body) && isRecord((probe.body as { data?: unknown }).data)
      ? (probe.body as { data: { accepted?: boolean; reason?: string; detail?: string } }).data
      : null;
    if (probe.status === 401) {
      return interpretEmailTest(null, false);
    }
    if (probe.status === 429) {
      return { id: 'email-test', label: 'Test email', state: 'fail', message: 'A test email was sent recently. Wait a minute before trying again.', recovery: 'Use the last result. Sending again does not prove a new delivery.' };
    }
    return interpretEmailTest(data, probe.available && probe.status !== 404);
  });

  ipcMain.handle('list-backups', () => summariseBackups());

  ipcMain.handle('create-backup', () => {
    const config = currentConfig ?? loadConfig();
    const result = createPreUpgradeBackup({
      userDataDir: userData(),
      appVersionFrom: app.getVersion(),
      appVersionTo: app.getVersion(),
      schemaVersion: config?.schemaVersion ?? null,
      engine: config?.database.type === 'postgresql' ? 'postgresql' : 'sqlite',
      sqlitePath: config?.database.path,
      configPath: getConfigPath(),
      secretsPath: secretsFilePath(),
      reason: 'manual'
    });
    return { created: result.created, manifest: result.manifest ?? null, backups: summariseBackups() };
  });

  ipcMain.handle('support-bundle', () => supportBundle());

  ipcMain.handle('smoke-status', () => smokePackage({ root: path.join(__dirname, '../..'), expectBuilderConfig: true }));

  ipcMain.handle('open-dashboard', async event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const session = window?.webContents.session ?? dashboardSession();
    if (!session) return { ok: false, message: 'The desktop window is not available.' };
    return openDashboard(session);
  });

  ipcMain.on('start-bot', async (_event, config: BotConfig) => {
    try {
      await startBot(config);
    } catch (error) {
      send('bot-error', error instanceof Error ? error.message : 'The bot could not start.');
    }
  });

  ipcMain.on('stop-bot', () => {
    stopBot();
  });
}

function unregisterIpcHandlers(): void {
  for (const channel of ['get-status', 'get-network-ip', 'get-public-config', 'validate-setup', 'save-setup', 'save-email', 'run-checks', 'send-test-email', 'list-backups', 'create-backup', 'support-bundle', 'smoke-status', 'open-dashboard']) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.removeAllListeners('start-bot');
  ipcMain.removeAllListeners('stop-bot');
}

const instance = decideSingleInstance(app.requestSingleInstanceLock());
if (!instance.proceed) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const cachePath = path.join(userData(), 'Cache');
    app.commandLine.appendSwitch('disk-cache-dir', cachePath);
    app.commandLine.appendSwitch('disk-cache-size', '104857600');
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
    registerIpcHandlers();
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true;
    stopBot();
    unregisterIpcHandlers();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});

app.on('before-quit', () => {
  quitting = true;
  stopBot();
  unregisterIpcHandlers();
});

process.on('uncaughtException', (error: Error) => {
  send('bot-error', `The desktop app hit an unexpected error: ${error.message}`);
});

process.on('unhandledRejection', (reason: unknown) => {
  send('bot-error', `The desktop app hit an unexpected error: ${reason instanceof Error ? reason.message : String(reason)}`);
});
