import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const SECRET_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_MEMORY_SECRETS = 10000;
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY_PREFIX = 'whisper:secret:';

const secrets = new Map();

let redisClient = null;
if (REDIS_URL) {
  redisClient = new Redis(REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  redisClient.on('error', (err) => console.error('Redis error', err?.message || err));
  redisClient.on('connect', () => console.log('Redis connected'));
  redisClient.on('ready', () => console.log('Redis ready'));
  redisClient.on('close', () => console.log('Redis connection closed'));
}

export function getRedisClient() {
  return redisClient?.status === 'ready' ? redisClient : null;
}

const generateSecretId = () => randomUUID();

const buildRecord = ({
  targetType,
  targetNormalized,
  targetLabel,
  secretText,
  chatType,
  authorId,
  targetPosition,
  lang,
  resolvedTargetId,
}) => ({
  targetType,
  targetNormalized: String(targetNormalized),
  targetLabel,
  secretText,
  chatType,
  authorId,
  targetPosition,
  lang,
  resolvedTargetId: resolvedTargetId || null,
  createdAt: Date.now(),
});

const getRedisKey = (id) => `${REDIS_KEY_PREFIX}${id}`;

export function sweepExpired() {
  const now = Date.now();
  for (const [id, secret] of secrets.entries()) {
    if (now - secret.createdAt > SECRET_TTL_MS) {
      secrets.delete(id);
    }
  }
}

const setMemorySecret = (id, record) => {
  sweepExpired();
  if (!secrets.has(id) && secrets.size >= MAX_MEMORY_SECRETS) {
    throw new Error('Secret memory storage is full');
  }
  secrets.set(id, record);
};

const getMemorySecret = (id) => {
  const secret = secrets.get(id);
  if (!secret) return null;
  if (Date.now() - secret.createdAt > SECRET_TTL_MS) {
    secrets.delete(id);
    return null;
  }
  return secret;
};

const getRemainingTtlMs = (secret) => {
  if (!secret?.createdAt) return SECRET_TTL_MS;
  return Math.max(0, SECRET_TTL_MS - (Date.now() - secret.createdAt));
};

export async function createSecret({
  targetType,
  targetNormalized,
  targetLabel,
  secretText,
  chatType,
  authorId,
  targetPosition,
  lang,
  resolvedTargetId,
}) {
  const id = generateSecretId();
  const record = buildRecord({
    targetType,
    targetNormalized,
    targetLabel,
    secretText,
    chatType,
    authorId,
    targetPosition,
    lang,
    resolvedTargetId,
  });

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(getRedisKey(id), JSON.stringify(record), 'PX', SECRET_TTL_MS);
      return id;
    } catch (err) {
      console.error('Failed to create secret in Redis; falling back to memory', err);
    }
  }

  setMemorySecret(id, record);
  return id;
}

export async function getSecret(id) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(getRedisKey(id));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('Failed to read secret from Redis; falling back to memory', err);
    }
  }

  return getMemorySecret(id);
}

export async function consumeSecret(id) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const result = await redis.eval(
        `
          local value = redis.call("GET", KEYS[1])
          if not value then
            return {false, -2}
          end
          local ttl = redis.call("PTTL", KEYS[1])
          redis.call("DEL", KEYS[1])
          return {value, ttl}
        `,
        1,
        getRedisKey(id)
      );
      const [raw, ttlMs] = result || [];
      if (!raw) return null;
      return { secret: JSON.parse(raw), ttlMs: Number(ttlMs) };
    } catch (err) {
      console.error('Failed to consume secret from Redis; falling back to memory', err);
    }
  }

  const secret = getMemorySecret(id);
  if (!secret) return null;
  secrets.delete(id);
  return { secret, ttlMs: getRemainingTtlMs(secret) };
}

export async function restoreSecret(id, secret, ttlMs = SECRET_TTL_MS) {
  if (!id || !secret || ttlMs <= 0) return false;

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(getRedisKey(id), JSON.stringify(secret), 'PX', ttlMs);
      return true;
    } catch (err) {
      console.error('Failed to restore secret in Redis; falling back to memory', err);
    }
  }

  setMemorySecret(id, secret);
  return true;
}

let cleanupTimer = setInterval(sweepExpired, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

export async function shutdown() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (err) {
      console.error('Error closing Redis connection', err);
      redisClient.disconnect();
    }
    redisClient = null;
  }
  secrets.clear();
}
