import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const SECRET_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_MEMORY_SECRETS = 10000; // Limit for in-memory storage
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY_PREFIX = 'whisper:secret:';

const secrets = new Map();

let redisClient = null;
if (REDIS_URL) {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
  });
  redisClient.on('error', (err) => console.error('Redis error', err));
  redisClient.on('connect', () => console.log('Redis connected'));
  redisClient.on('close', () => console.log('Redis connection closed'));
}

export function getRedisClient() {
  return redisClient;
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
  targetNormalized,
  targetLabel,
  secretText,
  chatType,
  authorId,
  targetPosition,
  lang,
  resolvedTargetId: resolvedTargetId || null,
  createdAt: Date.now(),
});

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

  if (redisClient) {
    const key = `${REDIS_KEY_PREFIX}${id}`;
    await redisClient.set(key, JSON.stringify(record), 'PX', SECRET_TTL_MS);
    return id;
  }

  if (secrets.size >= MAX_MEMORY_SECRETS) {
    const oldestKey = secrets.keys().next().value;
    secrets.delete(oldestKey);
  }

  secrets.set(id, record);
  return id;
}

export async function getSecret(id) {
  if (redisClient) {
    const key = `${REDIS_KEY_PREFIX}${id}`;
    const raw = await redisClient.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (err) {
      console.error('Failed to parse secret from Redis', err);
      return null;
    }
  }

  const secret = secrets.get(id);
  if (!secret) return null;
  if (Date.now() - secret.createdAt > SECRET_TTL_MS) {
    secrets.delete(id);
    return null;
  }
  return secret;
}

export async function persistResolvedTargetId(id, secret, resolvedTargetId) {
  if (!id || !secret || !resolvedTargetId) return false;
  if (redisClient) {
    const key = `${REDIS_KEY_PREFIX}${id}`;
    try {
      const ttl = await redisClient.pttl(key);
      if (ttl <= 0) return false;
      const record = { ...secret, resolvedTargetId };
      await redisClient.set(key, JSON.stringify(record), 'PX', ttl);
      return true;
    } catch (err) {
      console.error('Failed to persist resolved target ID', err);
      return false;
    }
  }

  if (secrets.has(id)) {
    const record = secrets.get(id);
    if (record) {
      record.resolvedTargetId = resolvedTargetId;
    }
    return true;
  }

  return false;
}

export async function markConsumed(id) {
  if (redisClient) {
    const key = `${REDIS_KEY_PREFIX}${id}`;
    await redisClient.del(key);
    return true;
  }
  if (!secrets.has(id)) return false;
  secrets.delete(id);
  return true;
}

export function sweepExpired() {
  if (redisClient) return;
  const now = Date.now();
  for (const [id, secret] of secrets.entries()) {
    if (now - secret.createdAt > SECRET_TTL_MS) {
      secrets.delete(id);
    }
  }
}

let cleanupTimer = null;
if (!redisClient) {
  cleanupTimer = setInterval(sweepExpired, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
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
    }
    redisClient = null;
  }
  secrets.clear();
  console.log('Secrets storage shutdown complete');
}
