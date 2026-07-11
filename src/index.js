import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { handleInlineQuery } from './handlers/inline.js';
import { handleReadCallback } from './handlers/callback.js';
import { handleStart, handleLangCallback, handleMenuCallback, handleStatsCommand } from './handlers/start.js';
import { getBotUsername, normalizeBotUsername, setBotUsername } from './helpers/parseInlineQuery.js';
import { shutdown as shutdownSecrets } from './helpers/secrets.js';
import { shutdownRateLimit } from './helpers/rateLimit.js';
import { shutdownUserSettings } from './helpers/userSettings.js';
import { buildDailyReport, getStatsTimezone, setStatsEnabled, setStatsTimezone, sendDailyReport } from './helpers/stats.js';
import { getDateWithDayOffset, getNextRunDelayMs, parseAdminIds } from './helpers/config.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const STATS_ENABLED = process.env.STATS_ENABLED === 'true';
const STATS_TIMEZONE = process.env.STATS_TIMEZONE;
const STATS_SEND_AT = process.env.STATS_SEND_AT || '09:00';
const ADMIN_IDS = parseAdminIds(process.env);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required. Set it in your environment or .env file.');
  process.exit(1);
}

const normalizedBotUsername = normalizeBotUsername(BOT_USERNAME);
if (!BOT_USERNAME) {
  console.warn('BOT_USERNAME missing. Set BOT_USERNAME for clearer hints and logs.');
} else if (!normalizedBotUsername) {
  console.warn('BOT_USERNAME is invalid. Falling back to generic hints.');
} else {
  setBotUsername(normalizedBotUsername);
}

setStatsEnabled(STATS_ENABLED);
setStatsTimezone(STATS_TIMEZONE);

const bot = new Telegraf(BOT_TOKEN, {
  username: normalizedBotUsername || undefined,
});

bot.catch((err, ctx) => {
  const updateId = ctx?.update?.update_id || 'unknown';
  console.error(`Bot error for update ${updateId}:`, err);
});

bot.start(handleStart);
bot.action(/^lang:(.+)$/, handleLangCallback);
bot.action(/^menu:(.+)$/, handleMenuCallback);
bot.on('inline_query', handleInlineQuery);
bot.action(/^read:(.+)$/, handleReadCallback);
bot.command('stats', async (ctx) => {
  const userId = ctx.from?.id;
  const isAdmin = userId && ADMIN_IDS.includes(String(userId));
  await handleStatsCommand(ctx, isAdmin, buildDailyReport);
});

let statsTimer = null;

async function startStatsScheduler() {
  if (!STATS_ENABLED) return;
  if (!ADMIN_IDS.length) {
    console.warn('STATS_ENABLED is true but ADMIN_ID(S) not set; scheduler not started');
    return;
  }

  const timezone = getStatsTimezone();
  const initialDelay = getNextRunDelayMs(timezone, STATS_SEND_AT);
  console.log(
    `Stats scheduler: first run in ${Math.round(initialDelay / 1000)}s (tz=${timezone}, at=${STATS_SEND_AT})`
  );

  statsTimer = setTimeout(async function run() {
    const yesterdayStr = getDateWithDayOffset(timezone, -1);

    console.log(`Sending daily stats for ${yesterdayStr} to admins: ${ADMIN_IDS.join(', ')}`);
    try {
      await sendDailyReport(bot, ADMIN_IDS, yesterdayStr);
    } catch (err) {
      console.error('Failed to send daily report', err);
    }

    const nextDelay = getNextRunDelayMs(timezone, STATS_SEND_AT);
    statsTimer = setTimeout(run, nextDelay);
    if (statsTimer.unref) statsTimer.unref();
  }, initialDelay);
  if (statsTimer.unref) statsTimer.unref();
}

const shutdownResources = async (signal) => {
  console.log(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  await shutdownSecrets();
  shutdownRateLimit();
  shutdownUserSettings();
};

async function main() {
  try {
    // Telegraf v4 `launch()` only resolves once the bot stops, so post-startup
    // work must run from the onLaunch callback; otherwise the stats scheduler
    // and the startup log would never run while the bot is polling.
    await bot.launch(() => {
      console.log(`Bot @${getBotUsername()} started successfully`);
      startStatsScheduler().catch((err) => {
        console.error('Failed to start stats scheduler', err);
      });
    });
  } catch (err) {
    console.error('Failed to launch bot', err);
    await shutdownResources('launch_error');
    process.exit(1);
  }
}

main();

const gracefulShutdown = async (signal) => {
  await shutdownResources(signal);
  process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
