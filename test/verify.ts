import { Database } from '../src/core/database.js';
import { Dispatcher } from '../src/core/dispatcher.js';
import { Scheduler } from '../src/core/scheduler.js';
import type { FeedItem, FeedProvider } from '../src/providers/base.provider.js';
import type { Target } from '../src/core/config.js';
import { resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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

  const mockItem: FeedItem = {
    id: 'x:test_123456789',
    platform: 'x',
    authorName: 'Test Author',
    authorHandle: 'testauthor',
    content: 'Hello world feed test',
    url: 'https://x.com/testauthor/status/123456789',
    mediaUrls: ['https://pbs.twimg.com/media/test.jpg'],
    createdAt: new Date(),
  };

  assert(!db.isPostSeen(mockItem.id), 'Post should not be marked as seen initially');
  db.markPostSeen(mockItem);
  assert(db.isPostSeen(mockItem.id), 'Post should be marked as seen after insert');

  // Test caching rest_id
  assert(db.getCachedUserId('testauthor', 'x') === undefined, 'No cached user ID initially');
  db.cacheUserId('testauthor', 'x', '99887766');
  assert(db.getCachedUserId('testauthor', 'x') === '99887766', 'Cached user ID retrieved correctly');
  assert(db.getCachedUserId('TESTAUTHOR', 'x') === '99887766', 'Case-insensitive lookup for user ID');

  // Test cleanup
  db.cleanupOldRecords(30);
  assert(db.isPostSeen(mockItem.id), 'Recent post should not be deleted by 30-day cleanup');

  db.close();
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
  };
  const multiPayload = dispatcher.buildPayload(multiItem);
  assert(multiPayload.embeds.length === 4, 'Multi-image limits embed grid to 4 images max');
  assert(multiPayload.embeds[0].url === multiItem.url, 'First embed has item url');
  assert(multiPayload.embeds[1].url === multiItem.url, 'Second embed shares same url for Discord gallery layout');
  assert(multiPayload.embeds[3].image.url === 'https://example.com/img4.jpg', '4th embed image matches 4th media URL');

  console.log('  All Dispatcher tests passed!\n');

  // ── 3. Scheduler Target Management Tests ───────────────────────
  console.log('⏰ Testing Scheduler Target Management...');
  const scheduler = new Scheduler();

  const dummyTarget: Target = {
    platform: 'x',
    handle: 'elonmusk',
    webhookUrl: 'https://discord.com/api/webhooks/mock',
    enabled: true,
  };

  scheduler.addTarget(dummyTarget);
  assert(scheduler.getTargets().length === 1, 'Target added successfully');
  assert(scheduler.getTargets()[0].handle === 'elonmusk', 'Target handle matches');

  // Test add duplicate update
  scheduler.addTarget({ ...dummyTarget, webhookUrl: 'https://discord.com/api/webhooks/updated' });
  assert(scheduler.getTargets().length === 1, 'Adding duplicate handle updates existing target');
  assert(scheduler.getTargets()[0].webhookUrl === 'https://discord.com/api/webhooks/updated', 'Webhook updated');

  // Test remove
  const removed = scheduler.removeTarget('x', 'elonmusk');
  assert(removed === true, 'Remove target returned true');
  assert(scheduler.getTargets().length === 0, 'Target removed from list');

  const removedAgain = scheduler.removeTarget('x', 'elonmusk');
  assert(removedAgain === false, 'Removing non-existent target returns false');

  console.log('  All Scheduler target management tests passed!\n');

  console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
