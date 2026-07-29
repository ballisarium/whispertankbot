import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import Redis from 'ioredis';
import {
  createDraftRateLimiter,
  RateLimitResult,
} from '../src/helpers/rateLimit.js';

let redisProcess;
let redis;
let tempDirectory;
let socketPath;
let now;
const redisServerAvailable = spawnSync('redis-server', ['--version'], {
  stdio: 'ignore',
}).status === 0;

before(async () => {
  if (!redisServerAvailable) return;
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'whisper-rate-'));
  socketPath = path.join(tempDirectory, 'redis.sock');
  redisProcess = spawn('redis-server', [
    '--port', '0',
    '--save', '',
    '--appendonly', 'no',
    '--unixsocket', socketPath,
    '--unixsocketperm', '700',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const onOutput = (chunk) => {
      if (chunk.toString().toLowerCase().includes('ready to accept connections')) {
        resolve();
      }
    };
    redisProcess.stdout.on('data', onOutput);
    redisProcess.stderr.on('data', onOutput);
    redisProcess.once('error', reject);
    redisProcess.once('exit', (code) => {
      if (code !== 0) reject(new Error(`redis-server exited with ${code}`));
    });
  });

  redis = new Redis(socketPath, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  await redis.ping();
});

beforeEach(async () => {
  if (!redisServerAvailable) return;
  now = 1_000;
  await redis.flushdb();
});

after(async () => {
  if (redis) await redis.quit();
  if (redisProcess?.exitCode === null) {
    await new Promise((resolve) => {
      redisProcess.once('exit', resolve);
      redisProcess.kill('SIGTERM');
    });
  }
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

const createRedisLimiter = (t) => {
  const limiter = createDraftRateLimiter({
    getRedisClient: () => redis,
    now: () => now,
  });
  t.after(() => limiter.shutdown());
  return limiter;
};

test('Redis charges character-by-character edits as one draft', async (t) => {
  if (!redisServerAvailable) return t.skip('redis-server is not installed');
  const limiter = createRedisLimiter(t);

  for (const secretText of ['h', 'he', 'hel', 'hell', 'hello']) {
    const check = await limiter.check({
      userId: 7,
      targetKey: 'front:friend',
      secretText,
    });
    assert.equal(check.result, RateLimitResult.ALLOWED);
  }

  const repeated = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'hello',
  });
  assert.equal(repeated.charged, false);
  assert.equal(repeated.remaining, 9);
});

test('Redis charges a non-prefix replacement as a distinct draft', async (t) => {
  if (!redisServerAvailable) return t.skip('redis-server is not installed');
  const limiter = createRedisLimiter(t);
  await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'first' });

  const check = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'second',
  });

  assert.equal(check.result, RateLimitResult.ALLOWED);
  assert.equal(check.charged, true);
  assert.equal(check.remaining, 8);
});

test('Redis charges the next complete query after the draft window', async (t) => {
  if (!redisServerAvailable) return t.skip('redis-server is not installed');
  const limiter = createRedisLimiter(t);
  await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'hello' });

  now += 15_001;
  const check = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'hello!',
  });

  assert.equal(check.result, RateLimitResult.ALLOWED);
  assert.equal(check.charged, true);
  assert.equal(check.remaining, 8);
});

test('Redis blocks the eleventh distinct draft in one minute', async (t) => {
  if (!redisServerAvailable) return t.skip('redis-server is not installed');
  const limiter = createRedisLimiter(t);

  for (let i = 0; i < 10; i++) {
    const check = await limiter.check({
      userId: 7,
      targetKey: 'front:friend',
      secretText: `draft-${i}`,
    });
    assert.equal(check.result, RateLimitResult.ALLOWED);
  }

  const blocked = await limiter.check({
    userId: 7,
    targetKey: 'front:friend',
    secretText: 'draft-10',
  });
  assert.deepEqual(blocked, {
    result: RateLimitResult.BLOCKED,
    retryAfter: 60,
    charged: false,
  });
});
