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

    // Bật WAL mode & synchronous = NORMAL để đảm bảo hiệu năng và dữ liệu bền vững ngay cả khi app bị tắt đột ngột
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);

    // Bảng lưu trữ bài viết đã xem (seen_at là thời điểm bot phát hiện, created_at là thời điểm bài được đăng)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        seen_at INTEGER NOT NULL
      );
    `);

    // Tự động kiểm tra và nâng cấp schema nếu cột seen_at chưa có (migration an toàn)
    const tableInfo = this.db.prepare('PRAGMA table_info(posts)').all() as any[];
    const hasSeenAt = tableInfo.some((col) => col.name === 'seen_at');
    if (!hasSeenAt) {
      logger.info('Migrating posts table: adding seen_at column');
      this.db.exec(`
        ALTER TABLE posts ADD COLUMN seen_at INTEGER;
        UPDATE posts SET seen_at = created_at WHERE seen_at IS NULL;
      `);
    }

    // Fix: Refresh tất cả seen_at cũ/stale (từ migration hoặc code cũ) về thời điểm hiện tại.
    // Điều này ngăn cleanupOldRecords() xóa nhầm các bài có seen_at = created_at cũ.
    const now = Date.now();
    const staleCutoff = now - 7 * 24 * 60 * 60 * 1000; // Nếu seen_at > 7 ngày trước → coi là stale
    const refreshStmt = this.db.prepare('UPDATE posts SET seen_at = ? WHERE seen_at < ?');
    const result = refreshStmt.run(now, staleCutoff) as any;
    if (result?.changes > 0) {
      logger.info(`Refreshed ${result.changes} stale seen_at records to current time`);
    }

    // Bảng lưu trạng thái đồng bộ ban đầu của các targets (để tránh spam 5 bài cũ khi vừa thêm target)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS target_state (
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        last_synced_at INTEGER NOT NULL,
        PRIMARY KEY (platform, handle)
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

    logger.info('Database initialized successfully with WAL mode');
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
    const now = Date.now();
    const createdAt = item.createdAt instanceof Date && !isNaN(item.createdAt.getTime())
      ? item.createdAt.getTime()
      : now;

    const stmt = db.prepare(
      'INSERT INTO posts (id, platform, created_at, seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET seen_at = excluded.seen_at',
    );
    stmt.run(item.id, item.platform, createdAt, now);
    logger.debug(`Marked post as seen: ${item.id}`);
  }

  isTargetSynced(platform: string, handle: string): boolean {
    const db = this.ensureInit();
    const stmt = db.prepare(
      'SELECT 1 FROM target_state WHERE platform = ? AND handle = ?',
    );
    const row = stmt.get(platform, handle.toLowerCase());
    return row !== undefined;
  }

  markTargetSynced(platform: string, handle: string): void {
    const db = this.ensureInit();
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO target_state (platform, handle, last_synced_at) VALUES (?, ?, ?)',
    );
    stmt.run(platform, handle.toLowerCase(), Date.now());
    logger.debug(`Marked target as synced: ${platform}/@${handle}`);
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

  /**
   * Xóa các bài viết cũ hơn X ngày DỰA TRÊN seen_at (thời điểm bot phát hiện).
   * Tuyệt đối không xóa dựa trên created_at để tránh xóa nhầm Pinned Tweets hoặc các bài cũ của tài khoản ít đăng.
   */
  cleanupOldRecords(days = 30): void {
    const db = this.ensureInit();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const stmt = db.prepare('DELETE FROM posts WHERE seen_at < ?');
    stmt.run(cutoff);
    logger.info(`Cleaned up posts seen older than ${days} days`);
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
