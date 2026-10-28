import { contextBridge, ipcRenderer } from 'electron';

export interface PublicConfig {
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

export interface SetupDraft {
  version?: string;
  schemaVersion?: number;
  discord?: { token?: string };
  challengermode?: { refreshKey?: string };
  bot?: { defaultPrefix?: string; defaultToRole?: string; participantRole?: string };
  database?: { type?: 'sqlite' | 'postgresql'; path?: string; url?: string };
  web?: { port?: number; autoIncrement?: boolean; password?: string; allowNetwork?: boolean };
  logging?: { level?: string; webhook?: string };
  email?: { configured?: boolean; sender?: string; tokenUri?: string };
  setup?: { step: string; completed: string[]; updatedAt: string };
}

export interface SetupCheck {
  id: string;
  label: string;
  state: 'pass' | 'fail' | 'unavailable' | 'not-checked';
  message: string;
  recovery?: string;
}

export interface BotStatus {
  running: boolean;
  connectedServers: number;
  port: number;
  pid?: number;
}

const api = {
  startBot: (config: SetupDraft) => ipcRenderer.send('start-bot', config),
  stopBot: () => ipcRenderer.send('stop-bot'),
  getStatus: () => ipcRenderer.invoke('get-status') as Promise<BotStatus>,
  getNetworkIP: () => ipcRenderer.invoke('get-network-ip') as Promise<{ local: string; network: string }>,
  getPublicConfig: () => ipcRenderer.invoke('get-public-config') as Promise<PublicConfig>,
  validateSetup: (draft: SetupDraft) => ipcRenderer.invoke('validate-setup', draft) as Promise<{ errors: { field: string; message: string; recovery?: string }[]; checks: SetupCheck[] }>,
  saveSetup: (draft: SetupDraft) => ipcRenderer.invoke('save-setup', draft) as Promise<{ publicConfig: PublicConfig; restartRequired: string[] }>,
  saveEmail: (email: { clientId?: string; clientSecret?: string; refreshToken?: string; tokenUri?: string; sender?: string }) => ipcRenderer.invoke('save-email', email) as Promise<{ publicConfig: PublicConfig }>,
  runChecks: () => ipcRenderer.invoke('run-checks') as Promise<SetupCheck[]>,
  sendTestEmail: (to: string) => ipcRenderer.invoke('send-test-email', to) as Promise<SetupCheck>,
  listBackups: () => ipcRenderer.invoke('list-backups'),
  createBackup: () => ipcRenderer.invoke('create-backup'),
  supportBundle: () => ipcRenderer.invoke('support-bundle') as Promise<{ fileName: string; text: string }>,
  openDashboard: () => ipcRenderer.invoke('open-dashboard') as Promise<{ ok: boolean; url?: string; message: string }>,
  onBotLog: (callback: (log: string) => void) => ipcRenderer.on('bot-log', (_event, log) => callback(log)),
  onBotStatus: (callback: (status: BotStatus) => void) => ipcRenderer.on('bot-status', (_event, status) => callback(status)),
  onBotError: (callback: (error: string) => void) => ipcRenderer.on('bot-error', (_event, error) => callback(error)),
  onConfigLoaded: (callback: (config: PublicConfig) => void) => ipcRenderer.on('config-loaded', (_event, config) => callback(config)),
  onPortDetected: (callback: (port: number) => void) => ipcRenderer.on('port-detected', (_event, payload) => callback(payload.port)),
  onSetupChecks: (callback: (checks: SetupCheck[]) => void) => ipcRenderer.on('setup-checks', (_event, checks) => callback(checks)),
  onAppInfo: (callback: (info: unknown) => void) => ipcRenderer.on('app-info', (_event, info) => callback(info)),
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
};

contextBridge.exposeInMainWorld('electronAPI', api);
