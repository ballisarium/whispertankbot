import { Markup } from 'telegraf';
import { createSecret } from '../helpers/secrets.js';
import { parseInlineQuery, getBotUsername, ParseError } from '../helpers/parseInlineQuery.js';
import { checkDraftRateLimit, RateLimitResult } from '../helpers/rateLimit.js';
import { detectLang, t } from '../helpers/i18n.js';
import { getUserLang } from '../helpers/userSettings.js';
import { trackError, trackMessage } from '../helpers/stats.js';
import { escapeHtml } from '../helpers/html.js';
import { getSafeErrorLogContext } from '../helpers/errorLog.js';
import {
  getProfile,
  learnUser,
  resolveUsername,
} from '../helpers/userDirectory.js';
import {
  getTelegramErrorLogContext,
  scheduleInteractive,
  scheduleLookup,
} from '../helpers/telegramScheduler.js';

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
    let profile = await getProfile(parsed.targetId);
    if (!profile) {
      const chat = await scheduleLookup(
        `user:${parsed.targetId}`,
        () => ctx.telegram.getChat(parsed.targetId),
        { method: 'getChat', updateId: ctx.update?.update_id }
      );
      if (
        !chat
        || chat.type !== 'private'
        || String(chat.id) !== String(parsed.targetId)
      ) {
        return { titleLabel, messageLabel };
      }
      profile = {
        id: String(chat.id),
        firstName: chat.first_name || '',
        lastName: chat.last_name || '',
        username: chat.username || null,
      };
      await learnUser({
        ...chat,
        active_usernames: Array.isArray(chat.active_usernames)
          ? chat.active_usernames
          : [],
      });
    }

    if (profile) {
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

      if (profile.username) {
        // Приоритет 1: Name (@username)
        const safeUsername = escapeHtml(profile.username);
        const displayPart = fullName ? `${escapeHtml(fullName)} (@${safeUsername})` : `@${safeUsername}`;
        titleLabel = fullName ? `${fullName} (@${profile.username})` : `@${profile.username}`;
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
    console.warn(
      'Failed to resolve Telegram profile',
      getTelegramErrorLogContext(err, ctx.update?.update_id)
    );
  }

  return { titleLabel, messageLabel };
}

const answerInline = (ctx, results, options) =>
  scheduleInteractive(
    () => ctx.answerInlineQuery(results, options),
    { method: 'answerInlineQuery', updateId: ctx.update?.update_id }
  );

const answerSingleResult = (ctx, result) =>
  answerInline(ctx, [result], { is_personal: true, cache_time: 0 });

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
    resolvedTargetId = await resolveUsername(parsed.targetUsername);

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

  const rateCheck = await checkDraftRateLimit({
    userId: authorId,
    targetKey: `${parsed.targetPosition}:${parsed.targetType}:${parsed.targetNormalized}`,
    secretText: parsed.secretText,
  });
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

  const { titleLabel, messageLabel } = await resolveTargetLabels(ctx, parsed, lang);

  let secretId;
  try {
    secretId = await createSecret({ ...parsed, chatType, authorId, lang, targetLabel: titleLabel, resolvedTargetId });
  } catch (err) {
    console.error(
      'Failed to create secret',
      getSafeErrorLogContext(err, {
        kind: 'storage',
        operation: 'secret_create',
        updateId: ctx.update?.update_id,
      })
    );
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

  await answerInline(ctx, results, { is_personal: true, cache_time: 0 });
}
