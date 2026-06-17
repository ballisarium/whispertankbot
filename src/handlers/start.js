import { Markup } from 'telegraf';
import { detectLang, t } from '../helpers/i18n.js';
import { getUserLang, setUserLang, checkStartCooldown } from '../helpers/userSettings.js';
import { getBotUsername } from '../helpers/parseInlineQuery.js';
import { isValidDateString } from '../helpers/config.js';

function buildLangKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇬🇧 english', 'lang:en'),
      Markup.button.callback('🇷🇺 русский', 'lang:ru'),
      Markup.button.callback('🇺🇦 українська', 'lang:uk'),
    ],
  ]);
}

export async function handleStart(ctx) {
  const userId = ctx.from?.id;
  
  const cooldown = checkStartCooldown(userId);
  if (!cooldown.allowed) {
    const userLang = await getUserLang(userId) || detectLang(ctx.from?.language_code);
    await ctx.reply(t('startCooldown', userLang)(cooldown.retryAfter));
    return;
  }
  
  let lang = await getUserLang(userId);
  if (!lang) {
    lang = detectLang(ctx.from?.language_code);
    await setUserLang(userId, lang);
  }
  
  const botUsername = getBotUsername();
  const message = t('welcomeMessage', lang)(botUsername);
  
  await ctx.reply(message, {
    parse_mode: 'HTML',
    ...buildLangKeyboard(),
  });
}

export async function handleStatsCommand(ctx, isAdmin, buildReport) {
  if (!isAdmin) {
    await ctx.reply('for admins only');
    return;
  }
  const dateStr = ctx.message?.text?.split(' ')?.[1];
  if (dateStr && !isValidDateString(dateStr)) {
    const userLang = await getUserLang(ctx.from?.id) || detectLang(ctx.from?.language_code);
    await ctx.reply(t('statsUsage', userLang));
    return;
  }
  const report = await buildReport(dateStr);
  await ctx.reply(report, { parse_mode: 'HTML', disable_web_page_preview: true });
}

export async function handleLangCallback(ctx) {
  const lang = ctx.match?.[1];
  if (!lang || !['en', 'ru', 'uk'].includes(lang)) {
    await ctx.answerCbQuery('Invalid language', { show_alert: false });
    return;
  }
  
  const userId = ctx.from?.id;
  await setUserLang(userId, lang);
  
  const botUsername = getBotUsername();
  const message = t('welcomeMessage', lang)(botUsername);
  
  try {
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...buildLangKeyboard(),
    });
    await ctx.answerCbQuery(t('langChanged', lang), { show_alert: false });
  } catch (err) {
    await ctx.answerCbQuery(t('langChanged', lang), { show_alert: false });
  }
}
