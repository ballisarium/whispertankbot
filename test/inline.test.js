import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { handleInlineQuery } from '../src/handlers/inline.js';
import { resetRateLimitForTests } from '../src/helpers/rateLimit.js';
import { shutdown } from '../src/helpers/secrets.js';
import { resetStatsForTests, setStatsEnabled } from '../src/helpers/stats.js';

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
  await shutdown();
});

test('does not expose secret text in inline result description', async () => {
  setStatsEnabled(false);
  const ctx = createInlineContext({ query: '@friend very secret text' });

  await handleInlineQuery(ctx);

  assert.equal(ctx.answers[0].results[0].id.length, 36);
  assert.doesNotMatch(ctx.answers[0].results[0].description, /very secret text/);
});

test('rate limits invalid inline queries too', async () => {
  setStatsEnabled(false);
  let lastCtx;

  for (let i = 0; i < 11; i++) {
    lastCtx = createInlineContext({ query: 'invalid', fromId: 77 });
    await handleInlineQuery(lastCtx);
  }

  assert.equal(lastCtx.answers[0].results[0].id, 'rate_limited');
});
