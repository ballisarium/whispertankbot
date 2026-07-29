import assert from 'node:assert/strict';
import test from 'node:test';
import { getSafeErrorLogContext } from '../src/helpers/errorLog.js';

test('safe error context excludes messages, stacks, and payloads', () => {
  const error = Object.assign(
    new Error('BOT_TOKEN=secret and private whisper body'),
    {
      code: 'ECONNRESET',
      command: { args: ['private whisper body'] },
      kind: 'storage',
    }
  );

  const context = getSafeErrorLogContext(error, {
    kind: 'internal',
    operation: 'redis_read',
    updateId: 42,
  });
  const serialized = JSON.stringify(context);

  assert.deepEqual(context, {
    code: 'ECONNRESET',
    kind: 'storage',
    operation: 'redis_read',
    updateId: 42,
  });
  assert.doesNotMatch(serialized, /secret|whisper|BOT_TOKEN|command|args|stack|message/);
});

test('safe error context rejects untrusted metadata strings', () => {
  const context = getSafeErrorLogContext({
    code: 'bad code with secret',
    kind: 'bad kind with secret',
  }, {
    operation: 'bad operation with secret',
    updateId: 'not-a-Telegram-update',
  });

  assert.deepEqual(context, {
    code: null,
    kind: 'internal',
    operation: null,
    updateId: 'unknown',
  });
});
