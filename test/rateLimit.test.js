import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDraftRateLimiter,
  RateLimitResult,
} from '../src/helpers/rateLimit.js';

test('charges character-by-character edits as one draft', async () => {
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => 1_000 });

  for (const secretText of ['h', 'he', 'hel', 'hell', 'hello']) {
    const check = await limiter.check({
      userId: 7,
      targetKey: 'front:friend',
      secretText,
    });
    assert.equal(check.result, RateLimitResult.ALLOWED);
  }

  const repeated = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'hello',
  });
  assert.equal(repeated.charged, false);
  assert.equal(repeated.remaining, 9);
});

test('charges a non-prefix replacement as a distinct draft', async () => {
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => 1_000 });
  await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'first' });

  const check = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'second',
  });

  assert.equal(check.result, RateLimitResult.ALLOWED);
  assert.equal(check.charged, true);
  assert.equal(check.remaining, 8);
});

test('charges the next complete query after the draft window', async () => {
  let now = 1_000;
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => now });
  await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'hello' });

  now += 15_001;
  const check = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'hello!',
  });

  assert.equal(check.result, RateLimitResult.ALLOWED);
  assert.equal(check.charged, true);
  assert.equal(check.remaining, 8);
});

test('blocks the eleventh distinct draft in one minute', async () => {
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => 1_000 });

  for (let i = 0; i < 10; i++) {
    const check = await limiter.check({
      userId: 7,
      targetKey: 'front:friend',
      secretText: `draft-${i}`,
    });
    assert.equal(check.result, RateLimitResult.ALLOWED);
  }

  const blocked = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'draft-10',
  });
  assert.deepEqual(blocked, {
    result: RateLimitResult.BLOCKED,
    retryAfter: 60,
    charged: false,
  });
});
