import { getRedisClient } from './secrets.js';

const REDIS_KEY_PREFIX = 'whisper:user:';
const SETTINGS_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

const userSettings = new Map();

export async function getUserLang(userId) {
  if (!userId) return null;
  const key = String(userId);
  const redisClient = getRedisClient();
  
  if (redisClient) {
    try {
      const data = await redisClient.get(`${REDIS_KEY_PREFIX}${key}`);
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.lang || null;
      }
    } catch (err) {
      console.error('Failed to get user settings from Redis', err);
    }
    return null;
  }
  
  const settings = userSettings.get(key);
  return settings?.lang || null;
}

export async function setUserLang(userId, lang) {
  if (!userId) return false;
  const key = String(userId);
  const data = { lang, updatedAt: Date.now() };
  const redisClient = getRedisClient();
  
  if (redisClient) {
    try {
      await redisClient.set(
        `${REDIS_KEY_PREFIX}${key}`,
        JSON.stringify(data),
        'PX',
        SETTINGS_TTL_MS
      );
      return true;
    } catch (err) {
      console.error('Failed to save user settings to Redis', err);
      return false;
    }
  }
  
  userSettings.set(key, data);
  return true;
}

const startCooldown = new Map();
const START_COOLDOWN_MS = 5000; // 5 seconds
const MAX_COOLDOWN_ENTRIES = 10000;
const COOLDOWN_CLEANUP_INTERVAL_MS = 60 * 1000;

export function checkStartCooldown(userId) {
  if (!userId) return { allowed: true };
  const key = String(userId);
  const now = Date.now();
  const lastTime = startCooldown.get(key);
  
  if (lastTime && now - lastTime < START_COOLDOWN_MS) {
    const retryAfter = Math.ceil((START_COOLDOWN_MS - (now - lastTime)) / 1000);
    return { allowed: false, retryAfter };
  }
  
  if (startCooldown.size >= MAX_COOLDOWN_ENTRIES) {
    const oldestKey = startCooldown.keys().next().value;
    startCooldown.delete(oldestKey);
  }
  
  startCooldown.set(key, now);
  return { allowed: true };
}

function sweepExpiredCooldowns() {
  const now = Date.now();
  for (const [key, time] of startCooldown.entries()) {
    if (now - time > START_COOLDOWN_MS) {
      startCooldown.delete(key);
    }
  }
}

let cooldownCleanupTimer = setInterval(sweepExpiredCooldowns, COOLDOWN_CLEANUP_INTERVAL_MS);
if (cooldownCleanupTimer.unref) {
  cooldownCleanupTimer.unref();
}

export function shutdownUserSettings() {
  if (cooldownCleanupTimer) {
    clearInterval(cooldownCleanupTimer);
    cooldownCleanupTimer = null;
  }
  userSettings.clear();
  startCooldown.clear();
}
