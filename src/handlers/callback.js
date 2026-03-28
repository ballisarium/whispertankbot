import { Markup } from 'telegraf';
import { getSecret, markConsumed, persistResolvedTargetId } from '../helpers/secrets.js';
import { t, DEFAULT_LANG } from '../helpers/i18n.js';
import { trackRead } from '../helpers/stats.js';

const MAX_ALERT_LENGTH = 190;

export const AccessRole = {
  NONE: 'none',
  BLOCKED: 'blocked',
  AUTHOR: 'author',
  TARGET: 'target',
  ALLOWED_EXCLUDE: 'allowed_exclude',
};

async function resolveTargetIdForUsername(ctx, username) {
  if (!username) return null;
  try {
    const chat = await ctx.telegram.getChat(`@${username}`);
    if (chat && chat.type === 'private') {
      return chat.id;
    }
  } catch (err) {
    console.warn('Could not resolve username to ID during read:', username, err?.message || err);
  }
  return null;
}

function getAccessRole(secret, from) {
  if (!from) return AccessRole.NONE;
  const isAuthor = secret.authorId && Number(from.id) === Number(secret.authorId);

  let isTarget = false;
  if (secret.targetType === 'id') {
    // Direct ID target - check by ID only
    isTarget = Number(from.id) === Number(secret.targetNormalized);
  } else {
    // Username target - check by resolved ID (priority) or username (fallback)
    if (secret.resolvedTargetId) {
      // If ID was resolved at creation time - check by ID
      isTarget = Number(from.id) === Number(secret.resolvedTargetId);
    } else {
      // Fallback: check by current username
      isTarget = from.username &&
        from.username.toLowerCase() === secret.targetNormalized;
    }
  }

  const isExcludeMode = secret.targetPosition === 'back';
  if (isExcludeMode) {
    if (isTarget) return AccessRole.BLOCKED;
    if (isAuthor) return AccessRole.AUTHOR;
    return AccessRole.ALLOWED_EXCLUDE;
  }

  if (isTarget) return AccessRole.TARGET;
  if (isAuthor) return AccessRole.AUTHOR;
  return AccessRole.BLOCKED;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleReadCallback(ctx) {
  const secretId = ctx.match?.[1];
  
  if (!secretId || !UUID_REGEX.test(secretId)) {
    await ctx.answerCbQuery(t('secretNotFound', DEFAULT_LANG), { show_alert: false });
    return;
  }
  
  const secret = await getSecret(secretId);
  const lang = secret?.lang || DEFAULT_LANG;

  if (!secret) {
    await trackRead({ outcome: 'expired' });
    await ctx.answerCbQuery(t('secretNotFound', DEFAULT_LANG), { show_alert: false });
    return;
  }

  if (secret.targetType === 'username' && !secret.resolvedTargetId) {
    const fromUsername = ctx.from?.username?.toLowerCase();
    if (!fromUsername || fromUsername !== secret.targetNormalized) {
      const resolvedTargetId = await resolveTargetIdForUsername(ctx, secret.targetNormalized);
      if (resolvedTargetId) {
        secret.resolvedTargetId = resolvedTargetId;
        await persistResolvedTargetId(secretId, secret, resolvedTargetId);
      }
    }
  }

  const role = getAccessRole(secret, ctx.from);
  const isExcludeMode = secret.targetPosition === 'back';
  
  if (role === AccessRole.BLOCKED) {
    await trackRead({ outcome: 'blocked' });
    const message = isExcludeMode ? t('secretExcludesYou', lang) : t('secretNotForYou', lang);
    await ctx.answerCbQuery(message, { show_alert: false });
    return;
  }

  if (role === AccessRole.NONE) {
    await ctx.answerCbQuery(t('unableToVerify', lang), { show_alert: false });
    return;
  }

  let delivered = false;
  if (secret.secretText.length <= MAX_ALERT_LENGTH) {
    await ctx.answerCbQuery(secret.secretText, { show_alert: true });
    delivered = true;
  } else {
    try {
      await ctx.telegram.sendMessage(ctx.from.id, secret.secretText, {
        disable_notification: true,
        protect_content: true,
      });
      await ctx.answerCbQuery(t('secretSentDM', lang), { show_alert: true });
      delivered = true;
    } catch (err) {
      console.warn('Failed to DM secret; showing truncated text instead', err);
      const trimmed = `${secret.secretText.slice(0, MAX_ALERT_LENGTH - 3)}...`;
      await ctx.answerCbQuery(trimmed, { show_alert: true });
      delivered = true;
    }
  }

  if (!isExcludeMode && role === AccessRole.TARGET && delivered) {
    await trackRead({ outcome: 'delivered' });
    await markConsumed(secretId);
    try {
      await ctx.editMessageText(t('secretAlreadyRead', lang), {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([]).reply_markup,
      });
    } catch (err) {
      console.warn('Failed to edit message', err);
    }
    return;
  }

  if (delivered) {
    await trackRead({ outcome: 'delivered' });
  }
}
