import { getRedisClient as getProjectRedisClient } from './secrets.js';

const DIRECTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_MEMORY_USERS = 10000;
const MAX_MEMORY_PROFILES = 10000;
const REDIS_PROFILE_PREFIX = 'whisper:directory:profile:';
const REDIS_USERNAME_PREFIX = 'whisper:directory:username:';
const REDIS_USER_PREFIX = 'whisper:directory:user:';

const normalizeUsername = (username) => {
  if (typeof username !== 'string') return null;
  const normalized = username.trim().replace(/^@/, '').toLowerCase();
  return normalized || null;
};

const parseRecord = (raw) => {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!record?.userId) return null;
    return record;
  } catch {
    return null;
  }
};

const normalizeProfile = (profile) => {
  if (profile?.id === undefined || profile?.id === null) return null;
  return {
    id: String(profile.id),
    firstName: typeof profile.firstName === 'string' ? profile.firstName : '',
    lastName: typeof profile.lastName === 'string' ? profile.lastName : '',
    username: normalizeUsername(profile.username),
  };
};

const parseProfile = (raw) => {
  if (!raw) return null;
  try {
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
};

const profileFromTelegramUser = (user) => {
  if (typeof user?.first_name !== 'string') return null;
  return normalizeProfile({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
  });
};

const profileKey = (userId) => `${REDIS_PROFILE_PREFIX}${userId}`;
const usernameKey = (username) => `${REDIS_USERNAME_PREFIX}${username}`;
const userKey = (userId) => `${REDIS_USER_PREFIX}${userId}`;

export function createUserDirectory({
  getRedisClient = () => null,
  now = () => Date.now(),
} = {}) {
  const byUsername = new Map();
  const byUserId = new Map();
  const profiles = new Map();

  const removeMemoryUsername = (username, userId) => {
    if (!username) return;
    const current = byUsername.get(username);
    if (current?.userId === userId) {
      byUsername.delete(username);
    }
  };

  const sweepExpired = () => {
    const currentTime = now();
    for (const [userId, record] of byUserId.entries()) {
      if (record.expiresAt <= currentTime) {
        byUserId.delete(userId);
        removeMemoryUsername(record.username, userId);
      }
    }
    for (const [userId, record] of profiles.entries()) {
      if (record.expiresAt <= currentTime) {
        profiles.delete(userId);
      }
    }
  };

  const ensureMemoryCapacity = (userId) => {
    if (byUserId.has(userId) || byUserId.size < MAX_MEMORY_USERS) return;
    const oldestUserId = byUserId.keys().next().value;
    const oldest = byUserId.get(oldestUserId);
    byUserId.delete(oldestUserId);
    removeMemoryUsername(oldest?.username, oldestUserId);
  };

  const learnMemory = (userId, username) => {
    sweepExpired();
    const previous = byUserId.get(userId);
    removeMemoryUsername(previous?.username, userId);
    ensureMemoryCapacity(userId);

    const record = {
      userId,
      username,
      expiresAt: now() + DIRECTORY_TTL_MS,
    };
    byUserId.delete(userId);
    byUserId.set(userId, record);
    if (username) {
      byUsername.delete(username);
      byUsername.set(username, record);
    }
    return record;
  };

  const rememberProfileMemory = (profile) => {
    sweepExpired();
    if (!profiles.has(profile.id) && profiles.size >= MAX_MEMORY_PROFILES) {
      profiles.delete(profiles.keys().next().value);
    }
    profiles.delete(profile.id);
    profiles.set(profile.id, {
      expiresAt: now() + PROFILE_TTL_MS,
      profile,
    });
  };

  const learnRedis = async (redis, record, profile) => {
    const previous = parseRecord(await redis.get(userKey(record.userId)));
    const multi = redis.multi();

    if (previous?.username && previous.username !== record.username) {
      const previousOwner = parseRecord(await redis.get(usernameKey(previous.username)));
      if (previousOwner?.userId === record.userId) {
        multi.del(usernameKey(previous.username));
      }
    }

    multi.set(userKey(record.userId), JSON.stringify(record), 'PX', DIRECTORY_TTL_MS);
    if (record.username) {
      multi.set(usernameKey(record.username), JSON.stringify(record), 'PX', DIRECTORY_TTL_MS);
    }
    if (profile) {
      multi.set(profileKey(profile.id), JSON.stringify(profile), 'PX', PROFILE_TTL_MS);
    }
    await multi.exec();
  };

  const learn = async (user) => {
    if (user?.id === undefined || user?.id === null) return false;
    const userId = String(user.id);
    const username = normalizeUsername(user.username);
    const record = learnMemory(userId, username);
    const profile = profileFromTelegramUser(user);
    if (profile) rememberProfileMemory(profile);
    const redis = getRedisClient();

    if (redis) {
      try {
        await learnRedis(redis, record, profile);
      } catch (err) {
        console.error('Failed to persist Telegram user directory entry', err?.message || err);
      }
    }
    return true;
  };

  const resolveMemory = (username) => {
    sweepExpired();
    const record = byUsername.get(username);
    if (!record || record.username !== username) return null;
    return Number(record.userId);
  };

  const resolve = async (username) => {
    const normalized = normalizeUsername(username);
    if (!normalized) return null;
    const redis = getRedisClient();

    if (redis) {
      try {
        const record = parseRecord(await redis.get(usernameKey(normalized)));
        if (!record || record.username !== normalized) return null;
        return Number(record.userId);
      } catch (err) {
        console.error('Failed to read Telegram user directory entry', err?.message || err);
      }
    }
    return resolveMemory(normalized);
  };

  const rememberProfile = async (candidate) => {
    const profile = normalizeProfile(candidate);
    if (!profile) return false;
    rememberProfileMemory(profile);
    const redis = getRedisClient();

    if (redis) {
      try {
        await redis.set(
          profileKey(profile.id),
          JSON.stringify(profile),
          'PX',
          PROFILE_TTL_MS
        );
      } catch (err) {
        console.error('Failed to persist Telegram profile cache entry', err?.message || err);
      }
    }
    return true;
  };

  const getProfileMemory = (userId) => {
    sweepExpired();
    return profiles.get(userId)?.profile || null;
  };

  const getProfile = async (userId) => {
    if (userId === undefined || userId === null) return null;
    const normalizedId = String(userId);
    const redis = getRedisClient();

    if (redis) {
      try {
        return parseProfile(await redis.get(profileKey(normalizedId)));
      } catch (err) {
        console.error('Failed to read Telegram profile cache entry', err?.message || err);
      }
    }
    return getProfileMemory(normalizedId);
  };

  const reset = () => {
    byUsername.clear();
    byUserId.clear();
    profiles.clear();
  };

  let cleanupTimer = setInterval(sweepExpired, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();

  const shutdown = () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    reset();
  };

  return { getProfile, learn, rememberProfile, resolve, reset, shutdown };
}

const userDirectory = createUserDirectory({ getRedisClient: getProjectRedisClient });

export const learnUser = (user) => userDirectory.learn(user);
export const getProfile = (userId) => userDirectory.getProfile(userId);
export const rememberProfile = (profile) => userDirectory.rememberProfile(profile);
export const resolveUsername = (username) => userDirectory.resolve(username);
export const resetUserDirectoryForTests = () => userDirectory.reset();
export const shutdownUserDirectory = () => userDirectory.shutdown();
