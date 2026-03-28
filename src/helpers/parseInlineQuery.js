const MAX_SECRET_LENGTH = 200;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export const ParseError = {
  MISSING_ALL: 'missing_all',
  MISSING_TEXT: 'missing_text',
  TOO_LONG: 'too_long',
  INVALID_TARGET: 'invalid_target',
};

let botUsername = 'YourBot';

export function setBotUsername(username) {
  botUsername = username;
}

const getBaseUsage = () => `@${botUsername} @username|ID text`;
const getUsageText = () => `How to send a whisper? ${getBaseUsage()}`;

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
    if (/^-?\d+$/.test(token)) {
      return {
        targetType: 'id',
        targetNormalized: Number(token),
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

  if (query.length > MAX_SECRET_LENGTH) {
    return { error: ParseError.TOO_LONG, hint: `Secret is too long. Max ${MAX_SECRET_LENGTH} characters.` };
  }

  return {
    error: ParseError.INVALID_TARGET,
    hint: `Use a numeric ID or @username, e.g. ${baseUsage}`,
  };
}

export const usageText = getUsageText;
export const baseUsage = getBaseUsage;
export const getBotUsername = () => botUsername;
export const maxSecretLength = MAX_SECRET_LENGTH;
