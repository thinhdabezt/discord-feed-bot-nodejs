import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import type { FeedItem } from '../providers/base.provider.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const DB_PATH = resolve(DATA_DIR, 'feed_state.db');

export class Database {
  private db: DatabaseSync | null = null;

  init(): void {
    if (this.db) return;
    mkdirSync(DATA_DIR, { recursive: true });
    logger.info(`Opening database at ${DB_PATH}`);
    this.db = new DatabaseSync(DB_PATH);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_cache (
        handle TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        rest_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    logger.info('Database initialized successfully');
  }

  private ensureInit(): DatabaseSync {
    if (!this.db) {
      this.init();
    }
    return this.db!;
  }

  isPostSeen(id: string): boolean {
    const db = this.ensureInit();
    const stmt = db.prepare('SELECT 1 FROM posts WHERE id = ?');
    const row = stmt.get(id);
    return row !== undefined;
  }

  markPostSeen(item: FeedItem): void {
    const db = this.ensureInit();
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO posts (id, platform, created_at) VALUES (?, ?, ?)',
    );
    stmt.run(item.id, item.platform, item.createdAt.getTime());
    logger.debug(`Marked post as seen: ${item.id}`);
  }

  cacheUserId(handle: string, platform: string, restId: string): void {
    const db = this.ensureInit();
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO user_cache (handle, platform, rest_id, updated_at) VALUES (?, ?, ?, ?)',
    );
    stmt.run(handle.toLowerCase(), platform, restId, Date.now());
    logger.debug(`Cached user ID: ${handle} (${platform}) -> ${restId}`);
  }

  getCachedUserId(handle: string, platform: string): string | undefined {
    const db = this.ensureInit();
    const stmt = db.prepare(
      'SELECT rest_id FROM user_cache WHERE handle = ? AND platform = ?',
    );
    const row = stmt.get(handle.toLowerCase(), platform) as { rest_id: string } | undefined;
    return row?.rest_id;
  }

  cleanupOldRecords(days = 30): void {
    const db = this.ensureInit();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare('DELETE FROM posts WHERE created_at < ?');
    stmt.run(cutoff);
    logger.info(`Cleaned up posts older than ${days} days`);
  }

  close(): void {
    if (this.db) {
      logger.info('Closing database');
      this.db.close();
      this.db = null;
    }
  }
}

export const database = new Database();
