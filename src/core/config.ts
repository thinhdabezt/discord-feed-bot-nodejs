import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────

export interface Target {
  platform: 'x' | 'ig' | 'fb';
  handle: string;
  webhookUrl: string;
  enabled: boolean;
}

export interface TargetsConfig {
  botToken?: string;
  targets: Target[];
  settings: {
    pollIntervalMinMs: number;
    pollIntervalMaxMs: number;
    delayBetweenTargetsMs: number | [number, number];
  };
  admin?: {
    webhookUrl?: string;
    adminRoleId?: string;
  };
}

export interface SessionsConfig {
  x?: {
    auth_token: string;
    ct0: string;
  };
  ig?: {
    sessionid?: string;
  };
}

// ── Paths ──────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
export const TARGETS_PATH = resolve(PROJECT_ROOT, 'config', 'targets.json');
export const TARGETS_EXAMPLE_PATH = resolve(PROJECT_ROOT, 'config', 'targets.example.json');
export const SESSIONS_PATH = resolve(PROJECT_ROOT, 'config', 'sessions.json');
export const SESSIONS_EXAMPLE_PATH = resolve(PROJECT_ROOT, 'config', 'sessions.example.json');

// ── Config Manager ─────────────────────────────────────────────────

export class ConfigManager extends EventEmitter {
  private sessionsWatching = false;

  constructor() {
    super();
  }

  loadTargets(): TargetsConfig {
    const filePath = existsSync(TARGETS_PATH) ? TARGETS_PATH : TARGETS_EXAMPLE_PATH;
    logger.debug(`Loading targets config from ${filePath}`);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as TargetsConfig;
    } catch (err) {
      logger.error(`Failed to load targets from ${filePath}:`, err);
      return {
        targets: [],
        settings: {
          pollIntervalMinMs: 240000,
          pollIntervalMaxMs: 420000,
          delayBetweenTargetsMs: [2000, 5000],
        },
      };
    }
  }

  loadSessions(): SessionsConfig {
    const filePath = existsSync(SESSIONS_PATH) ? SESSIONS_PATH : SESSIONS_EXAMPLE_PATH;
    logger.debug(`Loading sessions config from ${filePath}`);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as SessionsConfig;
    } catch (err) {
      logger.error(`Failed to load sessions from ${filePath}:`, err);
      return {};
    }
  }

  saveTargets(configData: TargetsConfig): void {
    logger.info(`Saving targets config to ${TARGETS_PATH}`);
    writeFileSync(TARGETS_PATH, JSON.stringify(configData, null, 2), 'utf-8');
    this.emit('targetsUpdated', configData);
  }

  watchSessions(intervalMs = 5000): void {
    if (this.sessionsWatching) return;
    if (!existsSync(SESSIONS_PATH)) {
      logger.warn(`Sessions file not found at ${SESSIONS_PATH}, skipping watch`);
      return;
    }
    this.sessionsWatching = true;

    logger.info('Watching sessions file for changes...');
    watchFile(SESSIONS_PATH, { interval: intervalMs }, () => {
      logger.info('Sessions file changed, reloading...');
      try {
        const sessions = this.loadSessions();
        this.emit('sessionsUpdated', sessions);
      } catch (err) {
        logger.error('Failed to reload sessions:', err);
      }
    });
  }

  unwatchSessions(): void {
    if (!this.sessionsWatching) return;
    unwatchFile(SESSIONS_PATH);
    this.sessionsWatching = false;
    logger.info('Stopped watching sessions file');
  }
}

export const config = new ConfigManager();
export const loadTargets = (): TargetsConfig => config.loadTargets();
export const loadSessions = (): SessionsConfig => config.loadSessions();
export const saveTargets = (cfg: TargetsConfig): void => config.saveTargets(cfg);
export const watchSessions = (intervalMs?: number): void => config.watchSessions(intervalMs);
export const unwatchSessions = (): void => config.unwatchSessions();
