const DEFAULT_TIMEZONE = 'UTC';

const getZonedParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
};

const getOffsetMs = (date, timezone) => {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
};

const zonedTimeToUtcMs = ({ year, month, day, hour, minute }, timezone) => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = getOffsetMs(new Date(utcGuess), timezone);
  const firstUtc = utcGuess - firstOffset;
  const secondOffset = getOffsetMs(new Date(firstUtc), timezone);
  return utcGuess - secondOffset;
};

const addDays = ({ year, month, day }, days) => {
  const date = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const pad2 = (value) => String(value).padStart(2, '0');

export function validateTimezone(timezone, fallback = DEFAULT_TIMEZONE) {
  if (!timezone || typeof timezone !== 'string') return fallback;
  const trimmed = timezone.trim();
  if (!trimmed) return fallback;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return fallback;
  }
}

export function parseSendAt(sendAtRaw = '09:00') {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(sendAtRaw).trim());
  if (!match) return { hours: 9, minutes: 0 };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
    return { hours, minutes };
  }

  return { hours: 9, minutes: 0 };
}

export function getNextRunDelayMs(timezone, sendAtRaw = '09:00', now = new Date()) {
  const safeTimezone = validateTimezone(timezone);
  const { hours, minutes } = parseSendAt(sendAtRaw);
  const today = getZonedParts(now, safeTimezone);

  let target = {
    year: today.year,
    month: today.month,
    day: today.day,
    hour: hours,
    minute: minutes,
  };

  let targetMs = zonedTimeToUtcMs(target, safeTimezone);
  if (targetMs <= now.getTime()) {
    target = { ...addDays(target, 1), hour: hours, minute: minutes };
    targetMs = zonedTimeToUtcMs(target, safeTimezone);
  }

  return Math.max(0, targetMs - now.getTime());
}

export function formatDateInTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const safeTimezone = validateTimezone(timezone);
  const parts = getZonedParts(date, safeTimezone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function getDateWithDayOffset(timezone, dayOffset, now = new Date()) {
  const safeTimezone = validateTimezone(timezone);
  const today = getZonedParts(now, safeTimezone);
  const target = addDays(today, dayOffset);
  return `${target.year}-${pad2(target.month)}-${pad2(target.day)}`;
}

export function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

export function parseAdminIds(env = process.env) {
  const splitIds = (value) =>
    String(value || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

  const explicitIds = splitIds(env.ADMIN_IDS);
  if (explicitIds.length > 0) return explicitIds;

  return splitIds(env.ADMIN_ID);
}
