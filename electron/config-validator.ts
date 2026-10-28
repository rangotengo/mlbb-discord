import { BotConfig } from './config';

export interface ValidationError {
  field: string;
  message: string;
  recovery?: string;
}

export function validateConfig(config: Partial<BotConfig> | null | undefined): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!config || typeof config !== 'object') {
    return [{ field: 'config', message: 'Configuration must be an object', recovery: 'Reload setup and enter the settings again.' }];
  }

  if (typeof config.discord?.token !== 'string' || !config.discord.token.trim()) {
    errors.push({
      field: 'discord-token',
      message: 'Discord token is required',
      recovery: 'Open the Discord developer portal, select the application, and copy the bot token. Reset it if you no longer have the old one.'
    });
  } else if (config.discord.token.length < 50) {
    errors.push({
      field: 'discord-token',
      message: 'Discord token appears invalid (too short)',
      recovery: 'Paste the full bot token. A token shortened by a copy or a placeholder will not connect.'
    });
  }

  if (typeof config.challengermode?.refreshKey !== 'string' || !config.challengermode.refreshKey.trim()) {
    errors.push({
      field: 'challengermode-refresh-key',
      message: 'Challengermode application refresh key is required',
      recovery: 'Create an application in the Challengermode developer dashboard and generate a refresh key. The bot only reads tournament data.'
    });
  }

  if (config.database?.type === 'postgresql' && (typeof config.database.url !== 'string' || !config.database.url.trim())) {
    errors.push({
      field: 'database-url',
      message: 'PostgreSQL URL is required for PostgreSQL storage',
      recovery: 'Enter a postgresql:// URL, or switch storage back to SQLite.'
    });
  }
  if (!config.database || !['sqlite', 'postgresql'].includes(config.database.type)) {
    errors.push({
      field: 'database-type',
      message: 'Choose SQLite or PostgreSQL storage',
      recovery: 'Use SQLite for a single desktop install. Use PostgreSQL only when you already run that server.'
    });
  }
  if (config.database?.type === 'sqlite' && config.database.path !== undefined && typeof config.database.path !== 'string') {
    errors.push({ field: 'database-path', message: 'SQLite path must be text', recovery: 'Leave the path empty to use the default file in the app data folder.' });
  }
  if (!config.web || !Number.isInteger(config.web.port) || config.web.port < 1 || config.web.port > 65535) {
    errors.push({
      field: 'web-port',
      message: 'Web port must be an integer between 1 and 65535',
      recovery: 'Use 3000 unless another program already uses it. The app can move to the next free port when auto-increment is on.'
    });
  }
  if (config.web?.allowNetwork === true && (typeof config.web.password !== 'string' || !config.web.password.trim())) {
    errors.push({
      field: 'web-password',
      message: 'A dashboard password is required before the dashboard can be reached from other devices',
      recovery: 'Set an access password, or turn network access off so the dashboard stays on this computer.'
    });
  }

  if (typeof config.bot?.defaultPrefix !== 'string' || !config.bot.defaultPrefix.trim()) {
    errors.push({ field: 'bot-prefix', message: 'Command prefix is required', recovery: 'Use ! unless your server already uses that prefix for another bot.' });
  } else if (config.bot.defaultPrefix.length > 10) {
    errors.push({ field: 'bot-prefix', message: 'Command prefix should be 10 characters or less', recovery: 'Shorten the prefix. Participants type it before every command.' });
  }

  if (typeof config.bot?.defaultToRole !== 'string' || !config.bot.defaultToRole.trim()) {
    errors.push({
      field: 'bot-to-role',
      message: 'TO role name is required',
      recovery: 'Enter the exact Discord role name the bot should create for organisers. The setup form starts from Organizer.'
    });
  }

  return errors;
}

export function displayErrors(errors: ValidationError[]): string {
  return errors.map(error => `${error.field}: ${error.message}${error.recovery ? ` — ${error.recovery}` : ''}`).join('\n');
}
