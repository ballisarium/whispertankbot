import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { handleReadCallback } from '../src/handlers/callback.js';
import { createSecret, getSecret, shutdown } from '../src/helpers/secrets.js';
import {
  createTelegramScheduler,
  resetTelegramSchedulerForTests,
  setTelegramSchedulerForTests,
} from '../src/helpers/telegramScheduler.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

const telegramError = (code) => Object.assign(
  new Error(`Telegram rejected request with ${code}`),
  { code }
);

function createReadContext(secretId, { from, answerCbQuery, sendMessage, getChat, editMessageText } = {}) {
  return {
    match: [`read:${secretId}`, secretId],
    from,
    answerCbQuery: answerCbQuery || (async () => {}),
    editMessageText: editMessageText || (async () => {}),
    telegram: {
      sendMessage: sendMessage || (async () => {}),
      getChat: getChat || (async () => null),
    },
  };
}

afterEach(async () => {
  resetTelegramSchedulerForTests();
  await shutdown();
});

test('does not reveal an unresolved username secret by username fallback', async () => {
  const secretId = await createSecret({
    targetType: 'username',
    targetNormalized: 'friend',
    targetLabel: '@friend',
    secretText: 'private',
    authorId: 1,
    targetPosition: 'front',
    lang: 'en',
  });

  const answers = [];
  const ctx = createReadContext(secretId, {
    from: { id: 2, username: 'friend' },
    answerCbQuery: async (text, options) => answers.push({ text, options }),
    getChat: async () => ({ id: 2, type: 'private', username: 'friend' }),
  });

  await handleReadCallback(ctx);

  assert.notEqual(answers[0]?.text, 'private');
  assert.ok(await getSecret(secretId));
});

test('allows a resolved username target even after the target removes username', async () => {
  const secretId = await createSecret({
    targetType: 'username',
    targetNormalized: 'friend',
    targetLabel: '@friend',
    secretText: 'private',
    authorId: 1,
    targetPosition: 'front',
    lang: 'en',
    resolvedTargetId: 2,
  });

  const answers = [];
  const ctx = createReadContext(secretId, {
    from: { id: 2 },
    answerCbQuery: async (text, options) => answers.push({ text, options }),
  });

  await handleReadCallback(ctx);

  assert.equal(answers[0]?.text, 'private');
});

test('only one parallel target read can consume a one-time secret', async () => {
  const secretId = await createSecret({
    targetType: 'id',
    targetNormalized: '42',
    targetLabel: 'ID 42',
    secretText: 'single read',
    authorId: 1,
    targetPosition: 'front',
    lang: 'en',
  });

  const answers = [];
  const pendingDeliveries = [];
  const makeCtx = () => createReadContext(secretId, {
    from: { id: 42 },
    answerCbQuery: async (text, options) => {
      answers.push({ text, options });
      if (text === 'single read') {
        await new Promise((resolve) => pendingDeliveries.push(resolve));
      }
    },
  });

  const first = handleReadCallback(makeCtx());
  await new Promise((resolve) => setImmediate(resolve));
  const second = handleReadCallback(makeCtx());
  await new Promise((resolve) => setImmediate(resolve));

  for (const resolve of pendingDeliveries) resolve();
  await Promise.all([first, second]);

  assert.equal(answers.filter((answer) => answer.text === 'single read').length, 1);
});

test('restores a consumed target secret after a known delivery rejection', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const longSecret = 'x'.repeat(250);
  const secretId = await createSecret({
    targetType: 'id',
    targetNormalized: '42',
    targetLabel: 'ID 42',
    secretText: longSecret,
    authorId: 1,
    targetPosition: 'front',
    lang: 'en',
  });

  const answers = [];
  const ctx = createReadContext(secretId, {
    from: { id: 42 },
    answerCbQuery: async (text, options) => answers.push({ text, options }),
    sendMessage: async () => {
      throw telegramError(403);
    },
  });

  await handleReadCallback(ctx);

  assert.ok(await getSecret(secretId));
  assert.notEqual(answers[0]?.text, `${longSecret.slice(0, 187)}...`);
});

test('does not restore a consumed target secret after ambiguous delivery', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const secretId = await createSecret({
    targetType: 'id',
    targetNormalized: '42',
    targetLabel: 'ID 42',
    secretText: 'x'.repeat(250),
    authorId: 1,
    targetPosition: 'front',
    lang: 'en',
  });
  const ctx = createReadContext(secretId, {
    from: { id: 42 },
    sendMessage: async () => {
      throw new Error('socket closed after write');
    },
  });

  await handleReadCallback(ctx);

  assert.equal(await getSecret(secretId), null);
});

test('submits callback answers through the interactive scheduler', async () => {
  const scheduler = createTelegramScheduler({
    limits: { interactiveConcurrency: 1 },
  });
  setTelegramSchedulerForTests(scheduler);
  const release = deferred();
  const blocker = scheduler.interactive(() => release.promise);
  await flushTasks();
  const answers = [];
  const ctx = createReadContext('invalid', {
    from: { id: 42 },
    answerCbQuery: async (text, options) => answers.push({ text, options }),
  });
  let settled = false;
  const handling = handleReadCallback(ctx).then(() => {
    settled = true;
  });

  await flushTasks();
  assert.equal(settled, false);

  release.resolve();
  await blocker;
  await handling;
  assert.equal(answers.length, 1);
  await scheduler.shutdown();
});
