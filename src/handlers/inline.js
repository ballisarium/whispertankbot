import { Markup } from 'telegraf';
import { createSecret } from '../helpers/secrets.js';
import { parseInlineQuery, getBotUsername, ParseError } from '../helpers/parseInlineQuery.js';
import { checkRateLimit, RateLimitResult } from '../helpers/rateLimit.js';
import { detectLang, t } from '../helpers/i18n.js';
import { getUserLang } from '../helpers/userSettings.js';
import { trackError, trackMessage } from '../helpers/stats.js';
import { escapeHtml } from '../helpers/html.js';

function buildInlineKeyboard(secretId, lang) {
  return Markup.inlineKeyboard([[Markup.button.callback(t('readButton', lang), `read:${secretId}`)]])
    .reply_markup;
}

const stripTgEmoji = (text = '') =>
  text.replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, '$1');

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

const answerSingleResult = (ctx, result) =>
  ctx.answerInlineQuery([result], { is_personal: true, cache_time: 0 });

function buildMessageResult({ id, title, description, messageText, replyMarkup }) {
  return {
    type: 'article',
    id,
    title,
    description: stripTgEmoji(description),
    input_message_content: {
      message_text: messageText,
      parse_mode: 'HTML',
    },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };
}

export async function handleInlineQuery(ctx) {
  const { inlineQuery } = ctx;
  const chatType = inlineQuery?.chat_type;
  const authorId = inlineQuery?.from?.id;
  const savedLang = await getUserLang(authorId);
  const lang = savedLang || detectLang(inlineQuery?.from?.language_code);
  const botUsername = getBotUsername();

  const rateCheck = await checkRateLimit(authorId, true);
  if (rateCheck.result === RateLimitResult.BLOCKED) {
    await trackError({ type: 'rate_limit' });
    await answerSingleResult(ctx, {
      type: 'article',
      id: 'rate_limited',
      title: t('rateLimitTitle', lang),
      description: t('rateLimitDescription', lang)(rateCheck.retryAfter),
      input_message_content: {
        message_text: t('rateLimitMessage', lang)(rateCheck.retryAfter),
      },
    });
    return;
  }

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
    await answerSingleResult(ctx, {
        type: 'article',
        id: 'usage',
        title,
        description: stripTgEmoji(hint),
        input_message_content: {
          message_text: hint,
          parse_mode: 'HTML',
        },
    });
    return;
  }

  let resolvedTargetId = null;
  if (parsed.targetType === 'username') {
    try {
      const chat = await ctx.telegram.getChat(`@${parsed.targetUsername}`);
      if (chat && chat.type === 'private') {
        resolvedTargetId = chat.id;
      }
    } catch (err) {
      console.warn('Could not resolve username to ID:', parsed.targetUsername, err?.message || err);
    }

    if (!resolvedTargetId) {
      await trackError({ type: 'target_resolve' });
      const safeTarget = `@${escapeHtml(parsed.targetUsername)}`;
      await answerSingleResult(ctx, buildMessageResult({
        id: 'target_unavailable',
        title: t('targetUnavailableTitle', lang),
        description: t('targetUnavailableHint', lang)(safeTarget),
        messageText: t('targetUnavailableHint', lang)(safeTarget),
      }));
      return;
    }
  }

  const { titleLabel, messageLabel } = await resolveTargetLabels(ctx, parsed, lang);

  let secretId;
  try {
    secretId = await createSecret({ ...parsed, chatType, authorId, lang, targetLabel: titleLabel, resolvedTargetId });
  } catch (err) {
    console.error('Failed to create secret', err);
    await trackError({ type: 'storage' });
    await answerSingleResult(ctx, buildMessageResult({
      id: 'storage_unavailable',
      title: t('storageUnavailableTitle', lang),
      description: t('storageUnavailableHint', lang),
      messageText: t('storageUnavailableHint', lang),
    }));
    return;
  }

  await trackMessage({
    authorId,
    targetNormalized: parsed.targetNormalized,
    targetPosition: parsed.targetPosition,
    secretTextLength: parsed.secretText.length,
    chatType,
  });

  const isExcludeMode = parsed.targetPosition === 'back';
  const messageText = isExcludeMode
    ? t('secretMessageExcept', lang)(messageLabel)
    : t('secretMessageFor', lang)(messageLabel);
  const description = isExcludeMode
    ? t('inlineDescriptionExcept', lang)(titleLabel)
    : t('inlineDescriptionFor', lang)(titleLabel);

  const results = [
    {
      type: 'article',
      id: secretId,
      title: isExcludeMode 
        ? t('hiddenFrom', lang)(titleLabel) 
        : t('whisperTo', lang)(titleLabel),
      description,
      input_message_content: {
        message_text: messageText,
        parse_mode: 'HTML',
      },
      reply_markup: buildInlineKeyboard(secretId, lang),
    },
  ];

  await ctx.answerInlineQuery(results, { is_personal: true, cache_time: 0 });
}
