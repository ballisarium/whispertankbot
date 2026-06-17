import { Markup } from 'telegraf';
import { consumeSecret, getSecret, restoreSecret } from '../helpers/secrets.js';
import { t, DEFAULT_LANG } from '../helpers/i18n.js';
import { trackRead } from '../helpers/stats.js';
import { maxSecretLength } from '../helpers/parseInlineQuery.js';

const MAX_ALERT_LENGTH = maxSecretLength;

export const AccessRole = {
  NONE: 'none',
  BLOCKED: 'blocked',
  AUTHOR: 'author',
  TARGET: 'target',
  ALLOWED_EXCLUDE: 'allowed_exclude',
};

function getAccessRole(secret, from) {
  if (!from) return AccessRole.NONE;
  const isAuthor = secret.authorId && Number(from.id) === Number(secret.authorId);

  let isTarget = false;
  if (secret.targetType === 'id') {
    isTarget = String(from.id) === String(secret.targetNormalized);
  } else {
    if (secret.resolvedTargetId) {
      isTarget = Number(from.id) === Number(secret.resolvedTargetId);
    } else {
      return isAuthor ? AccessRole.AUTHOR : AccessRole.NONE;
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

async function deliverSecret(ctx, secret, lang) {
  if (secret.secretText.length <= MAX_ALERT_LENGTH) {
    await ctx.answerCbQuery(secret.secretText, { show_alert: true });
    return true;
  }

  try {
    await ctx.telegram.sendMessage(ctx.from.id, secret.secretText, {
      disable_notification: true,
      protect_content: true,
    });
    await ctx.answerCbQuery(t('secretSentDM', lang), { show_alert: true });
    return true;
  } catch (err) {
    console.warn('Failed to DM secret', err?.message || err);
    await ctx.answerCbQuery(t('secretDeliveryFailed', lang), { show_alert: true });
    return false;
  }
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

  if (!isExcludeMode && role === AccessRole.TARGET) {
    const consumed = await consumeSecret(secretId);
    if (!consumed) {
      await trackRead({ outcome: 'expired' });
      await ctx.answerCbQuery(t('secretNotFound', lang), { show_alert: false });
      return;
    }

    const consumedSecret = consumed.secret;
    const consumedRole = getAccessRole(consumedSecret, ctx.from);
    if (consumedRole !== AccessRole.TARGET) {
      await restoreSecret(secretId, consumedSecret, consumed.ttlMs);
      await trackRead({ outcome: 'blocked' });
      await ctx.answerCbQuery(t('secretNotForYou', lang), { show_alert: false });
      return;
    }

    const delivered = await deliverSecret(ctx, consumedSecret, lang);
    if (!delivered) {
      await restoreSecret(secretId, consumedSecret, consumed.ttlMs);
      return;
    }

    await trackRead({ outcome: 'delivered' });
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

  const delivered = await deliverSecret(ctx, secret, lang);
  if (delivered) {
    await trackRead({ outcome: 'delivered' });
  }
}
