import type { FeedItem, FeedProvider } from './base.provider.js';
import { AuthError, fetchWithRetry } from '../utils/http.js';
import { loadSessions } from '../core/config.js';
import { database, Database } from '../core/database.js';
import { logger } from '../utils/logger.js';

// ── Bearer token (public / embedded in the web client) ──────────────────────
const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ── GraphQL endpoints ───────────────────────────────────────────────────────
const GQL_USER_BY_SCREEN_NAME =
  'https://x.com/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName';

const GQL_USER_TWEETS =
  'https://x.com/i/api/graphql/E3opETHurmVJflFsUBVuUQ/UserTweets';

// ── Feature flags ───────────────────────────────────────────────────────────
const USER_BY_SCREEN_NAME_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const USER_TWEETS_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  const sessions = loadSessions();
  const session = sessions.x;
  if (!session?.auth_token || !session?.ct0) {
    throw new AuthError('Missing X auth_token or ct0 in sessions.json', 401);
  }

  return {
    Authorization: `Bearer ${BEARER_TOKEN}`,
    Cookie: `auth_token=${session.auth_token}; ct0=${session.ct0}`,
    'X-Csrf-Token': session.ct0,
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Client-Language': 'en',
  };
}

function buildGqlUrl(
  base: string,
  variables: Record<string, unknown>,
  features: Record<string, boolean>,
): string {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });
  return `${base}?${params.toString()}`;
}

/**
 * Resolve a user's REST ID, first checking the database cache.
 */
async function resolveRestId(handle: string, db: Database): Promise<string> {
  const cached = db.getCachedUserId(handle, 'x');
  if (cached) {
    logger.debug(`Using cached REST ID for @${handle}: ${cached}`);
    return cached;
  }

  const url = buildGqlUrl(
    GQL_USER_BY_SCREEN_NAME,
    { screen_name: handle },
    USER_BY_SCREEN_NAME_FEATURES,
  );

  const response = await fetchWithRetry(url, { headers: buildHeaders() });
  const json = (await response.json()) as any;

  const restId: string | undefined = json?.data?.user?.result?.rest_id;
  if (!restId) {
    throw new Error(
      `Could not resolve REST ID for @${handle}: user may not exist or response format changed`,
    );
  }

  db.cacheUserId(handle, 'x', restId);
  logger.info(`Resolved @${handle} -> REST ID ${restId}`);
  return restId;
}

/**
 * Parse a single tweet result object into a FeedItem.
 */
export function parseTweetResult(result: any): FeedItem | null {
  try {
    const tweet =
      result.__typename === 'TweetWithVisibilityResults'
        ? result.tweet
        : result;

    if (!tweet?.legacy) return null;

    const legacy = tweet.legacy;
    const userLegacy = tweet.core?.user_results?.result?.legacy;
    if (!userLegacy) return null;

    // Skip retweets
    if (legacy.retweeted_status_result) return null;

    const tweetId: string = tweet.rest_id;
    const authorHandle: string = userLegacy.screen_name;
    const authorName: string = userLegacy.name;
    const authorAvatar: string = (
      userLegacy.profile_image_url_https ?? ''
    ).replace('_normal', '_400x400');

    const content: string = legacy.full_text ?? '';

    // Inspect extended_entities first (contains full media including videos and multiple photos), fallback to entities
    const rawMediaList: any[] =
      legacy.extended_entities?.media ?? legacy.entities?.media ?? [];

    const mediaUrls: string[] = [];
    let videoUrl: string | undefined;

    for (const m of rawMediaList) {
      if (m.type === 'video' || m.type === 'animated_gif') {
        // Collect video thumbnail
        if (m.media_url_https) {
          mediaUrls.push(`${m.media_url_https}?format=jpg&name=large`);
        }
        // Extract highest quality MP4 video variant
        const variants: any[] = m.video_info?.variants ?? [];
        const mp4Variants = variants
          .filter(
            (v: any) =>
              v.content_type === 'video/mp4' && typeof v.url === 'string',
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        if (mp4Variants.length > 0 && !videoUrl) {
          videoUrl = mp4Variants[0].url;
        }
      } else {
        // Regular photo
        if (m.media_url_https) {
          mediaUrls.push(`${m.media_url_https}?format=jpg&name=large`);
        }
      }
    }

    const hasMedia = mediaUrls.length > 0 || Boolean(videoUrl);
    const createdAt = new Date(legacy.created_at);
    const url = `https://x.com/${authorHandle}/status/${tweetId}`;
    const id = `x:${tweetId}`;

    return {
      id,
      platform: 'x',
      authorName,
      authorHandle,
      authorAvatar,
      content,
      url,
      mediaUrls,
      videoUrl,
      hasMedia,
      createdAt,
    };
  } catch (error) {
    logger.warn('Failed to parse tweet result:', error);
    return null;
  }
}

// ── Provider Class & Export ─────────────────────────────────────────────────

export class XProvider implements FeedProvider {
  public platform = 'x' as const;
  private db: Database;

  constructor(dbInstance: Database = database) {
    this.db = dbInstance;
  }

  async fetchLatest(targetHandle: string): Promise<FeedItem[]> {
    const handle = targetHandle.replace(/^@/, '');
    logger.info(`Fetching latest tweets for @${handle}`);

    try {
      const restId = await resolveRestId(handle, this.db);

      const url = buildGqlUrl(
        GQL_USER_TWEETS,
        {
          userId: restId,
          count: 5,
          includePromotedContent: false,
          withQuickPromoteEligibilityTweetFields: true,
          withVoice: true,
          withV2Timeline: true,
        },
        USER_TWEETS_FEATURES,
      );

      const response = await fetchWithRetry(url, { headers: buildHeaders() });
      const json = (await response.json()) as any;

      const instructions: any[] =
        json?.data?.user?.result?.timeline_v2?.timeline?.instructions ?? [];

      const addEntries = instructions.find(
        (i: any) => i.type === 'TimelineAddEntries',
      );

      if (!addEntries?.entries) {
        logger.warn(`No timeline entries found for @${handle}`);
        return [];
      }

      const items: FeedItem[] = [];

      for (const entry of addEntries.entries) {
        // Only process tweet entries (skip pinned indicators, cursors, etc.)
        if (!entry.entryId?.startsWith('tweet-')) continue;

        const tweetResult =
          entry.content?.itemContent?.tweet_results?.result;
        if (!tweetResult) continue;

        const item = parseTweetResult(tweetResult);
        if (item) items.push(item);
      }

      logger.info(`Fetched ${items.length} tweets for @${handle}`);
      return items;
    } catch (error) {
      if (error instanceof AuthError) {
        logger.error(`Auth error fetching tweets for @${handle}: ${error.message}`);
        throw error;
      }

      logger.error(`Error fetching tweets for @${handle}:`, error);
      throw error;
    }
  }
}

export const xProvider = new XProvider();
