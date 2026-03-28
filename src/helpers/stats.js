import { getRedisClient } from './secrets.js';

const STATS_PREFIX = 'whisper:stats:';
const STATS_TTL_DAYS = 40;
const STATS_TTL_MS = STATS_TTL_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = process.env.STATS_TIMEZONE || 'UTC';
const BUCKET_SIZE = 20;
const MAX_BUCKET = 200;

let statsTimezone = DEFAULT_TIMEZONE;

const memoryStats = new Map();

const formatDateInTimezone = (date = new Date(), timezone = statsTimezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

export const setStatsTimezone = (timezone) => {
  if (timezone) {
    statsTimezone = timezone;
  }
};

export const getStatsTimezone = () => statsTimezone;

const getDateString = (dateOverride) => formatDateInTimezone(dateOverride || new Date());

const buildHashKey = (dateStr) => `${STATS_PREFIX}${dateStr}:counters`;
const buildAuthorsKey = (dateStr) => `${STATS_PREFIX}${dateStr}:authors`;
const buildTargetsKey = (dateStr) => `${STATS_PREFIX}${dateStr}:targets`;

const clampLength = (value) => {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
};

const normalizeChatType = (chatType) => {
  if (!chatType) return 'unknown';
  const lowered = String(chatType).toLowerCase();
  if (['private', 'group', 'supergroup', 'channel'].includes(lowered)) return lowered;
  return 'unknown';
};

const getBucketLabel = (length) => {
  const len = clampLength(length);
  if (len > MAX_BUCKET) return `gt${MAX_BUCKET}`;
  if (len === 0) return '0';
  const bucketStart = Math.floor(len / BUCKET_SIZE) * BUCKET_SIZE;
  return String(bucketStart);
};

const ensureMemoryEntry = (dateStr) => {
  if (!memoryStats.has(dateStr)) {
    memoryStats.set(dateStr, {
      counters: new Map(),
      chat: new Map(),
      histogram: new Map(),
      authors: new Set(),
      targets: new Set(),
      createdAt: Date.now(),
    });
  }
  return memoryStats.get(dateStr);
};

const cleanupMemoryStats = () => {
  const now = Date.now();
  for (const [dateStr, entry] of memoryStats.entries()) {
    if (now - (entry.createdAt || now) > STATS_TTL_MS) {
      memoryStats.delete(dateStr);
    }
  }
};

const incMap = (map, key, delta = 1) => {
  map.set(key, (map.get(key) || 0) + delta);
};

const incHashField = (multi, key, field, delta = 1) => {
  multi.hincrby(key, field, delta);
};

const applyTTL = (multi, key) => {
  multi.pexpire(key, STATS_TTL_MS);
};

const recordHistogramRedis = (multi, hashKey, length) => {
  const bucket = getBucketLabel(length);
  incHashField(multi, hashKey, `hist_${bucket}`, 1);
};

const recordChatTypeRedis = (multi, hashKey, chatType) => {
  const normalized = normalizeChatType(chatType);
  incHashField(multi, hashKey, `chat_${normalized}`, 1);
};

const recordHistogramMemory = (histogramMap, length) => {
  const bucket = getBucketLabel(length);
  incMap(histogramMap, bucket, 1);
};

const recordChatTypeMemory = (chatMap, chatType) => {
  const normalized = normalizeChatType(chatType);
  incMap(chatMap, normalized, 1);
};

export async function trackMessage({
  dateString,
  authorId,
  targetNormalized,
  targetPosition,
  secretTextLength = 0,
  chatType,
} = {}) {
  const dateStr = dateString || getDateString();
  const redis = getRedisClient();
  const isExcludeMode = targetPosition === 'back';
  const length = clampLength(secretTextLength);

  if (redis) {
    const hashKey = buildHashKey(dateStr);
    const authorsKey = buildAuthorsKey(dateStr);
    const targetsKey = buildTargetsKey(dateStr);
    const multi = redis.multi();

    incHashField(multi, hashKey, 'total_messages', 1);
    if (isExcludeMode) {
      incHashField(multi, hashKey, 'mode_except', 1);
    } else {
      incHashField(multi, hashKey, 'mode_for', 1);
    }
    incHashField(multi, hashKey, 'sum_len', length);
    recordChatTypeRedis(multi, hashKey, chatType);
    recordHistogramRedis(multi, hashKey, length);

    if (authorId !== undefined && authorId !== null) {
      multi.pfadd(authorsKey, String(authorId));
      applyTTL(multi, authorsKey);
    }
    if (targetNormalized !== undefined && targetNormalized !== null) {
      multi.pfadd(targetsKey, String(targetNormalized));
      applyTTL(multi, targetsKey);
    }

    applyTTL(multi, hashKey);
    await multi.exec();
    return;
  }

  cleanupMemoryStats();
  const entry = ensureMemoryEntry(dateStr);
  incMap(entry.counters, 'total_messages', 1);
  if (isExcludeMode) {
    incMap(entry.counters, 'mode_except', 1);
  } else {
    incMap(entry.counters, 'mode_for', 1);
  }
  incMap(entry.counters, 'sum_len', length);
  recordChatTypeMemory(entry.chat, chatType);
  recordHistogramMemory(entry.histogram, length);
  if (authorId !== undefined && authorId !== null) {
    entry.authors.add(String(authorId));
  }
  if (targetNormalized !== undefined && targetNormalized !== null) {
    entry.targets.add(String(targetNormalized));
  }
}

export async function trackError({ dateString, type }) {
  const dateStr = dateString || getDateString();
  const redis = getRedisClient();
  const field =
    type === 'parse' ? 'errors_parse' : type === 'rate_limit' ? 'errors_rate_limit' : 'errors_other';

  if (redis) {
    const hashKey = buildHashKey(dateStr);
    const multi = redis.multi();
    incHashField(multi, hashKey, field, 1);
    applyTTL(multi, hashKey);
    await multi.exec();
    return;
  }

  cleanupMemoryStats();
  const entry = ensureMemoryEntry(dateStr);
  incMap(entry.counters, field, 1);
}

export async function trackRead({ dateString, outcome }) {
  const dateStr = dateString || getDateString();
  const redis = getRedisClient();
  const field =
    outcome === 'delivered'
      ? 'reads_delivered'
      : outcome === 'blocked'
        ? 'reads_blocked'
        : 'reads_expired';

  if (redis) {
    const hashKey = buildHashKey(dateStr);
    const multi = redis.multi();
    incHashField(multi, hashKey, field, 1);
    applyTTL(multi, hashKey);
    await multi.exec();
    return;
  }

  cleanupMemoryStats();
  const entry = ensureMemoryEntry(dateStr);
  incMap(entry.counters, field, 1);
}

const parseIntSafe = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const extractPrefixedFields = (obj, prefix) => {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith(prefix)) {
      const stripped = key.slice(prefix.length);
      result[stripped] = parseIntSafe(value);
    }
  }
  return result;
};

const getRedisDailyStats = async (dateStr, redis) => {
  const hashKey = buildHashKey(dateStr);
  const authorsKey = buildAuthorsKey(dateStr);
  const targetsKey = buildTargetsKey(dateStr);

  const [hash, authorsCount, targetsCount] = await Promise.all([
    redis.hgetall(hashKey),
    redis.pfcount(authorsKey).catch(() => 0),
    redis.pfcount(targetsKey).catch(() => 0),
  ]);

  const counters = {
    total_messages: parseIntSafe(hash.total_messages),
    mode_for: parseIntSafe(hash.mode_for),
    mode_except: parseIntSafe(hash.mode_except),
    sum_len: parseIntSafe(hash.sum_len),
    errors_parse: parseIntSafe(hash.errors_parse),
    errors_rate_limit: parseIntSafe(hash.errors_rate_limit),
    errors_other: parseIntSafe(hash.errors_other),
    reads_delivered: parseIntSafe(hash.reads_delivered),
    reads_blocked: parseIntSafe(hash.reads_blocked),
    reads_expired: parseIntSafe(hash.reads_expired),
  };

  const chatTypes = extractPrefixedFields(hash, 'chat_');
  const histogram = extractPrefixedFields(hash, 'hist_');

  return {
    date: dateStr,
    counters,
    chatTypes,
    histogram,
    unique_authors: authorsCount || 0,
    unique_targets: targetsCount || 0,
  };
};

const getMemoryDailyStats = (dateStr) => {
  cleanupMemoryStats();
  const entry = memoryStats.get(dateStr);
  if (!entry) {
    return {
      date: dateStr,
      counters: {},
      chatTypes: {},
      histogram: {},
      unique_authors: 0,
      unique_targets: 0,
    };
  }

  const counters = Object.fromEntries(entry.counters.entries());
  const chatTypes = Object.fromEntries(entry.chat.entries());
  const histogram = Object.fromEntries(entry.histogram.entries());

  return {
    date: dateStr,
    counters,
    chatTypes,
    histogram,
    unique_authors: entry.authors.size,
    unique_targets: entry.targets.size,
  };
};

export async function getDailyStats(dateString) {
  const dateStr = dateString || getDateString();
  const redis = getRedisClient();
  if (redis) {
    return getRedisDailyStats(dateStr, redis);
  }
  return getMemoryDailyStats(dateStr);
}

export { getDateString };

function computePercentiles(histogram = {}, percentiles = [0.5, 0.9]) {
  const buckets = Object.entries(histogram)
    .map(([bucket, count]) => [bucket, Number(count) || 0])
    .filter(([, c]) => c > 0)
    .sort((a, b) => {
      const aVal = a[0].startsWith('gt') ? MAX_BUCKET + 1 : Number(a[0]);
      const bVal = b[0].startsWith('gt') ? MAX_BUCKET + 1 : Number(b[0]);
      return aVal - bVal;
    });

  const total = buckets.reduce((sum, [, c]) => sum + c, 0);
  if (total === 0) {
    return percentiles.reduce((acc, p) => ({ ...acc, [p]: 0 }), {});
  }

  const results = {};
  for (const p of percentiles) {
    const target = total * p;
    let cumulative = 0;
    let value = 0;
    for (const [bucket, count] of buckets) {
      cumulative += count;
      if (cumulative >= target) {
        if (bucket.startsWith('gt')) {
          value = MAX_BUCKET + BUCKET_SIZE;
        } else {
          value = Number(bucket) + BUCKET_SIZE;
        }
        break;
      }
    }
    results[p] = value;
  }
  return results;
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : '0';
}

function formatChatTypes(chatTypes = {}) {
  const entries = Object.entries(chatTypes).filter(([, v]) => Number(v) > 0);
  if (!entries.length) return '—';
  return entries
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

export async function buildDailyReport(dateString) {
  const stats = await getDailyStats(dateString);
  const {
    counters = {},
    chatTypes = {},
    histogram = {},
    unique_authors = 0,
    unique_targets = 0,
    date,
  } = stats;

  const total = counters.total_messages || 0;
  const modeFor = counters.mode_for || 0;
  const modeExcept = counters.mode_except || 0;
  const sumLen = counters.sum_len || 0;
  const avgLen = total > 0 ? Math.round(sumLen / total) : 0;
  const percentiles = computePercentiles(histogram, [0.5, 0.9]);
  const p50 = formatNumber(percentiles[0.5]);
  const p90 = formatNumber(percentiles[0.9]);

  const errorsParse = counters.errors_parse || 0;
  const errorsRate = counters.errors_rate_limit || 0;
  const errorsOther = counters.errors_other || 0;

  const readsDelivered = counters.reads_delivered || 0;
  const readsBlocked = counters.reads_blocked || 0;
  const readsExpired = counters.reads_expired || 0;

  const chatTypesText = formatChatTypes(chatTypes);

  const lines = [
    `<b>whisper daily — ${date}</b>`,
    `total: ${total} (for: ${modeFor}, except: ${modeExcept})`,
    `unique authors: ${unique_authors}; unique targets: ${unique_targets}`,
    `lengths: avg ${avgLen}; p50 ${p50}; p90 ${p90}`,
    `chat types: ${chatTypesText}`,
    `reads: delivered ${readsDelivered}; blocked ${readsBlocked}; expired ${readsExpired}`,
    `errors: parse ${errorsParse}; rate ${errorsRate}; other ${errorsOther}`,
  ];

  return lines.join('\n');
}

export async function sendDailyReport(bot, adminIds = [], dateString) {
  if (!bot || !Array.isArray(adminIds) || adminIds.length === 0) return;
  const report = await buildDailyReport(dateString);
  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(adminId, report, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      console.error(`Failed to send stats to admin ${adminId}`, err);
    }
  }
}
