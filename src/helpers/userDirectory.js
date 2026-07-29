import { getRedisClient as getProjectRedisClient } from './secrets.js';
import { getSafeErrorLogContext } from './errorLog.js';

const DIRECTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const USERNAME_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
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

const normalizeUsernames = (usernames) => [
  ...new Set(
    usernames
      .map(normalizeUsername)
      .filter(Boolean)
  ),
];

const parseRecord = (raw) => {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!record?.userId) return null;
    const username = normalizeUsername(record.username);
    const refreshedAt = record.usernamesRefreshedAt;
    return {
      ...record,
      userId: String(record.userId),
      username,
      usernames: normalizeUsernames([
        username,
        ...(Array.isArray(record.usernames) ? record.usernames : []),
      ]),
      usernamesRefreshedAt: refreshedAt != null && Number.isFinite(Number(refreshedAt))
        ? Number(refreshedAt)
        : null,
    };
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

  const removeMemoryUsernames = (usernames, userId) => {
    for (const username of usernames || []) {
      removeMemoryUsername(username, userId);
    }
  };

  const sweepExpired = () => {
    const currentTime = now();
    for (const [userId, record] of byUserId.entries()) {
      if (record.expiresAt <= currentTime) {
        byUserId.delete(userId);
        removeMemoryUsernames(record.usernames, userId);
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
    removeMemoryUsernames(oldest?.usernames, oldestUserId);
  };

  const buildUserRecord = (
    previous,
    userId,
    username,
    activeUsernames,
    currentTime
  ) => {
    const hasCompleteUsernames = Array.isArray(activeUsernames);
    const previousAliases = (previous?.usernames || [])
      .filter((candidate) => candidate !== previous?.username);
    const usernames = hasCompleteUsernames
      ? normalizeUsernames([username, ...activeUsernames])
      : normalizeUsernames([username, ...previousAliases]);
    const samePrimary = previous?.username === username;

    return {
      userId,
      username,
      usernames,
      usernamesRefreshedAt: hasCompleteUsernames
        ? currentTime
        : samePrimary
          ? previous?.usernamesRefreshedAt ?? null
          : null,
      expiresAt: currentTime + DIRECTORY_TTL_MS,
    };
  };

  const learnMemory = (userId, username, activeUsernames) => {
    sweepExpired();
    const previous = byUserId.get(userId);
    const hasCompleteUsernames = Array.isArray(activeUsernames);
    const candidate = buildUserRecord(
      previous,
      userId,
      username,
      activeUsernames,
      now()
    );
    const usernames = candidate.usernames.filter((candidateUsername) => {
      const owner = byUsername.get(candidateUsername);
      return hasCompleteUsernames
        || candidateUsername === username
        || owner?.userId === userId;
    });
    const record = { ...candidate, usernames };

    removeMemoryUsernames(
      (previous?.usernames || []).filter(
        (previousUsername) => !usernames.includes(previousUsername)
      ),
      userId
    );
    ensureMemoryCapacity(userId);

    byUserId.delete(userId);
    byUserId.set(userId, record);
    for (const activeUsername of usernames) {
      byUsername.delete(activeUsername);
      byUsername.set(activeUsername, record);
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

  const learnRedis = async (
    redis,
    userId,
    username,
    activeUsernames,
    profile
  ) => {
    const previous = parseRecord(await redis.get(userKey(userId)));
    const hasCompleteUsernames = Array.isArray(activeUsernames);
    const candidate = buildUserRecord(
      previous,
      userId,
      username,
      activeUsernames,
      now()
    );
    const relevantUsernames = normalizeUsernames([
      ...(previous?.usernames || []),
      ...candidate.usernames,
    ]);
    const owners = new Map(
      await Promise.all(
        relevantUsernames.map(async (candidateUsername) => [
          candidateUsername,
          parseRecord(await redis.get(usernameKey(candidateUsername))),
        ])
      )
    );
    const usernames = candidate.usernames.filter((candidateUsername) => {
      const owner = owners.get(candidateUsername);
      return hasCompleteUsernames
        || candidateUsername === username
        || owner?.userId === userId;
    });
    const record = { ...candidate, usernames };
    const multi = redis.multi();

    for (const previousUsername of previous?.usernames || []) {
      if (
        !usernames.includes(previousUsername)
        && owners.get(previousUsername)?.userId === userId
      ) {
        multi.del(usernameKey(previousUsername));
      }
    }

    multi.set(userKey(userId), JSON.stringify(record), 'PX', DIRECTORY_TTL_MS);
    for (const activeUsername of usernames) {
      multi.set(
        usernameKey(activeUsername),
        JSON.stringify(record),
        'PX',
        DIRECTORY_TTL_MS
      );
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
    const activeUsernames = Array.isArray(user.active_usernames)
      ? user.active_usernames
      : null;
    learnMemory(userId, username, activeUsernames);
    const profile = profileFromTelegramUser(user);
    if (profile) rememberProfileMemory(profile);
    const redis = getRedisClient();

    if (redis) {
      try {
        await learnRedis(
          redis,
          userId,
          username,
          activeUsernames,
          profile
        );
      } catch (err) {
        console.error(
          'Failed to persist Telegram user directory entry',
          getSafeErrorLogContext(err, { kind: 'storage', operation: 'directory_write' })
        );
      }
    }
    return true;
  };

  const resolveMemory = (username) => {
    sweepExpired();
    const record = byUsername.get(username);
    if (!record?.usernames?.includes(username)) return null;
    return Number(record.userId);
  };

  const resolve = async (username) => {
    const normalized = normalizeUsername(username);
    if (!normalized) return null;
    const redis = getRedisClient();

    if (redis) {
      try {
        const record = parseRecord(await redis.get(usernameKey(normalized)));
        if (!record?.usernames?.includes(normalized)) return null;
        return Number(record.userId);
      } catch (err) {
        console.error(
          'Failed to read Telegram user directory entry',
          getSafeErrorLogContext(err, { kind: 'storage', operation: 'directory_read' })
        );
      }
    }
    return resolveMemory(normalized);
  };

  const needsUsernameRefreshMemory = (userId, username) => {
    sweepExpired();
    const record = byUserId.get(userId);
    return !record
      || record.username !== username
      || record.usernamesRefreshedAt == null
      || now() - record.usernamesRefreshedAt >= USERNAME_REFRESH_TTL_MS;
  };

  const needsUsernameRefresh = async (userId, username) => {
    if (userId === undefined || userId === null) return false;
    const normalizedId = String(userId);
    const normalizedUsername = normalizeUsername(username);
    const redis = getRedisClient();

    if (redis) {
      try {
        const record = parseRecord(await redis.get(userKey(normalizedId)));
        return !record
          || record.username !== normalizedUsername
          || record.usernamesRefreshedAt == null
          || now() - record.usernamesRefreshedAt >= USERNAME_REFRESH_TTL_MS;
      } catch (err) {
        console.error(
          'Failed to read Telegram username refresh state',
          getSafeErrorLogContext(err, {
            kind: 'storage',
            operation: 'directory_refresh',
          })
        );
      }
    }
    return needsUsernameRefreshMemory(normalizedId, normalizedUsername);
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
        console.error(
          'Failed to persist Telegram profile cache entry',
          getSafeErrorLogContext(err, { kind: 'storage', operation: 'profile_write' })
        );
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
        console.error(
          'Failed to read Telegram profile cache entry',
          getSafeErrorLogContext(err, { kind: 'storage', operation: 'profile_read' })
        );
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

  return {
    getProfile,
    learn,
    needsUsernameRefresh,
    rememberProfile,
    resolve,
    reset,
    shutdown,
  };
}

const userDirectory = createUserDirectory({ getRedisClient: getProjectRedisClient });

export const learnUser = (user) => userDirectory.learn(user);
export const getProfile = (userId) => userDirectory.getProfile(userId);
export const needsUsernameRefresh = (userId, username) =>
  userDirectory.needsUsernameRefresh(userId, username);
export const rememberProfile = (profile) => userDirectory.rememberProfile(profile);
export const resolveUsername = (username) => userDirectory.resolve(username);
export const resetUserDirectoryForTests = () => userDirectory.reset();
export const shutdownUserDirectory = () => userDirectory.shutdown();
