import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { handleStatsCommand } from '../src/handlers/start.js';
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
  resetTelegramSchedulerForTests();
});

test('stats command rejects invalid date before building report', async () => {
  const replies = [];
  let buildCalled = false;
  const ctx = {
    from: { id: 1, language_code: 'en' },
    message: { text: '/stats 2026-99-99<script>' },
    reply: async (text, options) => replies.push({ text, options }),
  };

  await handleStatsCommand(ctx, true, async () => {
    buildCalled = true;
    return 'report';
  });

  assert.equal(buildCalled, false);
  assert.equal(replies[0]?.text, 'usage: /stats YYYY-MM-DD');
});

test('submits command replies through the delivery scheduler', async () => {
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
  const replies = [];
  const ctx = {
    from: { id: 1, language_code: 'en' },
    message: { text: '/stats 2026-99-99' },
    reply: async (text, options) => replies.push({ text, options }),
  };
  let settled = false;
  const handling = handleStatsCommand(ctx, true, async () => 'report').then(() => {
    settled = true;
  });

  await flushTasks();
  assert.equal(settled, false);

  release.resolve();
  await blocker;
  await handling;
  assert.equal(replies[0]?.text, 'usage: /stats YYYY-MM-DD');
  await scheduler.shutdown();
});
