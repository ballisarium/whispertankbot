import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { handleInlineQuery } from './handlers/inline.js';
import { handleReadCallback } from './handlers/callback.js';
import { handleStart, handleLangCallback, handleStatsCommand } from './handlers/start.js';
import { setBotUsername } from './helpers/parseInlineQuery.js';
import { shutdown as shutdownSecrets } from './helpers/secrets.js';
import { shutdownRateLimit } from './helpers/rateLimit.js';
import { shutdownUserSettings } from './helpers/userSettings.js';
import { buildDailyReport, getStatsTimezone, setStatsTimezone, sendDailyReport } from './helpers/stats.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const STATS_ENABLED = process.env.STATS_ENABLED === 'true';
const STATS_TIMEZONE = process.env.STATS_TIMEZONE;
const STATS_SEND_AT = process.env.STATS_SEND_AT || '09:00';
const ADMIN_IDS =
  process.env.ADMIN_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ||
  (process.env.ADMIN_ID ? [process.env.ADMIN_ID] : []);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required. Set it in your environment or .env file.');
  process.exit(1);
}

if (!BOT_USERNAME) {
  console.warn('BOT_USERNAME missing. Set BOT_USERNAME for clearer hints and logs.');
} else {
  setBotUsername(BOT_USERNAME);
}

if (STATS_TIMEZONE) {
  setStatsTimezone(STATS_TIMEZONE);
}

const bot = new Telegraf(BOT_TOKEN, {
  username: BOT_USERNAME,
});

bot.catch((err, ctx) => {
  const updateId = ctx?.update?.update_id || 'unknown';
  console.error(`Bot error for update ${updateId}:`, err);
});

bot.start(handleStart);
bot.action(/^lang:(.+)$/, handleLangCallback);
bot.on('inline_query', handleInlineQuery);
bot.action(/^read:(.+)$/, handleReadCallback);
bot.command('stats', async (ctx) => {
  const userId = ctx.from?.id;
  const isAdmin = userId && ADMIN_IDS.includes(String(userId));
  await handleStatsCommand(ctx, isAdmin, buildDailyReport);
});

bot.on('chosen_inline_result', (ctx) => {
  console.log('Inline result chosen:', ctx.chosenInlineResult);
});

bot.launch().then(() => {
  console.log(`Bot @${BOT_USERNAME || 'unknown'} started successfully`);
});

function parseSendAt(sendAtRaw) {
  const [h, m] = sendAtRaw.split(':').map((x) => Number(x));
  if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h < 24 && m >= 0 && m < 60) {
    return { hours: h, minutes: m };
  }
  return { hours: 9, minutes: 0 };
}

function getNextRunTime(timezone, sendAtRaw) {
  const { hours, minutes } = parseSendAt(sendAtRaw);
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const [year, month, day] = todayStr.split('-').map((x) => Number(x));
  const candidate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const nowLocal = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  );

  if (candidate <= nowLocal) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate.getTime() - now.getTime();
}

let statsTimer = null;

async function startStatsScheduler() {
  if (!STATS_ENABLED) return;
  if (!ADMIN_IDS.length) {
    console.warn('STATS_ENABLED is true but ADMIN_ID(S) not set; scheduler not started');
    return;
  }

  const timezone = getStatsTimezone();
  const initialDelay = getNextRunTime(timezone, STATS_SEND_AT);
  console.log(
    `Stats scheduler: first run in ${Math.round(initialDelay / 1000)}s (tz=${timezone}, at=${STATS_SEND_AT})`
  );

  statsTimer = setTimeout(async function run() {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(yesterday);

    console.log(`Sending daily stats for ${yesterdayStr} to admins: ${ADMIN_IDS.join(', ')}`);
    try {
      await sendDailyReport(bot, ADMIN_IDS, yesterdayStr);
    } catch (err) {
      console.error('Failed to send daily report', err);
    }

    const nextDelay = getNextRunTime(timezone, STATS_SEND_AT);
    statsTimer = setTimeout(run, nextDelay);
    if (statsTimer.unref) statsTimer.unref();
  }, initialDelay);
  if (statsTimer.unref) statsTimer.unref();
}

startStatsScheduler();

const gracefulShutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  await shutdownSecrets();
  shutdownRateLimit();
  shutdownUserSettings();
  process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
