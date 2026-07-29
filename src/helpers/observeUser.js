import { getTelegramErrorLogContext, scheduleLookup } from './telegramScheduler.js';
import {
  learnUser,
  needsUsernameRefresh,
} from './userDirectory.js';

const completeUsernames = (chat) =>
  Array.isArray(chat?.active_usernames) ? chat.active_usernames : [];

// Users the bot only sees in passing (e.g. the author of a replied-to message)
// still teach the directory their username, without a getChat refresh.
export async function observeMentionedUser(user) {
  if (!user || user.is_bot) return false;
  return learnUser(user);
}

export async function observeTelegramUser(user, telegram, updateId) {
  const learned = await learnUser(user);
  if (!learned || !telegram?.getChat) return learned;

  const refreshNeeded = await needsUsernameRefresh(user.id, user.username);
  if (!refreshNeeded) return true;

  try {
    const chat = await scheduleLookup(
      `user:${user.id}`,
      () => telegram.getChat(user.id),
      { method: 'getChat', updateId }
    );
    if (
      !chat
      || chat.type !== 'private'
      || String(chat.id) !== String(user.id)
    ) {
      return false;
    }

    await learnUser({
      ...chat,
      active_usernames: completeUsernames(chat),
    });
    return true;
  } catch (error) {
    console.warn(
      'Failed to refresh Telegram usernames',
      getTelegramErrorLogContext(error, updateId)
    );
    return false;
  }
}
