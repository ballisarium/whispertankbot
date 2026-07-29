import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildDailyReport,
  getDailyStats,
  getStatsTimezone,
  resetStatsForTests,
  setStatsEnabled,
  setStatsTimezone,
  sendDailyReport,
  trackMessage,
} from '../src/helpers/stats.js';
import {
  createTelegramScheduler,
  resetTelegramSchedulerForTests,
  setTelegramSchedulerForTests,
} from '../src/helpers/telegramScheduler.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  resetStatsForTests();
  resetTelegramSchedulerForTests();
});

test('does not collect stats while stats are disabled', async () => {
  setStatsEnabled(false);

  await trackMessage({
    dateString: '2026-06-17',
    authorId: 1,
    targetNormalized: '2',
    targetPosition: 'front',
    secretTextLength: 10,
    chatType: 'private',
  });

  const stats = await getDailyStats('2026-06-17');
  assert.equal(stats.counters.total_messages || 0, 0);
});

test('invalid stats timezone falls back without breaking tracking', async () => {
  setStatsEnabled(true);
  setStatsTimezone('No/Such_Zone');

  await trackMessage({
    dateString: '2026-06-17',
    authorId: 1,
    targetNormalized: '2',
    targetPosition: 'front',
    secretTextLength: 10,
    chatType: 'private',
  });

  const stats = await getDailyStats('2026-06-17');
  assert.equal(getStatsTimezone(), 'UTC');
  assert.equal(stats.counters.total_messages, 1);
});

test('escapes arbitrary report date text in HTML report output', async () => {
  setStatsEnabled(true);

  const report = await buildDailyReport('2026-06-17<script>');

  assert.match(report, /&lt;script&gt;/);
  assert.doesNotMatch(report, /<script>/);
});

test('submits daily reports through the delivery scheduler', async () => {
  let now = 0;
  const scheduler = createTelegramScheduler({
    limits: { deliveryConcurrency: 1 },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  setTelegramSchedulerForTests(scheduler);
  const release = deferred();
  const blocker = scheduler.delivery('user:1', () => release.promise);
  await flushTasks();
  const messages = [];
  const bot = {
    telegram: {
      sendMessage: async (...args) => messages.push(args),
    },
  };
  let settled = false;
  const sending = sendDailyReport(bot, ['1'], '2026-06-17').then(() => {
    settled = true;
  });

  await flushTasks();
  assert.equal(settled, false);

  release.resolve();
  await blocker;
  await sending;
  assert.equal(messages.length, 1);
  await scheduler.shutdown();
});
