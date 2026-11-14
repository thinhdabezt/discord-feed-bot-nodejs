import { logger } from '../utils/logger.js';
import type { FeedItem } from '../providers/base.provider.js';
import type { Target } from './config.js';

const PLATFORM_COLORS: Record<string, number> = {
  x: 0x1da1f2,
  ig: 0xe1306c,
  fb: 0x1877f2,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Dispatcher {
  /**
   * Main dispatch method called by the Scheduler.
   */
  async dispatch(item: FeedItem, target: Target): Promise<void> {
    const webhookUrl = target.webhookUrl;
    if (!webhookUrl) {
      logger.warn(
        `No webhook URL configured for target ${target.platform}/${target.handle}`,
      );
      return;
    }

    await this.sendFeedItem(item, webhookUrl);
  }

  /**
   * Builds Discord embed payload for a FeedItem.
   * If there are multiple images, Discord allows grouping up to 4 images
   * by attaching multiple embeds with the same url and author.
   */
  buildPayload(item: FeedItem): { embeds: any[] } {
    const color = PLATFORM_COLORS[item.platform] ?? 0x5865f2;
    const authorUrl =
      item.platform === 'x'
        ? `https://x.com/${item.authorHandle}`
        : item.url;

    let description = item.content || '';
    if (item.videoUrl) {
      const videoBadge = `\n\n▶️ **[Xem Video](${item.videoUrl})**`;
      description = description
        ? `${description}${videoBadge}`
        : `▶️ **[Xem Video](${item.videoUrl})**`;
    }

    const baseEmbed: any = {
      author: {
        name: `${item.authorName} (@${item.authorHandle})`,
        url: authorUrl,
        icon_url: item.authorAvatar || undefined,
      },
      description: description || undefined,
      url: item.url,
      color,
      timestamp: item.createdAt.toISOString(),
      footer: {
        text: `${item.platform.toUpperCase()} • ${item.id}`,
      },
    };

    if (item.mediaUrls.length === 0) {
      return { embeds: [baseEmbed] };
    }

    // Set first image on primary embed
    baseEmbed.image = { url: item.mediaUrls[0] };

    const embeds: any[] = [baseEmbed];

    // For additional images (up to 4 total for gallery view)
    const extraImages = item.mediaUrls.slice(1, 4);
    for (const mediaUrl of extraImages) {
      embeds.push({
        url: item.url,
        image: { url: mediaUrl },
      });
    }

    return { embeds };
  }

  /**
   * Sends the feed item to a Discord webhook with retry & rate-limit handling.
   */
  async sendFeedItem(
    item: FeedItem,
    webhookUrl: string,
    maxRetries = 3,
  ): Promise<void> {
    const payload = this.buildPayload(item);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          logger.info(`Dispatched post ${item.id} to Discord webhook`);
          return;
        }

        if (response.status === 429) {
          // Rate limited by Discord
          const rateData = (await response.json().catch(() => ({}))) as any;
          const retryAfterMs =
            (rateData.retry_after ? rateData.retry_after * 1000 : 2000) + 200;
          logger.warn(
            `Discord rate limit hit (429). Retrying after ${retryAfterMs}ms`,
          );
          await sleep(retryAfterMs);
          continue;
        }

        const errorText = await response.text().catch(() => 'No response body');
        logger.error(
          `Discord webhook responded with HTTP ${response.status}: ${errorText}`,
        );

        if (response.status >= 500 && attempt < maxRetries) {
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }

        break;
      } catch (error) {
        logger.error(`Error sending feed item to Discord webhook:`, error);
        if (attempt < maxRetries) {
          await sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }
  }
}

export const dispatcher = new Dispatcher();
