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

test('returns the unavailable result for an unknown username', async () => {
  setStatsEnabled(false);
  const ctx = createInlineContext({ query: '@unknown secret' });

  await handleInlineQuery(ctx);

  assert.equal(ctx.answers[0].results[0].id, 'target_unavailable');
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
