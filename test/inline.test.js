import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { handleInlineQuery } from '../src/handlers/inline.js';
import { resetRateLimitForTests } from '../src/helpers/rateLimit.js';
import { shutdown } from '../src/helpers/secrets.js';
import { resetStatsForTests, setStatsEnabled } from '../src/helpers/stats.js';
import {
  learnUser,
  resetUserDirectoryForTests,
} from '../src/helpers/userDirectory.js';
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

function createInlineContext({ query, fromId = 10, getChat } = {}) {
  const answers = [];
  return {
    answers,
    inlineQuery: {
      id: `inline-${fromId}`,
      query,
      chat_type: 'group',
      from: {
        id: fromId,
        language_code: 'en',
      },
    },
    answerInlineQuery: async (results, options) => answers.push({ results, options }),
    telegram: {
      getChat: getChat || (async () => ({ id: 42, type: 'private', username: 'friend' })),
    },
  };
}

afterEach(async () => {
  resetRateLimitForTests();
  resetStatsForTests();
  resetUserDirectoryForTests();
  resetTelegramSchedulerForTests();
  await shutdown();
});

test('does not expose secret text in inline result description', async () => {
  setStatsEnabled(false);
  await learnUser({ id: 42, username: 'friend' });
  const ctx = createInlineContext({ query: '@friend very secret text' });

  await handleInlineQuery(ctx);

  assert.equal(ctx.answers[0].results[0].id.length, 36);
  assert.doesNotMatch(ctx.answers[0].results[0].description, /very secret text/);
});

test('resolves a learned username without a Telegram getChat call', async () => {
  setStatsEnabled(false);
  await learnUser({ id: 42, username: 'friend' });
  let getChatCalls = 0;
  const ctx = createInlineContext({
    query: '@friend secret',
    getChat: async () => {
      getChatCalls++;
      throw new Error('username getChat must not run');
    },
  });

  await handleInlineQuery(ctx);

  assert.equal(getChatCalls, 0);
  assert.equal(ctx.answers[0].results[0].id.length, 36);
});

test('still creates a secret for an unknown username', async () => {
  setStatsEnabled(false);
  const ctx = createInlineContext({ query: '@unknown secret' });

  await handleInlineQuery(ctx);

  assert.equal(ctx.answers[0].results[0].id.length, 36);
  assert.match(ctx.answers[0].results[0].title, /@unknown/);
});

test('keeps the exclude wording alongside the unverified target note', async () => {
  setStatsEnabled(false);
  const ctx = createInlineContext({ query: 'secret @unknown' });

  await handleInlineQuery(ctx);

  const [result] = ctx.answers[0].results;
  assert.match(result.description, /Everyone except @unknown/);
  assert.match(result.description, /matched by username/);
});

test('keeps the whisper wording alongside the unverified target note', async () => {
  setStatsEnabled(false);
  const ctx = createInlineContext({ query: '@unknown secret' });

  await handleInlineQuery(ctx);

  const [result] = ctx.answers[0].results;
  assert.match(result.description, /Only @unknown can read it/);
  assert.match(result.description, /matched by username/);
});

test('omits the unverified note for a resolved username', async () => {
  setStatsEnabled(false);
  await learnUser({ id: 42, username: 'friend' });
  const ctx = createInlineContext({ query: '@friend secret' });

  await handleInlineQuery(ctx);

  assert.doesNotMatch(ctx.answers[0].results[0].description, /matched by username/);
});

test('caches numeric target profiles across inline updates', async () => {
  setStatsEnabled(false);
  let getChatCalls = 0;
  const getChat = async () => {
    getChatCalls++;
    return {
      id: 42,
      type: 'private',
      first_name: 'Friend',
      username: 'friend',
    };
  };

  await handleInlineQuery(createInlineContext({ query: '42 first', getChat }));
  await handleInlineQuery(createInlineContext({ query: '42 second', getChat }));

  assert.equal(getChatCalls, 1);
});

test('does not rate limit incomplete inline typing', async () => {
  setStatsEnabled(false);
  let lastCtx;

  for (let i = 0; i < 20; i++) {
    const length = Math.min('@friend'.length, (i % 8) + 1);
    lastCtx = createInlineContext({ query: '@friend'.slice(0, length), fromId: 77 });
    await handleInlineQuery(lastCtx);
  }

  assert.notEqual(lastCtx.answers[0].results[0].id, 'rate_limited');
});

test('treats character-by-character secret typing as one draft', async () => {
  setStatsEnabled(false);
  await learnUser({ id: 42, username: 'friend' });

  for (let length = 1; length <= 15; length++) {
    const ctx = createInlineContext({
      query: `@friend ${'a'.repeat(length)}`,
      fromId: 77,
    });
    await handleInlineQuery(ctx);
    assert.notEqual(ctx.answers[0].results[0].id, 'rate_limited');
  }
});

test('submits inline answers through the interactive scheduler', async () => {
  setStatsEnabled(false);
  const scheduler = createTelegramScheduler({
    limits: { interactiveConcurrency: 1 },
  });
  setTelegramSchedulerForTests(scheduler);
  const release = deferred();
  const blocker = scheduler.interactive(() => release.promise);
  await flushTasks();
  const ctx = createInlineContext({ query: 'invalid', fromId: 91 });
  let settled = false;
  const handling = handleInlineQuery(ctx).then(() => {
    settled = true;
  });

  await flushTasks();
  assert.equal(settled, false);

  release.resolve();
  await blocker;
  await handling;
  assert.equal(ctx.answers[0].results[0].id, 'usage');
  await scheduler.shutdown();
});
