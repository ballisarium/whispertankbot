import { Markup } from 'telegraf';
import { detectLang, t } from '../helpers/i18n.js';
import { getUserLang, setUserLang, checkStartCooldown } from '../helpers/userSettings.js';
import { getBotUsername } from '../helpers/parseInlineQuery.js';
import { isValidDateString } from '../helpers/config.js';
import {
  deliveryScopeFor,
  scheduleDelivery,
  scheduleInteractive,
} from '../helpers/telegramScheduler.js';

const reply = (ctx, text, options) =>
  scheduleDelivery(
    deliveryScopeFor(ctx),
    () => ctx.reply(text, options),
    { method: 'sendMessage', updateId: ctx.update?.update_id }
  );

const editMessage = (ctx, text, options) =>
  scheduleDelivery(
    deliveryScopeFor(ctx),
    () => ctx.editMessageText(text, options),
    { method: 'editMessageText', updateId: ctx.update?.update_id }
  );

const answerCallback = (ctx, text, options) =>
  scheduleInteractive(
    () => ctx.answerCbQuery(text, options),
    { method: 'answerCbQuery', updateId: ctx.update?.update_id }
  );

function buildMainKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('changeLanguage', lang), 'menu:lang')],
  ]);
}

function buildLangKeyboard(lang) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇬🇧 english', 'lang:en'),
      Markup.button.callback('🇷🇺 русский', 'lang:ru'),
      Markup.button.callback('🇺🇦 українська', 'lang:uk'),
    ],
    [Markup.button.callback(t('back', lang), 'menu:back')],
  ]);
}

export async function handleStart(ctx) {
  const userId = ctx.from?.id;
  
  const cooldown = checkStartCooldown(userId);
  if (!cooldown.allowed) {
    const userLang = await getUserLang(userId) || detectLang(ctx.from?.language_code);
    await reply(ctx, t('startCooldown', userLang)(cooldown.retryAfter));
    return;
  }
  
  let lang = await getUserLang(userId);
  if (!lang) {
    lang = detectLang(ctx.from?.language_code);
    await setUserLang(userId, lang);
  }
  
  const botUsername = getBotUsername();
  const message = t('welcomeMessage', lang)(botUsername);
  
  await reply(ctx, message, {
    parse_mode: 'HTML',
    ...buildMainKeyboard(lang),
  });
}

export async function handleStatsCommand(ctx, isAdmin, buildReport) {
  const userLang = await getUserLang(ctx.from?.id) || detectLang(ctx.from?.language_code);
  if (!isAdmin) {
    await reply(ctx, t('statsAdminOnly', userLang));
    return;
  }
  const dateStr = ctx.message?.text?.split(' ')?.[1];
  if (dateStr && !isValidDateString(dateStr)) {
    await reply(ctx, t('statsUsage', userLang));
    return;
  }
  const report = await buildReport(dateStr, userLang);
  await reply(ctx, report, { parse_mode: 'HTML', disable_web_page_preview: true });
}

export async function handleLangCallback(ctx) {
  const lang = ctx.match?.[1];
  if (!lang || !['en', 'ru', 'uk'].includes(lang)) {
    await answerCallback(ctx, 'Invalid language', { show_alert: false });
    return;
  }

  const userId = ctx.from?.id;
  await setUserLang(userId, lang);

  const botUsername = getBotUsername();
  const message = t('welcomeMessage', lang)(botUsername);

  try {
    await editMessage(ctx, message, {
      parse_mode: 'HTML',
      ...buildMainKeyboard(lang),
    });
  } catch (err) {
    // message may be unchanged; still acknowledge the selection
  }
  await answerCallback(ctx, t('langChanged', lang), { show_alert: false });
}

export async function handleMenuCallback(ctx) {
  const action = ctx.match?.[1];
  const lang = await getUserLang(ctx.from?.id) || detectLang(ctx.from?.language_code);
  const botUsername = getBotUsername();

  const isLangMenu = action === 'lang';
  const message = isLangMenu ? t('chooseLanguage', lang) : t('welcomeMessage', lang)(botUsername);
  const keyboard = isLangMenu ? buildLangKeyboard(lang) : buildMainKeyboard(lang);

  try {
    await editMessage(ctx, message, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (err) {
    // ignore "message is not modified"
  }
  await answerCallback(ctx);
}
