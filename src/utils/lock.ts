import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const LOCK_FILE = resolve(DATA_DIR, 'bot.lock');

/**
 * Đảm bảo chỉ có duy nhất 1 tiến trình bot chạy tại một thời điểm.
 * Giúp ngăn chặn việc vô tình chạy đè 2 tiến trình gây gửi tin nhắn trùng lặp.
 */
export function acquireLock(): boolean {
  mkdirSync(DATA_DIR, { recursive: true });

  if (existsSync(LOCK_FILE)) {
    try {
      const pidStr = readFileSync(LOCK_FILE, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);

      if (!isNaN(pid)) {
        // Kiểm tra xem tiến trình có PID này còn đang sống hay không
        try {
          process.kill(pid, 0); // Tín hiệu 0 chỉ kiểm tra sự tồn tại của tiến trình
          // Nếu không quăng lỗi, tiến trình đó đang chạy thực sự!
          logger.error(
            `❌ ĐÃ CÓ TIẾN TRÌNH BOT ĐANG CHẠY (PID: ${pid}). Không thể khởi động thêm tiến trình mới để tránh lặp bài!`,
          );
          return false;
        } catch (e: any) {
          // ESRCH nghĩa là tiến trình không tồn tại (lock file cũ từ lần crash trước)
          if (e.code === 'ESRCH') {
            logger.warn(`Stale lock file found (PID ${pid} is dead). Overwriting lock...`);
          } else {
            throw e;
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to inspect existing lock file:', err);
    }
  }

  try {
    writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    logger.debug(`Acquired single-instance lock (PID: ${process.pid})`);
    return true;
  } catch (err) {
    logger.error('Failed to write lock file:', err);
    return false;
  }
}

/**
 * Xóa lock file khi bot tắt an toàn.
 */
export function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const pidStr = readFileSync(LOCK_FILE, 'utf-8').trim();
      if (pidStr === String(process.pid)) {
        unlinkSync(LOCK_FILE);
        logger.debug('Released single-instance lock file');
      }
    }
  } catch (err) {
    logger.error('Failed to release lock file:', err);
  }
}
