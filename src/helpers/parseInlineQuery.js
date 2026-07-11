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

const getBaseUsage = () => `@${botUsername} @username|ID text`;

export function parseInlineQuery(rawQuery = '') {
  const query = rawQuery.trim();
  const baseUsage = getBaseUsage();
  
  if (!query) {
    return { error: ParseError.MISSING_ALL, hint: baseUsage };
  }

  const tokens = query.split(/\s+/);
  if (tokens.length < 2) {
    return { error: ParseError.MISSING_TEXT, hint: baseUsage };
  }

  const detectTarget = (token) => {
    if (!token) return null;
    if (/^\d+$/.test(token) && !USER_ID_RE.test(token)) {
      return null;
    }
    if (USER_ID_RE.test(token)) {
      return {
        targetType: 'id',
        targetNormalized: token,
        targetId: token,
        targetLabel: `ID ${token}`,
        targetRaw: token,
      };
    }
    if (!token.startsWith('@')) return null;
    const usernameToken = token.slice(1);
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
      ? { error: ParseError.TOO_LONG, hint: `Secret is too long. Max ${MAX_SECRET_LENGTH} characters.` }
      : null;

  const targetFront = detectTarget(tokens[0]);
  if (targetFront) {
    const secretText = tokens.slice(1).join(' ').trim();
    if (!secretText) {
      return { error: ParseError.MISSING_TEXT, hint: baseUsage };
    }
    const longErr = textTooLong(secretText);
    if (longErr) return longErr;
    return { ...targetFront, secretText, targetPosition: 'front' };
  }

  const targetBack = detectTarget(tokens[tokens.length - 1]);
  if (targetBack) {
    const secretText = tokens.slice(0, -1).join(' ').trim();
    if (!secretText) {
      return { error: ParseError.MISSING_TEXT, hint: baseUsage };
    }
    const longErr = textTooLong(secretText);
    if (longErr) return longErr;
    return { ...targetBack, secretText, targetPosition: 'back' };
  }

  return {
    error: ParseError.INVALID_TARGET,
    hint: `Use a numeric ID or @username, e.g. ${baseUsage}`,
  };
}

export const getBotUsername = () => botUsername;
export const maxSecretLength = MAX_SECRET_LENGTH;
