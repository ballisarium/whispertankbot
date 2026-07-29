import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTelegramScheduler,
  getTelegramErrorLogContext,
  TelegramRequestError,
  TelegramSchedulerClosedError,
  TelegramSchedulerOverloadedError,
} from '../src/helpers/telegramScheduler.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

const telegramError = (code, retryAfter) => Object.assign(
  new Error(`Telegram rejected request with ${code}`),
  {
    code,
    parameters: retryAfter === undefined ? undefined : { retry_after: retryAfter },
  }
);

test('interactive work starts while same-chat delivery is pacing', async () => {
  let now = 0;
  const sleeps = [];
  const scheduler = createTelegramScheduler({
    now: () => now,
    sleep: (ms) => {
      const wait = deferred();
      sleeps.push({ ms, ...wait });
      return wait.promise;
    },
  });

  assert.equal(await scheduler.delivery('chat:1', async () => 'first'), 'first');
  const second = scheduler.delivery('chat:1', async () => 'second');
  await flushTasks();

  assert.equal(sleeps[0].ms, 1_000);
  assert.equal(await scheduler.interactive(async () => 'answer'), 'answer');

  now = 1_000;
  sleeps[0].resolve();
  assert.equal(await second, 'second');
  await scheduler.shutdown();
});

test('deduplicates concurrent lookups by key', async () => {
  const scheduler = createTelegramScheduler();
  const release = deferred();
  let calls = 0;
  const operation = async () => {
    calls++;
    await release.promise;
    return { id: 42 };
  };

  const first = scheduler.lookup('user:42', operation);
  const second = scheduler.lookup('user:42', operation);
  await flushTasks();
  release.resolve();

  assert.deepEqual(await Promise.all([first, second]), [{ id: 42 }, { id: 42 }]);
  assert.equal(calls, 1);
  await scheduler.shutdown();
});

test('runs at most sixteen interactive calls concurrently', async () => {
  const scheduler = createTelegramScheduler();
  const release = deferred();
  let active = 0;
  let maxActive = 0;
  let started = 0;

  const calls = Array.from({ length: 17 }, () => scheduler.interactive(async () => {
    started++;
    active++;
    maxActive = Math.max(maxActive, active);
    await release.promise;
    active--;
    return true;
  }));

  await flushTasks();
  assert.equal(started, 16);
  assert.equal(maxActive, 16);
  release.resolve();
  assert.equal((await Promise.all(calls)).length, 17);
  await scheduler.shutdown();
});

test('runs at most eight distinct lookups concurrently', async () => {
  const scheduler = createTelegramScheduler();
  const release = deferred();
  let active = 0;
  let maxActive = 0;
  let started = 0;

  const calls = Array.from({ length: 9 }, (_, index) =>
    scheduler.lookup(`user:${index}`, async () => {
      started++;
      active++;
      maxActive = Math.max(maxActive, active);
      await release.promise;
      active--;
      return index;
    })
  );

  await flushTasks();
  assert.equal(started, 8);
  assert.equal(maxActive, 8);
  release.resolve();
  assert.equal((await Promise.all(calls)).length, 9);
  await scheduler.shutdown();
});

test('limits global delivery starts to thirty per second', async () => {
  let now = 0;
  const sleeps = [];
  const scheduler = createTelegramScheduler({
    now: () => now,
    sleep: (ms) => {
      const wait = deferred();
      sleeps.push({ ms, ...wait });
      return wait.promise;
    },
  });
  const starts = [];

  const calls = Array.from({ length: 31 }, (_, index) =>
    scheduler.delivery(`chat:${index}`, async () => {
      starts.push(now);
      return index;
    })
  );
  await flushTasks();

  assert.equal(starts.filter((startedAt) => startedAt === 0).length, 30);
  assert.equal(sleeps[0].ms, 1_000);

  now = 1_000;
  sleeps[0].resolve();
  await Promise.all(calls);
  assert.equal(starts.filter((startedAt) => startedAt === 1_000).length, 1);
  await scheduler.shutdown();
});

test('rejects work beyond a lane queue limit', async () => {
  const scheduler = createTelegramScheduler({
    limits: {
      interactiveConcurrency: 1,
      maxQueue: 2,
    },
  });
  const release = deferred();
  const active = scheduler.interactive(() => release.promise);
  await flushTasks();
  const queuedOne = scheduler.interactive(async () => 1);
  const queuedTwo = scheduler.interactive(async () => 2);

  await assert.rejects(
    scheduler.interactive(async () => 3),
    TelegramSchedulerOverloadedError
  );

  release.resolve();
  assert.equal(await active, undefined);
  assert.deepEqual(await Promise.all([queuedOne, queuedTwo]), [1, 2]);
  await scheduler.shutdown();
});

test('shutdown rejects queued and new work without waiting past grace', async () => {
  const scheduler = createTelegramScheduler({
    limits: {
      interactiveConcurrency: 1,
      maxQueue: 2,
    },
  });
  const release = deferred();
  const active = scheduler.interactive(() => release.promise);
  await flushTasks();
  const queued = scheduler.interactive(async () => 'queued');
  const queuedRejection = assert.rejects(queued, TelegramSchedulerClosedError);

  await scheduler.shutdown({ graceMs: 5 });

  await queuedRejection;
  await assert.rejects(
    scheduler.interactive(async () => 'new'),
    TelegramSchedulerClosedError
  );

  release.resolve();
  assert.equal(await active, undefined);
});

test('shutdown prevents paced delivery work from starting after close', async () => {
  const scheduler = createTelegramScheduler();
  let started = 0;
  const calls = Array.from({ length: 60 }, (_, index) =>
    scheduler.delivery(`chat:${index}`, async () => {
      started++;
      return index;
    })
  );
  const outcomesPromise = Promise.allSettled(calls);
  await flushTasks();
  assert.equal(started, 30);

  await scheduler.shutdown({ graceMs: 5 });
  const outcomes = await outcomesPromise;

  assert.equal(started, 30);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 30);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 30);
  for (const outcome of outcomes.filter((candidate) => candidate.status === 'rejected')) {
    assert.ok(outcome.reason instanceof TelegramSchedulerClosedError);
  }
});

test('shutdown rejects a repeated key while its original lookup is still running', async () => {
  const scheduler = createTelegramScheduler();
  const release = deferred();
  const active = scheduler.lookup('user:42', async () => {
    await release.promise;
    return 42;
  });
  await flushTasks();
  await scheduler.shutdown({ graceMs: 1 });

  const repeated = scheduler.lookup('user:42', async () => 99);
  release.resolve();

  assert.equal(await active, 42);
  await assert.rejects(repeated, TelegramSchedulerClosedError);
});

test('waits exact retry_after and retries a rejected call once', async () => {
  const sleeps = [];
  let attempts = 0;
  const scheduler = createTelegramScheduler({
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await scheduler.interactive(async () => {
    attempts++;
    if (attempts === 1) throw telegramError(429, 7);
    return true;
  }, { method: 'answerInlineQuery', updateId: 11 });

  assert.equal(result, true);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [7_000]);
  await scheduler.shutdown();
});

test('does not make a third attempt after a second flood wait', async () => {
  const sleeps = [];
  let attempts = 0;
  const scheduler = createTelegramScheduler({
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  await assert.rejects(
    scheduler.interactive(async () => {
      attempts++;
      throw telegramError(429, 3);
    }, { method: 'answerCbQuery', updateId: 12 }),
    (error) => {
      assert.ok(error instanceof TelegramRequestError);
      assert.equal(error.kind, 'rejected');
      assert.equal(error.retryAfter, 3);
      return true;
    }
  );
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [3_000]);
  await scheduler.shutdown();
});

test('retries a read once after a temporary network failure', async () => {
  const sleeps = [];
  let attempts = 0;
  const scheduler = createTelegramScheduler({
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await scheduler.lookup('user:42', async () => {
    attempts++;
    if (attempts === 1) throw new Error('connection reset');
    return { id: 42 };
  }, { method: 'getChat', updateId: 13 });

  assert.deepEqual(result, { id: 42 });
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1_000]);
  await scheduler.shutdown();
});

test('does not retry an ambiguous mutating network failure', async () => {
  let attempts = 0;
  const scheduler = createTelegramScheduler();

  await assert.rejects(
    scheduler.delivery('user:42', async () => {
      attempts++;
      throw new Error('socket closed after write');
    }, { method: 'sendMessage', updateId: 14 }),
    (error) => {
      assert.ok(error instanceof TelegramRequestError);
      assert.equal(error.kind, 'ambiguous');
      return true;
    }
  );
  assert.equal(attempts, 1);
  await scheduler.shutdown();
});

test('does not retry an ambiguous mutating Telegram 5xx', async () => {
  let attempts = 0;
  const scheduler = createTelegramScheduler();

  await assert.rejects(
    scheduler.delivery('user:42', async () => {
      attempts++;
      throw telegramError(502);
    }, { method: 'editMessageText', updateId: 15 }),
    (error) => {
      assert.ok(error instanceof TelegramRequestError);
      assert.equal(error.kind, 'ambiguous');
      assert.equal(error.code, 502);
      return true;
    }
  );
  assert.equal(attempts, 1);
  await scheduler.shutdown();
});

test('does not retry a permanent Telegram 4xx', async () => {
  let attempts = 0;
  const scheduler = createTelegramScheduler();

  await assert.rejects(
    scheduler.delivery('user:42', async () => {
      attempts++;
      throw telegramError(403);
    }, { method: 'sendMessage', updateId: 16 }),
    (error) => {
      assert.ok(error instanceof TelegramRequestError);
      assert.equal(error.kind, 'permanent');
      assert.equal(error.code, 403);
      return true;
    }
  );
  assert.equal(attempts, 1);
  await scheduler.shutdown();
});

test('exposes safe error metadata without the original message or payload', async () => {
  const scheduler = createTelegramScheduler();
  let caught;

  try {
    await scheduler.delivery('user:42', async () => {
      throw new Error('secret body and token must not be logged');
    }, {
      method: 'sendMessage',
      updateId: 17,
      payload: 'secret body',
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof TelegramRequestError);
  assert.doesNotMatch(caught.message, /secret body|token/);
  assert.deepEqual(getTelegramErrorLogContext(caught, 99), {
    code: null,
    kind: 'ambiguous',
    method: 'sendMessage',
    retryAfter: null,
    updateId: 17,
  });
  await scheduler.shutdown();
});
