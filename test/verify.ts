import { Database } from '../src/core/database.js';
import { Dispatcher } from '../src/core/dispatcher.js';
import { Scheduler } from '../src/core/scheduler.js';
import { parseTweetResult } from '../src/providers/x.provider.js';
import type { FeedItem, FeedProvider } from '../src/providers/base.provider.js';
import type { Target } from '../src/core/config.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function runTests() {
  console.log('🧪 Starting Discord Feed Bot Test Suite...\n');

  // ── 1. Database Tests ──────────────────────────────────────────
  console.log('📦 Testing Database...');
  const db = new Database();
  db.init();

  const testId = `x:test_${Date.now()}`;
  const mockItem: FeedItem = {
    id: testId,
    platform: 'x',
    authorName: 'Test Author',
    authorHandle: 'testauthor',
    content: 'Hello world feed test',
    url: `https://x.com/testauthor/status/${testId}`,
    mediaUrls: ['https://pbs.twimg.com/media/test.jpg'],
    hasMedia: true,
    createdAt: new Date(),
  };

  assert(!db.isPostSeen(mockItem.id), 'Post should not be marked as seen initially');
  db.markPostSeen(mockItem);
  assert(db.isPostSeen(mockItem.id), 'Post should be marked as seen after insert');

  // Test caching rest_id
  const testHandle = `testauthor_${Date.now()}`;
  assert(db.getCachedUserId(testHandle, 'x') === undefined, 'No cached user ID initially');
  db.cacheUserId(testHandle, 'x', '99887766');
  assert(db.getCachedUserId(testHandle, 'x') === '99887766', 'Cached user ID retrieved correctly');
  assert(db.getCachedUserId(testHandle.toUpperCase(), 'x') === '99887766', 'Case-insensitive lookup for user ID');

  // Test cleanup
  db.cleanupOldRecords(30);
  assert(db.isPostSeen(mockItem.id), 'Recent post should not be deleted by 30-day cleanup');

  console.log('  All Database tests passed!\n');

  // ── 2. Dispatcher Payload Tests ────────────────────────────────
  console.log('📨 Testing Dispatcher Payload Builder...');
  const dispatcher = new Dispatcher();

  // Test single image
  const singleImagePayload = dispatcher.buildPayload(mockItem);
  assert(singleImagePayload.embeds.length === 1, 'Single image produces exactly 1 embed');
  assert(singleImagePayload.embeds[0].color === 0x1da1f2, 'X platform color is 0x1DA1F2');
  assert(singleImagePayload.embeds[0].image?.url === mockItem.mediaUrls[0], 'Embed image URL matches');
  assert(singleImagePayload.embeds[0].author?.name.includes('testauthor'), 'Author handle in author field');

  // Test multi-image (up to 4)
  const multiItem: FeedItem = {
    ...mockItem,
    id: 'x:test_multi',
    mediaUrls: [
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
      'https://example.com/img3.jpg',
      'https://example.com/img4.jpg',
      'https://example.com/img5.jpg', // 5th image should be excluded from embed grid
    ],
    hasMedia: true,
  };
  const multiPayload = dispatcher.buildPayload(multiItem);
  assert(multiPayload.embeds.length === 4, 'Multi-image limits embed grid to 4 images max');
  assert(multiPayload.embeds[0].url === multiItem.url, 'First embed has item url');
  assert(multiPayload.embeds[1].url === multiItem.url, 'Second embed shares same url for Discord gallery layout');
  assert(multiPayload.embeds[3].image.url === 'https://example.com/img4.jpg', '4th embed image matches 4th media URL');

  // Test video payload with video link button
  const videoItem: FeedItem = {
    ...mockItem,
    id: 'x:test_video',
    mediaUrls: ['https://example.com/thumbnail.jpg'],
    videoUrl: 'https://video.twimg.com/ext_tw_video/test.mp4',
    hasMedia: true,
  };
  const videoPayload = dispatcher.buildPayload(videoItem);
  assert(videoPayload.embeds[0].description.includes('▶️ **[Xem Video](https://video.twimg.com/ext_tw_video/test.mp4)**'), 'Video URL badge added to description');

  console.log('  All Dispatcher tests passed!\n');

  // ── 3. Tweet Parser Tests (Media Detection) ───────────────────
  console.log('🐦 Testing X Tweet Parser with Media & Video...');

  // Mock tweet with Photo
  const mockPhotoTweet = {
    rest_id: '1001',
    core: {
      user_results: {
        result: {
          legacy: {
            name: 'Photo User',
            screen_name: 'photouser',
            profile_image_url_https: 'https://example.com/avatar_normal.jpg',
          },
        },
      },
    },
    legacy: {
      full_text: 'Tweet with a photo',
      created_at: 'Sat Nov 14 00:00:00 +0000 2026',
      extended_entities: {
        media: [
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/pic1.jpg',
          },
        ],
      },
    },
  };

  const parsedPhoto = parseTweetResult(mockPhotoTweet);
  assert(parsedPhoto !== null, 'Photo tweet parsed successfully');
  assert(parsedPhoto?.hasMedia === true, 'Photo tweet hasMedia is true');
  assert(parsedPhoto?.mediaUrls.length === 1, 'Photo tweet has 1 media URL');
  assert(parsedPhoto?.videoUrl === undefined, 'Photo tweet has no video URL');

  // Mock tweet with Video
  const mockVideoTweet = {
    rest_id: '1002',
    core: {
      user_results: {
        result: {
          legacy: {
            name: 'Video User',
            screen_name: 'videouser',
            profile_image_url_https: 'https://example.com/avatar_normal.jpg',
          },
        },
      },
    },
    legacy: {
      full_text: 'Tweet with a video',
      created_at: 'Sat Nov 14 00:00:00 +0000 2026',
      extended_entities: {
        media: [
          {
            type: 'video',
            media_url_https: 'https://pbs.twimg.com/media/thumb.jpg',
            video_info: {
              variants: [
                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/m3u8' },
                { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/vid_low.mp4' },
                { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/vid_hd.mp4' },
              ],
            },
          },
        ],
      },
    },
  };

  const parsedVideo = parseTweetResult(mockVideoTweet);
  assert(parsedVideo !== null, 'Video tweet parsed successfully');
  assert(parsedVideo?.hasMedia === true, 'Video tweet hasMedia is true');
  assert(parsedVideo?.videoUrl === 'https://video.twimg.com/vid_hd.mp4', 'Extracted highest bitrate MP4 video URL');
  assert(parsedVideo?.mediaUrls[0]?.includes('thumb.jpg'), 'Video thumbnail captured in mediaUrls');

  // Mock text-only tweet
  const mockTextTweet = {
    rest_id: '1003',
    core: {
      user_results: {
        result: {
          legacy: {
            name: 'Text User',
            screen_name: 'textuser',
            profile_image_url_https: 'https://example.com/avatar_normal.jpg',
          },
        },
      },
    },
    legacy: {
      full_text: 'Just a text tweet without any photos or videos',
      created_at: 'Sat Nov 14 00:00:00 +0000 2026',
      entities: {
        media: [],
      },
    },
  };

  const parsedText = parseTweetResult(mockTextTweet);
  assert(parsedText !== null, 'Text-only tweet parsed successfully');
  assert(parsedText?.hasMedia === false, 'Text-only tweet hasMedia is false');
  assert(parsedText?.mediaUrls.length === 0, 'Text-only tweet has 0 mediaUrls');
  assert(parsedText?.videoUrl === undefined, 'Text-only tweet has no videoUrl');

  console.log('  All Tweet Parser media tests passed!\n');

  // ── 4. Scheduler Target & Filter Tests ─────────────────────────
  console.log('⏰ Testing Scheduler Target & Filter Management...');
  const scheduler = new Scheduler();

  const dummyTarget: Target = {
    platform: 'x',
    handle: 'elonmusk',
    webhookUrl: 'https://discord.com/api/webhooks/mock',
    enabled: true,
    mediaOnly: true,
  };

  scheduler.addTarget(dummyTarget);
  assert(scheduler.getTargets().length === 1, 'Target added successfully');
  assert(scheduler.getTargets()[0].handle === 'elonmusk', 'Target handle matches');
  assert(scheduler.getTargets()[0].mediaOnly === true, 'Target mediaOnly property is preserved');

  // Test add duplicate update
  scheduler.addTarget({ ...dummyTarget, mediaOnly: false });
  assert(scheduler.getTargets().length === 1, 'Adding duplicate handle updates existing target');
  assert(scheduler.getTargets()[0].mediaOnly === false, 'Target mediaOnly updated to false');

  // Test remove
  const removed = scheduler.removeTarget('x', 'elonmusk');
  assert(removed === true, 'Remove target returned true');
  assert(scheduler.getTargets().length === 0, 'Target removed from list');

  db.close();
  console.log('  All Scheduler target management tests passed!\n');

  console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
