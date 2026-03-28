import { Markup } from 'telegraf';
import { createSecret } from '../helpers/secrets.js';
import { parseInlineQuery, getBotUsername, ParseError } from '../helpers/parseInlineQuery.js';
import { checkRateLimit, RateLimitResult } from '../helpers/rateLimit.js';
import { detectLang, t } from '../helpers/i18n.js';
import { getUserLang } from '../helpers/userSettings.js';
import { trackError, trackMessage } from '../helpers/stats.js';

function buildInlineKeyboard(secretId, lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t('readButton', lang), `read:${secretId}`)]])
    .reply_markup;
}

const escapeHtml = (text = '') =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripTgEmoji = (text = '') =>
  text.replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, '$1');

const getDisplayName = (chat) => {
  if (!chat || chat.type !== 'private') return null;
  const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (chat.username) return `@${chat.username}`;
  return null;
};

async function resolveTargetLabels(ctx, parsed, lang) {
  if (parsed.targetType === 'username') {
    const safeUsername = escapeHtml(parsed.targetUsername);
    return {
      titleLabel: parsed.targetLabel,
      messageLabel: `@${safeUsername}`,
    };
  }

  const safeId = escapeHtml(parsed.targetId);
  let titleLabel = t('userWithIdTitle', lang)(parsed.targetId);
  let messageLabel = t('userWithIdMessage', lang)(safeId);

  try {
    const chat = await ctx.telegram.getChat(parsed.targetId);
    if (chat && chat.type === 'private') {
      const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim();

      if (chat.username) {
        // Приоритет 1: Name (@username)
        const safeUsername = escapeHtml(chat.username);
        const displayPart = fullName ? `${escapeHtml(fullName)} (@${safeUsername})` : `@${safeUsername}`;
        titleLabel = fullName ? `${fullName} (@${chat.username})` : `@${chat.username}`;
        messageLabel = displayPart;
      } else if (fullName) {
        // Приоритет 2: Name (ID X)
        const safeName = escapeHtml(fullName);
        titleLabel = `${fullName} (ID ${parsed.targetId})`;
        messageLabel = `${safeName} (ID <code>${safeId}</code>)`;
      }
      // Если нет ни username ни имени - оставляем дефолтные значения (ID X)
    }
  } catch (err) {
    console.warn('Failed to resolve user name for ID', parsed.targetId, err?.message || err);
  }

  return { titleLabel, messageLabel };
}

export async function handleInlineQuery(ctx) {
  const { inlineQuery } = ctx;
  const chatType = inlineQuery?.chat_type;
  const authorId = inlineQuery?.from?.id;
  const savedLang = await getUserLang(authorId);
  const lang = savedLang || detectLang(inlineQuery?.from?.language_code);
  const botUsername = getBotUsername();
  const parsed = parseInlineQuery(inlineQuery?.query || '');

  if (parsed.error) {
    await trackError({ type: 'parse' });
    let title, hint;
    if (parsed.error === ParseError.TOO_LONG) {
      title = t('tooLongTitle', lang);
      hint = t('tooLongHint', lang);
    } else if (parsed.error === ParseError.INVALID_TARGET) {
      title = t('usageTitle', lang);
      hint = t('invalidTargetHint', lang)(botUsername);
    } else {
      title = t('usageTitle', lang);
      hint = t('usageHint', lang)(botUsername);
    }
    const results = [
      {
        type: 'article',
        id: 'usage',
        title,
        description: stripTgEmoji(hint),
        input_message_content: {
          message_text: hint,
          parse_mode: 'HTML',
        },
      },
    ];
    await ctx.answerInlineQuery(results, { is_personal: true, cache_time: 0 });
    return;
  }

  const rateCheck = checkRateLimit(authorId, false);
  if (rateCheck.result === RateLimitResult.BLOCKED) {
    await trackError({ type: 'rate_limit' });
    const results = [
      {
        type: 'article',
        id: 'rate_limited',
        title: t('rateLimitTitle', lang),
        description: t('rateLimitDescription', lang)(rateCheck.retryAfter),
        input_message_content: {
          message_text: t('rateLimitMessage', lang)(rateCheck.retryAfter),
        },
      },
    ];
    await ctx.answerInlineQuery(results, { is_personal: true, cache_time: 0 });
    return;
  }

  checkRateLimit(authorId, true);
  const { titleLabel, messageLabel } = await resolveTargetLabels(ctx, parsed, lang);

  // Try to resolve username to ID for reliable matching across multiple usernames
  let resolvedTargetId = null;
  if (parsed.targetType === 'username') {
    try {
      const chat = await ctx.telegram.getChat(`@${parsed.targetUsername}`);
      if (chat && chat.type === 'private') {
        resolvedTargetId = chat.id;
      }
    } catch (err) {
      // Could not resolve - user is unknown to the bot, continue without ID
      console.warn('Could not resolve username to ID:', parsed.targetUsername);
    }
  }

  const secretId = await createSecret({ ...parsed, chatType, authorId, lang, targetLabel: titleLabel, resolvedTargetId });
  await trackMessage({
    authorId,
    targetNormalized: parsed.targetNormalized,
    targetPosition: parsed.targetPosition,
    secretTextLength: parsed.secretText.length,
    chatType,
  });

  const preview =
    parsed.secretText.length > 80
      ? `${parsed.secretText.slice(0, 77)}...`
      : parsed.secretText;

  const isExcludeMode = parsed.targetPosition === 'back';
  const messageText = isExcludeMode
    ? t('secretMessageExcept', lang)(messageLabel)
    : t('secretMessageFor', lang)(messageLabel);

  const results = [
    {
      type: 'article',
      id: secretId,
      title: isExcludeMode 
        ? t('hiddenFrom', lang)(titleLabel) 
        : t('whisperTo', lang)(titleLabel),
      description: preview,
      input_message_content: {
        message_text: messageText,
        parse_mode: 'HTML',
      },
      reply_markup: buildInlineKeyboard(secretId, lang),
    },
  ];

  await ctx.answerInlineQuery(results, { is_personal: true, cache_time: 0 });
}
