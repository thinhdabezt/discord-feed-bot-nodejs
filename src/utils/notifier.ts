import { logger } from './logger.js';
import { loadTargets } from '../core/config.js';

/** Tracks the last time an alert was sent for each error key (rate limiting). */
const lastAlertTimes = new Map<string, number>();

/** Minimum interval between duplicate alerts (10 minutes). */
const RATE_LIMIT_MS = 10 * 60 * 1000;

/**
 * Send a Discord embed to the admin webhook.
 * Rate-limited: the same `title` won't fire more than once per 10 minutes.
 */
export async function sendAdminAlert(
  title: string,
  message: string,
  color: number = 0xff0000,
): Promise<void> {
  const now = Date.now();
  const lastSent = lastAlertTimes.get(title);

  if (lastSent && now - lastSent < RATE_LIMIT_MS) {
    logger.debug(`Admin alert rate-limited: "${title}"`);
    return;
  }

  const config = loadTargets();
  const webhookUrl = config.admin?.webhookUrl;

  if (!webhookUrl) {
    logger.warn('Admin webhook URL not configured — skipping alert');
    return;
  }

  const payload = {
    embeds: [
      {
        title,
        description: message,
        color,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error(
        `Failed to send admin alert: ${response.status} ${response.statusText}`,
      );
      return;
    }

    lastAlertTimes.set(title, now);
    logger.debug(`Admin alert sent: "${title}"`);
  } catch (error) {
    logger.error('Error sending admin alert:', error);
  }
}

/**
 * Notify admins that authentication has expired for a platform.
 */
export async function notifyAuthExpired(
  platform: string,
  error: Error,
): Promise<void> {
  await sendAdminAlert(
    `🔒 Auth Expired — ${platform.toUpperCase()}`,
    [
      `Authentication credentials for **${platform}** are no longer valid.`,
      '',
      '```',
      error.message,
      '```',
      '',
      'Please update the session credentials in `config/sessions.json` and restart.',
    ].join('\n'),
  );
}

/**
 * Notify admins that a provider is experiencing errors.
 */
export async function notifyProviderDown(
  platform: string,
  error: Error,
): Promise<void> {
  await sendAdminAlert(
    `⚠️ Provider Down — ${platform.toUpperCase()}`,
    [
      `The **${platform}** feed provider is returning errors.`,
      '',
      '```',
      error.message,
      '```',
      '',
      'The bot will keep retrying automatically.',
    ].join('\n'),
  );
}
