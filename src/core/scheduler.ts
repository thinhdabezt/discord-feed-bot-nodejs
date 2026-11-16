import { logger } from '../utils/logger.js';
import { config } from './config.js';
import type { Target } from './config.js';
import type { Database } from './database.js';
import type { FeedItem, FeedProvider } from '../providers/base.provider.js';
import { notifyAuthExpired, notifyProviderDown } from '../utils/notifier.js';
import { AuthError } from '../utils/http.js';

// ── Dispatcher interface ───────────────────────────────────────────

export interface Dispatcher {
  dispatch(item: FeedItem, target: Target): Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Scheduler ──────────────────────────────────────────────────────

export class Scheduler {
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private targets: Target[] = [];
  private providers: Map<string, FeedProvider> = new Map();
  private dispatcher!: Dispatcher;
  private database!: Database;
  private lastPollTime: Date | null = null;
  private lastError: string | null = null;

  start(
    providers: FeedProvider[],
    targets: Target[],
    dispatcher: Dispatcher,
    database: Database,
  ): void {
    if (this.running) {
      logger.warn('Scheduler is already running');
      return;
    }

    this.running = true;
    this.targets = [...targets];
    this.dispatcher = dispatcher;
    this.database = database;
    this.providers = new Map(providers.map((p) => [p.platform, p]));

    logger.info(`Scheduler started with ${this.targets.length} targets`);
    this.schedulePollCycle(1000); // initial run after 1s
    this.scheduleDailyCleanup();
  }

  stop(): void {
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    logger.info('Scheduler stopped');
  }

  getStatus() {
    return {
      running: this.running,
      totalTargets: this.targets.length,
      activeTargets: this.targets.filter((t) => t.enabled).length,
      lastPollTime: this.lastPollTime,
      lastError: this.lastError,
    };
  }

  getTargets(): Target[] {
    return [...this.targets];
  }

  setTargets(newTargets: Target[]): void {
    this.targets = [...newTargets];
    logger.info(`Scheduler updated with ${this.targets.length} targets`);
  }

  addTarget(target: Target): void {
    const idx = this.targets.findIndex(
      (t) =>
        t.handle.toLowerCase() === target.handle.toLowerCase() &&
        t.platform === target.platform,
    );
    if (idx >= 0) {
      this.targets[idx] = target;
      logger.info(`Target updated: ${target.platform}/${target.handle}`);
    } else {
      this.targets.push(target);
      logger.info(`Target added: ${target.platform}/${target.handle}`);
    }
  }

  removeTarget(platform: string, handle: string): boolean {
    const before = this.targets.length;
    this.targets = this.targets.filter(
      (t) =>
        !(
          t.handle.toLowerCase() === handle.toLowerCase() &&
          t.platform === platform
        ),
    );
    const removed = this.targets.length < before;
    if (removed) {
      logger.info(`Target removed: ${platform}/${handle}`);
    }
    return removed;
  }

  // ── Internal ───────────────────────────────────────────────────

  private schedulePollCycle(overrideDelayMs?: number): void {
    if (!this.running) return;

    const settings = config.loadTargets().settings;
    const interval =
      overrideDelayMs ??
      randomBetween(settings.pollIntervalMinMs, settings.pollIntervalMaxMs);

    logger.info(`Next poll cycle in ${(interval / 1000).toFixed(0)}s`);

    this.pollTimer = setTimeout(async () => {
      await this.runPollCycle();
      this.schedulePollCycle();
    }, interval);
  }

  private async runPollCycle(): Promise<void> {
    const targetsConfig = config.loadTargets();
    const settings = targetsConfig.settings;
    const enabledTargets = this.targets.filter((t) => t.enabled);

    logger.info(`Poll cycle starting — ${enabledTargets.length} enabled targets`);
    this.lastPollTime = new Date();

    for (let i = 0; i < enabledTargets.length; i++) {
      if (!this.running) break;
      const target = enabledTargets[i];

      try {
        await this.processTarget(target);
      } catch (err: any) {
        this.lastError = `${target.platform}/${target.handle}: ${err?.message || err}`;
        logger.error(`Error processing ${target.platform}/${target.handle}:`, err);

        if (err instanceof AuthError) {
          await notifyAuthExpired(target.platform, err);
        } else if (err instanceof Error) {
          await notifyProviderDown(target.platform, err);
        }
      }

      // Delay between targets
      if (i < enabledTargets.length - 1) {
        let delay: number;
        if (Array.isArray(settings.delayBetweenTargetsMs)) {
          delay = randomBetween(
            settings.delayBetweenTargetsMs[0],
            settings.delayBetweenTargetsMs[1],
          );
        } else {
          delay = randomBetween(2000, settings.delayBetweenTargetsMs || 5000);
        }
        logger.debug(`Waiting ${delay}ms before next target`);
        await sleep(delay);
      }
    }

    logger.info('Poll cycle complete');
  }

  private async processTarget(target: Target): Promise<void> {
    const provider = this.providers.get(target.platform);
    if (!provider) {
      logger.warn(`No provider registered for platform: ${target.platform}`);
      return;
    }

    logger.debug(`Fetching latest for ${target.platform}/${target.handle}`);
    const items = await provider.fetchLatest(target.handle);

    const targetsConfig = config.loadTargets();
    const isMediaOnly =
      target.mediaOnly ?? targetsConfig.settings.mediaOnlyDefault ?? true;

    // ── Xử lý Cold Start: Lần đầu quét target ──────────────────────
    const isFirstSync = !this.database.isTargetSynced(
      target.platform,
      target.handle,
    );
    const syncMode = targetsConfig.settings.initialSyncMode ?? 'skip_old';

    if (isFirstSync && syncMode === 'skip_old') {
      logger.info(
        `[Initial Sync] Lần đầu theo dõi ${target.platform}/@${target.handle}. Đánh dấu ${items.length} bài hiện tại là đã xem để tránh spam bài cũ.`,
      );
      for (const item of items) {
        this.database.markPostSeen(item);
      }
      this.database.markTargetSynced(target.platform, target.handle);
      return;
    }

    // Sắp xếp bài từ cũ nhất đến mới nhất để hiển thị theo trình tự thời gian trên Discord
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let newCount = 0;
    for (const item of items) {
      if (!this.database.isPostSeen(item.id)) {
        // Media filter check
        if (isMediaOnly && !item.hasMedia) {
          logger.debug(
            `[Filter] Bỏ qua bài viết text-only ${item.id} của @${target.handle} (mediaOnly=true)`,
          );
          // Đánh dấu đã xem để không duyệt lại ở chu kỳ sau
          this.database.markPostSeen(item);
          continue;
        }

        await this.dispatcher.dispatch(item, target);
        this.database.markPostSeen(item);
        newCount++;
      }
    }

    // Đánh dấu đã đồng bộ
    this.database.markTargetSynced(target.platform, target.handle);

    if (newCount > 0) {
      logger.info(
        `${target.platform}/${target.handle}: ${newCount} new post(s) dispatched`,
      );
    } else {
      logger.debug(`${target.platform}/${target.handle}: no new posts`);
    }
  }

  private scheduleDailyCleanup(): void {
    if (!this.running) return;

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    this.cleanupTimer = setTimeout(() => {
      try {
        this.database.cleanupOldRecords();
      } catch (err) {
        logger.error('Daily cleanup failed:', err);
      }
      this.scheduleDailyCleanup();
    }, ONE_DAY_MS);
  }
}

export const scheduler = new Scheduler();
