import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserDirectory } from '../src/helpers/userDirectory.js';

test('resolves only usernames learned with a Telegram user id', async () => {
  let now = 1_000;
  const directory = createUserDirectory({ getRedisClient: () => null, now: () => now });

  assert.equal(await directory.learn({ username: 'Friend' }), false);
  assert.equal(await directory.resolve('friend'), null);

  assert.equal(await directory.learn({ id: 42, username: 'Friend' }), true);
  assert.equal(await directory.resolve('@FRIEND'), 42);
});

test('removes a previous username when the same user is renamed', async () => {
  const directory = createUserDirectory({ getRedisClient: () => null, now: () => 1_000 });
  await directory.learn({ id: 42, username: 'old_name' });
  await directory.learn({ id: 42, username: 'new_name' });

  assert.equal(await directory.resolve('old_name'), null);
  assert.equal(await directory.resolve('new_name'), 42);
});

test('removes a previous username when Telegram no longer provides one', async () => {
  const directory = createUserDirectory({ getRedisClient: () => null, now: () => 1_000 });
  await directory.learn({ id: 42, username: 'friend' });

  assert.equal(await directory.learn({ id: 42 }), true);
  assert.equal(await directory.resolve('friend'), null);
});

test('expires observed usernames after thirty days', async () => {
  let now = 1_000;
  const directory = createUserDirectory({ getRedisClient: () => null, now: () => now });
  await directory.learn({ id: 42, username: 'friend' });

  now += 30 * 24 * 60 * 60 * 1_000 + 1;
  assert.equal(await directory.resolve('friend'), null);
});
