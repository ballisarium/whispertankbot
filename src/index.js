import 'dotenv/config';
import { Bot } from 'grammy';
import { createBatchSink, createRunner, createSource, createUpdateFetcher } from '@grammyjs/runner';
import { handleInlineQuery } from './handlers/inline.js';
import { handleReadCallback } from './handlers/callback.js';
import { handleStart, handleLangCallback, handleMenuCallback, handleStatsCommand } from './handlers/start.js';
import { getBotUsername, normalizeBotUsername, setBotUsername } from './helpers/parseInlineQuery.js';
import { shutdown as shutdownSecrets } from './helpers/secrets.js';
import { shutdownRateLimit } from './helpers/rateLimit.js';
import { shutdownUserSettings } from './helpers/userSettings.js';
import { buildDailyReport, getStatsTimezone, setStatsEnabled, setStatsTimezone, sendDailyReport } from './helpers/stats.js';
import { getDateWithDayOffset, getNextRunDelayMs, parseAdminIds } from './helpers/config.js';
import { getSafeErrorLogContext } from './helpers/errorLog.js';
import { observeMentionedUser, observeTelegramUser } from './helpers/observeUser.js';
import { shutdownUserDirectory } from './helpers/userDirectory.js';
import {
  getTelegramErrorLogContext,
  shutdownTelegramScheduler,
} from './helpers/telegramScheduler.js';

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

const bot = new Bot(BOT_TOKEN);

const handleBotError = ({ error, ctx }) => {
  console.error(
    'Bot error',
    getTelegramErrorLogContext(error, ctx?.update?.update_id)
  );
};
bot.catch(handleBotError);

bot.use(async (ctx, next) => {
  await observeTelegramUser(
    ctx.from,
    ctx.api,
    ctx.update?.update_id
  );
  await observeMentionedUser(ctx.message?.reply_to_message?.from);
  return next();
});

bot.command('start', handleStart);
bot.callbackQuery(/^lang:(.+)$/, handleLangCallback);
bot.callbackQuery(/^menu:(.+)$/, handleMenuCallback);
bot.on('inline_query', handleInlineQuery);
bot.callbackQuery(/^read:(.+)$/, handleReadCallback);
bot.command('stats', async (ctx) => {
  const userId = ctx.from?.id;
  const isAdmin = userId && ADMIN_IDS.includes(String(userId));
  await handleStatsCommand(ctx, isAdmin, buildDailyReport);
});

let statsTimer = null;
let runner = null;
let nextUpdateOffset = 0;
let skipOffsetSync = false;
let shutdownPromise = null;
let shuttingDown = false;
const startupAbortController = new AbortController();

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
      console.error(
        'Failed to send daily report',
        getSafeErrorLogContext(err, { kind: 'transport', operation: 'daily_report' })
      );
    }

    if (shuttingDown) return;
    const nextDelay = getNextRunDelayMs(timezone, STATS_SEND_AT);
    statsTimer = setTimeout(run, nextDelay);
    if (statsTimer.unref) statsTimer.unref();
  }, initialDelay);
  if (statsTimer.unref) statsTimer.unref();
}

const shutdownResources = (signal) => {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  startupAbortController.abort();

  shutdownPromise = (async () => {
    console.log(`Received ${signal}, shutting down...`);
    const stopped = runner?.stop();
    if (statsTimer) {
      clearTimeout(statsTimer);
      statsTimer = null;
    }

    // Keep the existing five-second grace period even if middleware hangs.
    let drained = !stopped;
    const drain = Promise.resolve(stopped).then(
      () => { drained = true; },
      () => { drained = true; }
    );
    let drainTimer;
    await Promise.all([
      shutdownTelegramScheduler(),
      Promise.race([
        drain,
        new Promise((resolve) => { drainTimer = setTimeout(resolve, 5000); }),
      ]),
    ]);
    clearTimeout(drainTimer);

    // Telegraf confirmed the last fetched offset after draining its batch.
    // Runner leaves this to its caller. Never confirm an unfinished batch.
    if (runner && drained && !skipOffsetSync) {
      try {
        await bot.api.getUpdates(
          { offset: nextUpdateOffset, limit: 1 },
          AbortSignal.timeout(3000)
        );
      } catch (err) {
        console.warn(
          'Failed to confirm update offset',
          getSafeErrorLogContext(err, { kind: 'transport', operation: 'polling_offset' })
        );
      }
    }

    shutdownUserDirectory();
    await shutdownSecrets();
    shutdownRateLimit();
    shutdownUserSettings();
  })();
  return shutdownPromise;
};

async function main() {
  try {
    await bot.init(startupAbortController.signal);
    if (shuttingDown) return;
    await bot.api.deleteWebhook({}, startupAbortController.signal);
    if (shuttingDown) return;

    const fetchUpdates = createUpdateFetcher(bot, {
      fetch: { timeout: 50 },
      retryInterval: 5000,
      maxRetryTime: Infinity,
      silent: true,
    });
    const source = createSource({
      supply: async (batchSize, signal) => {
        const updates = await fetchUpdates(batchSize, signal);
        const last = updates[updates.length - 1];
        if (last) nextUpdateOffset = last.update_id + 1;
        return updates;
      },
    });
    // Match Telegraf: parallel work within a batch, then fetch the next batch.
    const sink = createBatchSink(
      { consume: (update) => bot.handleUpdate(update) },
      handleBotError
    );
    runner = createRunner(source, sink);
    runner.start();
    const pollingTask = runner.task();

    console.log(`Bot @${getBotUsername()} started successfully`);
    startStatsScheduler().catch((err) => {
      console.error(
        'Failed to start stats scheduler',
        getSafeErrorLogContext(err, { operation: 'stats_scheduler' })
      );
    });
    await pollingTask;
  } catch (err) {
    if (shuttingDown) return;
    skipOffsetSync = err?.error_code === 401 || err?.error_code === 409;
    console.error(
      'Failed to launch bot',
      getSafeErrorLogContext(err, { kind: 'transport', operation: 'bot_launch' })
    );
    await shutdownResources('launch_error');
    process.exit(1);
  }
}

const gracefulShutdown = async (signal) => {
  try {
    await shutdownResources(signal);
    process.exit(0);
  } catch (err) {
    console.error(
      'Failed to shut down bot',
      getSafeErrorLogContext(err, { operation: 'bot_shutdown' })
    );
    process.exit(1);
  }
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

main();
