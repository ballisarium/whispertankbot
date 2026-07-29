import { createHash } from 'node:crypto';
import { getRedisClient } from './secrets.js';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const DRAFT_WINDOW_MS = 15 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_MEMORY_USERS = 10000;
const REDIS_KEY_PREFIX = 'whisper:ratelimit:';

export const RateLimitResult = {
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
};

const REDIS_DRAFT_RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local keyType = redis.call("TYPE", key)
  if type(keyType) == "table" then
    keyType = keyType["ok"]
  end
  if keyType ~= "none" and keyType ~= "hash" then
    redis.call("DEL", key)
  end

  local now = tonumber(ARGV[1])
  local rateWindow = tonumber(ARGV[2])
  local maxRequests = tonumber(ARGV[3])
  local draftWindow = tonumber(ARGV[4])
  local draftField = ARGV[5]
  local text = ARGV[6]

  local windowStart = tonumber(redis.call("HGET", key, "window_start"))
  local count = tonumber(redis.call("HGET", key, "count")) or 0

  if windowStart == nil or now - windowStart >= rateWindow then
    redis.call("DEL", key)
    windowStart = now
    count = 0
    redis.call("HSET", key, "window_start", windowStart, "count", count)
  end

  local textField = draftField .. ":text"
  local updatedField = draftField .. ":updated"
  local previousText = redis.call("HGET", key, textField)
  local previousUpdated = tonumber(redis.call("HGET", key, updatedField))
  local isRecent = previousText ~= false
    and previousUpdated ~= nil
    and now - previousUpdated <= draftWindow
  local isPrefixEdit = isRecent and (
    string.sub(text, 1, string.len(previousText)) == previousText
    or string.sub(previousText, 1, string.len(text)) == text
  )

  local ttl = math.max(1, windowStart + rateWindow - now + draftWindow)

  if isPrefixEdit then
    redis.call("HSET", key, textField, text, updatedField, now)
    redis.call("PEXPIRE", key, ttl)
    return {1, maxRequests - count, 0, 0}
  end

  if count >= maxRequests then
    redis.call("PEXPIRE", key, ttl)
    return {0, 0, math.max(0, windowStart + rateWindow - now), 0}
  end

  count = count + 1
  redis.call(
    "HSET",
    key,
    "count",
    count,
    textField,
    text,
    updatedField,
    now
  )
  redis.call("PEXPIRE", key, ttl)
  return {1, maxRequests - count, 0, 1}
`;

const checkRedisDraftRateLimit = async (redis, { userId, targetKey, secretText }, now) => {
  const draftDigest = createHash('sha256').update(String(targetKey)).digest('hex');
  const result = await redis.eval(
    REDIS_DRAFT_RATE_LIMIT_SCRIPT,
    1,
    `${REDIS_KEY_PREFIX}${userId}`,
    now,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS,
    DRAFT_WINDOW_MS,
    `draft:${draftDigest}`,
    String(secretText)
  );
  const [allowed, remaining, retryAfterMs, charged] = result.map(Number);

  if (allowed === 0) {
    return {
      result: RateLimitResult.BLOCKED,
      retryAfter: Math.ceil(retryAfterMs / 1000),
      charged: false,
    };
  }
  return {
    result: RateLimitResult.ALLOWED,
    remaining,
    charged: charged === 1,
  };
};

export function createDraftRateLimiter({
  getRedisClient = () => null,
  now = () => Date.now(),
} = {}) {
  const records = new Map();

  const sweepExpired = () => {
    const currentTime = now();
    for (const [userId, record] of records.entries()) {
      if (currentTime - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
        records.delete(userId);
      }
    }
  };

  const ensureCapacity = (userId) => {
    if (records.has(userId) || records.size < MAX_MEMORY_USERS) return;
    records.delete(records.keys().next().value);
  };

  const checkMemory = ({ userId, targetKey, secretText }) => {
    if (userId === undefined || userId === null) {
      return {
        result: RateLimitResult.ALLOWED,
        remaining: RATE_LIMIT_MAX_REQUESTS,
        charged: false,
      };
    }

    const currentTime = now();
    const userKey = String(userId);
    let record = records.get(userKey);
    if (!record || currentTime - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
      ensureCapacity(userKey);
      record = {
        count: 0,
        windowStart: currentTime,
        drafts: new Map(),
      };
      records.set(userKey, record);
    }

    const draftKey = String(targetKey);
    const text = String(secretText);
    const draft = record.drafts.get(draftKey);
    const isRecent = draft && currentTime - draft.updatedAt <= DRAFT_WINDOW_MS;
    const isPrefixEdit = isRecent
      && (draft.text.startsWith(text) || text.startsWith(draft.text));

    if (isPrefixEdit) {
      record.drafts.set(draftKey, { text, updatedAt: currentTime });
      return {
        result: RateLimitResult.ALLOWED,
        remaining: RATE_LIMIT_MAX_REQUESTS - record.count,
        charged: false,
      };
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfter = Math.ceil(
        (record.windowStart + RATE_LIMIT_WINDOW_MS - currentTime) / 1000
      );
      return {
        result: RateLimitResult.BLOCKED,
        retryAfter,
        charged: false,
      };
    }

    record.count++;
    record.drafts.set(draftKey, { text, updatedAt: currentTime });
    return {
      result: RateLimitResult.ALLOWED,
      remaining: RATE_LIMIT_MAX_REQUESTS - record.count,
      charged: true,
    };
  };

  const check = async (input) => {
    if (input?.userId === undefined || input?.userId === null) {
      return checkMemory(input || {});
    }

    const redis = getRedisClient();
    if (redis) {
      try {
        return await checkRedisDraftRateLimit(redis, input, now());
      } catch (err) {
        console.error('Redis draft rate limit failed; falling back to memory', err);
      }
    }
    return checkMemory(input);
  };

  let cleanupTimer = setInterval(sweepExpired, RATE_LIMIT_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();

  const reset = () => records.clear();
  const shutdown = () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    reset();
  };

  return { check, reset, shutdown };
}

const draftRateLimiter = createDraftRateLimiter({ getRedisClient });

export const checkDraftRateLimit = (input) => draftRateLimiter.check(input);

export function shutdownRateLimit() {
  draftRateLimiter.shutdown();
}

export function resetRateLimitForTests() {
  draftRateLimiter.reset();
}
