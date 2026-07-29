const MAX_SECRET_LENGTH = 200;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const USER_ID_RE = /^[1-9]\d{0,20}$/;
const DEFAULT_BOT_USERNAME = 'YourBot';

export const ParseError = {
  MISSING_ALL: 'missing_all',
  MISSING_TEXT: 'missing_text',
  TOO_LONG: 'too_long',
  INVALID_TARGET: 'invalid_target',
};

let botUsername = DEFAULT_BOT_USERNAME;

export function normalizeBotUsername(username) {
  if (!username || typeof username !== 'string') return null;
  const normalized = username.trim().replace(/^@+/, '');
  return USERNAME_RE.test(normalized) ? normalized : null;
}

export function setBotUsername(username) {
  botUsername = normalizeBotUsername(username) || DEFAULT_BOT_USERNAME;
  return botUsername;
}

export function parseInlineQuery(rawQuery = '', context = {}) {
  const query = rawQuery.trim();

  if (!query) {
    return { error: ParseError.MISSING_ALL };
  }

  const tokens = query.split(/\s+/);
  if (tokens.length < 2) {
    return { error: ParseError.MISSING_TEXT };
  }

  const idTarget = (id, raw) => {
    if (!USER_ID_RE.test(id)) return null;
    return {
      targetType: 'id',
      targetNormalized: id,
      targetId: id,
      targetLabel: `ID ${id}`,
      targetRaw: raw,
    };
  };

  const detectTarget = (token) => {
    if (!token) return null;

    const prefixed = /^id:(\d+)$/i.exec(token);
    if (prefixed) return idTarget(prefixed[1], token);

    if (/^\d+$/.test(token)) return idTarget(token, token);

    if (!token.startsWith('@')) return null;
    const usernameToken = token.slice(1);

    if (/^me$/i.test(usernameToken)) {
      return context.senderId === undefined || context.senderId === null
        ? null
        : idTarget(String(context.senderId), token);
    }
    if (/^\d+$/.test(usernameToken)) return idTarget(usernameToken, token);

    if (USERNAME_RE.test(usernameToken)) {
      return {
        targetType: 'username',
        targetNormalized: usernameToken.toLowerCase(),
        targetUsername: usernameToken,
        targetLabel: `@${usernameToken}`,
        targetRaw: token,
      };
    }
    return null;
  };

  const textTooLong = (text) =>
    text && text.length > MAX_SECRET_LENGTH
      ? { error: ParseError.TOO_LONG }
      : null;

  const targetFront = detectTarget(tokens[0]);
  if (targetFront) {
    const secretText = tokens.slice(1).join(' ').trim();
    if (!secretText) {
      return { error: ParseError.MISSING_TEXT };
    }
    const longErr = textTooLong(secretText);
    if (longErr) return longErr;
    return { ...targetFront, secretText, targetPosition: 'front' };
  }

  const targetBack = detectTarget(tokens[tokens.length - 1]);
  if (targetBack) {
    const secretText = tokens.slice(0, -1).join(' ').trim();
    if (!secretText) {
      return { error: ParseError.MISSING_TEXT };
    }
    const longErr = textTooLong(secretText);
    if (longErr) return longErr;
    return { ...targetBack, secretText, targetPosition: 'back' };
  }

  return { error: ParseError.INVALID_TARGET };
}

export const getBotUsername = () => botUsername;
export const maxSecretLength = MAX_SECRET_LENGTH;
