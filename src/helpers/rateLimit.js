import { getRedisClient } from './secrets.js';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000;
const REDIS_KEY_PREFIX = 'whisper:ratelimit:';

const rateLimitMap = new Map();

export const RateLimitResult = {
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
};

function checkMemoryRateLimit(userId, increment = true) {
  if (!userId) return { result: RateLimitResult.ALLOWED };

  const now = Date.now();
  const userKey = String(userId);
  const userRecord = rateLimitMap.get(userKey);

  if (!userRecord || now - userRecord.windowStart > RATE_LIMIT_WINDOW_MS) {
    const count = increment ? 1 : 0;
    if (increment) {
      rateLimitMap.set(userKey, { count, windowStart: now });
    }
    return { result: RateLimitResult.ALLOWED, remaining: RATE_LIMIT_MAX_REQUESTS - count };
  }

  if (userRecord.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((userRecord.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { result: RateLimitResult.BLOCKED, retryAfter };
  }

  if (increment) {
    userRecord.count++;
  }
  return { result: RateLimitResult.ALLOWED, remaining: RATE_LIMIT_MAX_REQUESTS - userRecord.count };
}

async function checkRedisRateLimit(redis, userId, increment = true) {
  const key = `${REDIS_KEY_PREFIX}${userId}`;

  if (!increment) {
    const [countRaw, ttl] = await Promise.all([redis.get(key), redis.pttl(key)]);
    const count = Number(countRaw || 0);
    if (count >= RATE_LIMIT_MAX_REQUESTS) {
      return { result: RateLimitResult.BLOCKED, retryAfter: Math.ceil(Math.max(ttl, 0) / 1000) };
    }
    return { result: RateLimitResult.ALLOWED, remaining: RATE_LIMIT_MAX_REQUESTS - count };
  }

  const count = await redis.incr(key);
  let ttl = await redis.pttl(key);
  if (count === 1 || ttl < 0) {
    await redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
    ttl = RATE_LIMIT_WINDOW_MS;
  }

  if (count > RATE_LIMIT_MAX_REQUESTS) {
    return { result: RateLimitResult.BLOCKED, retryAfter: Math.ceil(Math.max(ttl, 0) / 1000) };
  }

  return { result: RateLimitResult.ALLOWED, remaining: RATE_LIMIT_MAX_REQUESTS - count };
}

export async function checkRateLimit(userId, increment = true) {
  if (!userId) return { result: RateLimitResult.ALLOWED };

  const redis = getRedisClient();
  if (redis) {
    try {
      return await checkRedisRateLimit(redis, userId, increment);
    } catch (err) {
      console.error('Redis rate limit failed; falling back to memory', err);
    }
  }

  return checkMemoryRateLimit(userId, increment);
}

function sweepExpiredRateLimits() {
  const now = Date.now();
  for (const [userId, record] of rateLimitMap.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(userId);
    }
  }
}

let cleanupTimer = setInterval(sweepExpiredRateLimits, RATE_LIMIT_CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

export function shutdownRateLimit() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  rateLimitMap.clear();
}

export function resetRateLimitForTests() {
  rateLimitMap.clear();
}
