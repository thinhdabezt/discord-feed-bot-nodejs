import { Database } from '../src/core/database.js';
import { Dispatcher } from '../src/core/dispatcher.js';
import { Scheduler } from '../src/core/scheduler.js';
import { parseTweetResult } from '../src/providers/x.provider.js';
import { acquireLock, releaseLock } from '../src/utils/lock.js';
import type { FeedItem } from '../providers/base.provider.js';
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

  // ── KIỂM THỬ SỬA LỖI LẶP BÀI GHIM / BÀI CŨ (Deduplication Fix) ──
  console.log('🛡️ Testing Pinned Tweet / Old Tweet cleanup protection...');
  const pinnedTweetId = `x:pinned_${Date.now()}`;
  const oldPinnedItem: FeedItem = {
    id: pinnedTweetId,
    platform: 'x',
    authorName: 'Old Author',
    authorHandle: 'oldauthor',
    content: 'Pinned tweet from 90 days ago',
    url: `https://x.com/oldauthor/status/${pinnedTweetId}`,
    mediaUrls: [],
    hasMedia: false,
    // Đăng từ 90 ngày trước!
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
  };

  db.markPostSeen(oldPinnedItem);
  assert(db.isPostSeen(pinnedTweetId), 'Old pinned tweet marked seen');

  // Chạy dọn dẹp bản ghi cũ hơn 30 ngày
  db.cleanupOldRecords(30);

  // Quan trọng: Bài ghim dù đăng 90 ngày trước nhưng vừa thấy hôm nay, không được phép bị xóa!
  assert(
    db.isPostSeen(pinnedTweetId),
    'CRITICAL: Old pinned post MUST NOT be deleted by cleanup because seen_at is fresh',
  );

  // Test Target Sync State (Cold-Start protection)
  const syncTarget = `synctarget_${Date.now()}`;
  assert(!db.isTargetSynced('x', syncTarget), 'Target is not synced initially');
  db.markTargetSynced('x', syncTarget);
  assert(db.isTargetSynced('x', syncTarget), 'Target is marked as synced');
  assert(db.isTargetSynced('x', syncTarget.toUpperCase()), 'Target sync check is case-insensitive');

  // ── KIỂM THỬ UPSERT: markPostSeen phải refresh seen_at khi gọi lại ──
  console.log('🔄 Testing UPSERT: markPostSeen refreshes seen_at on re-call...');
  const upsertId = `x:upsert_${Date.now()}`;
  const upsertItem: FeedItem = {
    id: upsertId,
    platform: 'x',
    authorName: 'Upsert Test',
    authorHandle: 'upserttest',
    content: 'Testing upsert behavior',
    url: `https://x.com/upserttest/status/${upsertId}`,
    mediaUrls: [],
    hasMedia: false,
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 ngày trước
  };

  // Bước 1: insert bài lần đầu
  db.markPostSeen(upsertItem);
  assert(db.isPostSeen(upsertId), 'UPSERT: Post inserted on first call');

  // Bước 2: Giả lập scenario migration cũ — manually set seen_at = created_at (90 ngày trước)
  const rawDb = (db as any).db;
  const oldSeenAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
  rawDb.prepare('UPDATE posts SET seen_at = ? WHERE id = ?').run(oldSeenAt, upsertId);

  // Xác nhận seen_at đã bị set về giá trị cũ
  const beforeRow = rawDb.prepare('SELECT seen_at FROM posts WHERE id = ?').get(upsertId) as any;
  assert(beforeRow.seen_at === oldSeenAt, 'UPSERT: seen_at manually set to 90 days ago');

  // Bước 3: Gọi markPostSeen lần 2 (giả lập bot crawl lại bài này)
  db.markPostSeen(upsertItem);

  // Bước 4: Kiểm tra seen_at đã được refresh về hiện tại
  const afterRow = rawDb.prepare('SELECT seen_at FROM posts WHERE id = ?').get(upsertId) as any;
  const timeDiff = Math.abs(afterRow.seen_at - Date.now());
  assert(timeDiff < 5000, 'UPSERT: seen_at refreshed to current time (within 5s)');

  // Bước 5: Chạy cleanup 30 ngày — bài này KHÔNG bị xóa vì seen_at mới
  db.cleanupOldRecords(30);
  assert(db.isPostSeen(upsertId), 'UPSERT: Post survives cleanup because seen_at was refreshed');

  console.log('  UPSERT fix verified — no more 24h duplicate bug!');

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
    id: `x:test_multi_${Date.now()}`,
    mediaUrls: [
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
      'https://example.com/img3.jpg',
      'https://example.com/img4.jpg',
      'https://example.com/img5.jpg',
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
    id: `x:test_video_${Date.now()}`,
    mediaUrls: ['https://example.com/thumbnail.jpg'],
    videoUrl: 'https://video.twimg.com/ext_tw_video/test.mp4',
    hasMedia: true,
  };
  const videoPayload = dispatcher.buildPayload(videoItem);
  assert(videoPayload.embeds[0].description.includes('▶️ **[Xem Video](https://video.twimg.com/ext_tw_video/test.mp4)**'), 'Video URL badge added to description');

  console.log('  All Dispatcher tests passed!\n');

  // ── 3. Tweet Parser Tests (Media Detection & Retweet/Author Filter) ──
  console.log('🐦 Testing X Tweet Parser with Retweet & Author checks...');

  // Mock tweet with Photo
  const mockPhotoTweet = {
    rest_id: '1001',
    core: {
      user_results: {
        result: {
          legacy: {
            name: 'Target User',
            screen_name: 'targetuser',
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

  const parsedPhoto = parseTweetResult(mockPhotoTweet, 'targetuser');
  assert(parsedPhoto !== null, 'Photo tweet parsed successfully');
  assert(parsedPhoto?.hasMedia === true, 'Photo tweet hasMedia is true');
  assert(parsedPhoto?.mediaUrls.length === 1, 'Photo tweet has 1 media URL');
  assert(parsedPhoto?.videoUrl === undefined, 'Photo tweet has no video URL');

  // ── KIỂM THỬ LỌC RETWEET ──
  const mockRetweetWithText = {
    rest_id: '1002',
    core: {
      user_results: {
        result: {
          legacy: {
            name: 'Target User',
            screen_name: 'targetuser',
            profile_image_url_https: 'https://example.com/avatar_normal.jpg',
          },
        },
      },
    },
    legacy: {
      full_text: 'RT @elonmusk: This is a retweeted tweet',
      created_at: 'Sat Nov 14 00:00:00 +0000 2026',
      retweeted_status_id_str: '8888888',
    },
  };
  const parsedRT = parseTweetResult(mockRetweetWithText, 'targetuser');
  assert(parsedRT === null, 'Retweet with RT @ text and retweeted_status_id_str is correctly rejected');

  // ── KIỂM THỬ LỌC KHÁC TÁC GIẢ (Non-target author) ──
  const mockOtherUserTweet = {
    rest_id: '1003',
    core: {
      user_results: {
        result: {
          legacy: {
            name: 'Someone Else',
            screen_name: 'someoneelse',
            profile_image_url_https: 'https://example.com/avatar_normal.jpg',
          },
        },
      },
    },
    legacy: {
      full_text: 'Tweet from someone else in the thread',
      created_at: 'Sat Nov 14 00:00:00 +0000 2026',
    },
  };
  const parsedOther = parseTweetResult(mockOtherUserTweet, 'targetuser');
  assert(parsedOther === null, 'Tweet from another author (not targetuser) is correctly rejected');

  console.log('  All Tweet Parser media, retweet, and author tests passed!\n');

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

  // ── 5. Single Instance Lock Tests ─────────────────────────────
  console.log('🔒 Testing Single Instance Process Lock...');
  const lockAcquired = acquireLock();
  assert(lockAcquired === true, 'Acquired lock for current test process');
  releaseLock();
  console.log('  Single Instance Lock test passed!\n');

  db.close();
  console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
