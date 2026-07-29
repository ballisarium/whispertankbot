import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { observeTelegramUser } from '../src/helpers/observeUser.js';
import {
  resetUserDirectoryForTests,
  resolveUsername,
} from '../src/helpers/userDirectory.js';
import { resetTelegramSchedulerForTests } from '../src/helpers/telegramScheduler.js';

afterEach(() => {
  resetUserDirectoryForTests();
  resetTelegramSchedulerForTests();
});

test('learns every active username through one numeric getChat lookup', async () => {
  let getChatCalls = 0;
  const telegram = {
    getChat: async (userId) => {
      getChatCalls++;
      assert.equal(userId, 42);
      return {
        id: 42,
        type: 'private',
        first_name: 'Friend',
        username: 'primary_name',
        active_usernames: ['primary_name', 'collectible_name'],
      };
    },
  };

  await observeTelegramUser(
    { id: 42, first_name: 'Friend', username: 'primary_name' },
    telegram,
    100
  );
  await observeTelegramUser(
    { id: 42, first_name: 'Friend', username: 'primary_name' },
    telegram,
    101
  );

  assert.equal(getChatCalls, 1);
  assert.equal(await resolveUsername('primary_name'), 42);
  assert.equal(await resolveUsername('collectible_name'), 42);
});
