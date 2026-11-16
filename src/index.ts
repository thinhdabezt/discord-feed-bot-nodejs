import { logger } from './utils/logger.js';
import {
  config,
  loadTargets,
  loadSessions,
  watchSessions,
  unwatchSessions,
} from './core/config.js';
import { database } from './core/database.js';
import { scheduler } from './core/scheduler.js';
import { dispatcher } from './core/dispatcher.js';
import { xProvider } from './providers/x.provider.js';
import { createBot, startBot } from './bot/client.js';
import { acquireLock, releaseLock } from './utils/lock.js';

async function bootstrap() {
  logger.info('=============================================');
  logger.info('🚀 Starting Discord Social Feed Bot...');
  logger.info(`📦 Node.js version: ${process.version}`);
  logger.info(`🖥️  Platform / Arch: ${process.platform} / ${process.arch}`);
  logger.info('=============================================');

  // 0. Single-Instance Check (Chống chạy đè 2 tiến trình gây lặp bài)
  if (!acquireLock()) {
    logger.error('Dừng tiến trình để tránh gửi bài viết trùng lặp.');
    process.exit(1);
  }

  // 1. Initialize Database
  database.init();

  // 2. Load configurations
  const targetsConfig = loadTargets();
  const sessionsConfig = loadSessions();

  logger.info(`Loaded ${targetsConfig.targets.length} target(s) from config`);
  if (sessionsConfig.x?.auth_token) {
    logger.info('X (Twitter) session credentials found');
  } else {
    logger.warn('⚠️ No X session credentials found in config/sessions.json!');
  }

  // 3. Start watching sessions file for changes (hot reload)
  watchSessions();

  // 4. Setup Discord Bot Client (for Slash Commands)
  const botClient = createBot();
  await startBot(botClient);

  // 5. Register Providers
  const providers = [xProvider];

  // 6. Start Scheduler
  scheduler.start(
    providers,
    targetsConfig.targets,
    dispatcher,
    database,
  );

  logger.info('✅ Bot initialization complete. Running scheduler loop...');
}

// ── Graceful Shutdown Handling ───────────────────────────────────────────────

let isShuttingDown = false;

async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Shutting down gracefully...`);

  try {
    scheduler.stop();
    unwatchSessions();
    database.close();
    releaseLock();
  } catch (err) {
    logger.error('Error during shutdown:', err);
  }

  logger.info('👋 Goodbye!');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown:', err);
});

// Run
bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error:', err);
  releaseLock();
  process.exit(1);
});
