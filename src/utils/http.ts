import { logger } from './logger.js';

export class AuthError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
): Promise<Response> {
  const mergedHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(options.headers as Record<string, string> | undefined),
  };

  const mergedOptions: RequestInit = {
    ...options,
    headers: mergedHeaders,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, mergedOptions);

      if (response.status === 401 || response.status === 403) {
        throw new AuthError(
          `Authentication failed: ${response.status} ${response.statusText}`,
          response.status,
        );
      }

      if (!response.ok && attempt < retries) {
        logger.warn(
          `HTTP ${response.status} for ${url}, retrying (${attempt + 1}/${retries})...`,
        );
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }

      return response;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      lastError = error as Error;

      if (attempt < retries) {
        const backoff = Math.pow(2, attempt) * 1000;
        logger.warn(
          `Request to ${url} failed: ${lastError.message}, retrying in ${backoff}ms (${attempt + 1}/${retries})...`,
        );
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error(`Request to ${url} failed after ${retries} retries`);
}
