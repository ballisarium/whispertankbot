const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // max requests per window
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1000;

const rateLimitMap = new Map();

export const RateLimitResult = {
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
};

export function checkRateLimit(userId, increment = true) {
  if (!userId) return { result: RateLimitResult.ALLOWED };
  
  const now = Date.now();
  const userKey = String(userId);
  const userRecord = rateLimitMap.get(userKey);
  
  if (!userRecord) {
    if (increment) {
      rateLimitMap.set(userKey, { count: 1, windowStart: now });
    }
    return { result: RateLimitResult.ALLOWED, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  
  if (now - userRecord.windowStart > RATE_LIMIT_WINDOW_MS) {
    if (increment) {
      rateLimitMap.set(userKey, { count: 1, windowStart: now });
    }
    return { result: RateLimitResult.ALLOWED, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
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
