import { Markup } from 'telegraf';
import { consumeSecret, getSecret, restoreSecret } from '../helpers/secrets.js';
import { t, DEFAULT_LANG } from '../helpers/i18n.js';
import { trackRead } from '../helpers/stats.js';
import { maxSecretLength } from '../helpers/parseInlineQuery.js';
import {
  deliveryScopeFor,
  getTelegramErrorLogContext,
  scheduleDelivery,
  scheduleInteractive,
} from '../helpers/telegramScheduler.js';

const MAX_ALERT_LENGTH = maxSecretLength;

export const AccessRole = {
  NONE: 'none',
  BLOCKED: 'blocked',
  AUTHOR: 'author',
  TARGET: 'target',
  ALLOWED_EXCLUDE: 'allowed_exclude',
};

const answerCallback = (ctx, text, options) =>
  scheduleInteractive(
    () => ctx.answerCbQuery(text, options),
    { method: 'answerCbQuery', updateId: ctx.update?.update_id }
  );

const editCallbackMessage = (ctx, text, options) =>
  scheduleDelivery(
    deliveryScopeFor(ctx),
    () => ctx.editMessageText(text, options),
    { method: 'editMessageText', updateId: ctx.update?.update_id }
  );

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
    try {
      await answerCallback(ctx, secret.secretText, { show_alert: true });
      return { delivered: true };
    } catch (error) {
      console.warn(
        'Failed to answer secret callback',
        getTelegramErrorLogContext(error, ctx.update?.update_id)
      );
      return { delivered: false, outcome: error?.kind || 'ambiguous' };
    }
  }

  try {
    await scheduleDelivery(
      `user:${ctx.from.id}`,
      () => ctx.telegram.sendMessage(ctx.from.id, secret.secretText, {
        disable_notification: true,
        protect_content: true,
      }),
      { method: 'sendMessage', updateId: ctx.update?.update_id }
    );
  } catch (error) {
    console.warn(
      'Failed to DM secret',
      getTelegramErrorLogContext(error, ctx.update?.update_id)
    );
    try {
      await answerCallback(ctx, t('secretDeliveryFailed', lang), { show_alert: true });
    } catch (notificationError) {
      console.warn(
        'Failed to report secret delivery error',
        getTelegramErrorLogContext(notificationError, ctx.update?.update_id)
      );
    }
    return { delivered: false, outcome: error?.kind || 'ambiguous' };
  }

  try {
    await answerCallback(ctx, t('secretSentDM', lang), { show_alert: true });
  } catch (error) {
    console.warn(
      'Failed to confirm secret delivery',
      getTelegramErrorLogContext(error, ctx.update?.update_id)
    );
  }
  return { delivered: true };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESTORABLE_DELIVERY_OUTCOMES = new Set([
  'overloaded',
  'permanent',
  'rejected',
  'shutdown',
]);

export async function handleReadCallback(ctx) {
  const secretId = ctx.match?.[1];
  
  if (!secretId || !UUID_REGEX.test(secretId)) {
    await answerCallback(ctx, t('secretNotFound', DEFAULT_LANG), { show_alert: false });
    return;
  }
  
  const secret = await getSecret(secretId);
  const lang = secret?.lang || DEFAULT_LANG;

  if (!secret) {
    await trackRead({ outcome: 'expired' });
    await answerCallback(ctx, t('secretNotFound', DEFAULT_LANG), { show_alert: false });
    return;
  }

  const role = getAccessRole(secret, ctx.from);
  const isExcludeMode = secret.targetPosition === 'back';
  
  if (role === AccessRole.BLOCKED) {
    await trackRead({ outcome: 'blocked' });
    const message = isExcludeMode ? t('secretExcludesYou', lang) : t('secretNotForYou', lang);
    await answerCallback(ctx, message, { show_alert: false });
    return;
  }

  if (role === AccessRole.NONE) {
    await answerCallback(ctx, t('unableToVerify', lang), { show_alert: false });
    return;
  }

  if (!isExcludeMode && role === AccessRole.TARGET) {
    const consumed = await consumeSecret(secretId);
    if (!consumed) {
      await trackRead({ outcome: 'expired' });
      await answerCallback(ctx, t('secretNotFound', lang), { show_alert: false });
      return;
    }

    const consumedSecret = consumed.secret;
    const consumedRole = getAccessRole(consumedSecret, ctx.from);
    if (consumedRole !== AccessRole.TARGET) {
      await restoreSecret(secretId, consumedSecret, consumed.ttlMs);
      await trackRead({ outcome: 'blocked' });
      await answerCallback(ctx, t('secretNotForYou', lang), { show_alert: false });
      return;
    }

    const delivery = await deliverSecret(ctx, consumedSecret, lang);
    if (!delivery.delivered) {
      if (RESTORABLE_DELIVERY_OUTCOMES.has(delivery.outcome)) {
        await restoreSecret(secretId, consumedSecret, consumed.ttlMs);
      }
      return;
    }

    await trackRead({ outcome: 'delivered' });
    try {
      await editCallbackMessage(ctx, t('secretAlreadyRead', lang), {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([]).reply_markup,
      });
    } catch (err) {
      console.warn('Failed to edit message', err);
    }
    return;
  }

  const delivery = await deliverSecret(ctx, secret, lang);
  if (delivery.delivered) {
    await trackRead({ outcome: 'delivered' });
  }
}
