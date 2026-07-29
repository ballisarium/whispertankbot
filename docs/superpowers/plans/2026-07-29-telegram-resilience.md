# Telegram Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent inline typing from causing false local limits and make Telegram API calls tolerate real flood control without changing existing bot features.

**Architecture:** Add a verified observed-user directory and profile cache beside the existing optional Redis storage. Replace the fixed per-update limiter with an atomic draft-aware limiter, then route application Bot API calls through an in-process scheduler that separates interactive, delivery, and lookup work and retries only outcomes known to be safe.

**Tech Stack:** Node.js 25, ES modules, Telegraf 4.16.3, ioredis 5.8.2, `node:test`, Redis Lua scripts.

## Global Constraints

- Preserve commands, inline syntax, en/ru/uk localization, statistics, access rules, six-hour secret lifetime, optional Redis fallback, and atomic one-time reads.
- Keep username recipient authorization resolved and stored by Telegram user ID; never reveal by username comparison alone.
- Do not add user-facing features or production dependencies.
- Do not contact Telegram, use a real bot token, start polling, or mutate production during validation.
- Use the existing `npm` lockfile and `node:test` runner.
- Write every behavior change test-first and observe the focused test fail for the expected reason before production edits.
- Before every commit run the focused test, full `npm test`, syntax checks for all `src/**/*.js`, and `git diff --check`.
- Make one short English commit per coherent change and immediately push `main`.

---

## File Structure

- `src/helpers/userDirectory.js`: verified username and profile cache with Redis and memory backends.
- `src/helpers/rateLimit.js`: draft-aware rate limiter with memory and atomic Redis implementations.
- `src/helpers/telegramScheduler.js`: priority/concurrency/pacing scheduler and outcome-aware retry classification.
- `src/handlers/inline.js`: parse-first inline flow, verified target lookup, scheduled answers, cached labels.
- `src/handlers/callback.js`: scheduled callback/message delivery and outcome-safe secret restoration.
- `src/handlers/start.js`: scheduled replies, edits, and callback acknowledgements.
- `src/helpers/stats.js`: scheduled daily admin report sends.
- `src/index.js`: observed-user middleware and orderly scheduler/cache shutdown.
- `test/userDirectory.test.js`: memory/Redis-independent directory contract.
- `test/rateLimit.test.js`: memory draft-lineage contract.
- `test/rateLimit.redis.test.js`: the same contract against an isolated temporary Redis process.
- `test/telegramScheduler.test.js`: concurrency, pacing, deduplication, retry, overload, and shutdown.
- `test/inline.test.js`: user-visible inline integration regressions.
- `test/callback.test.js`: callback delivery certainty regressions.
- `test/start.test.js`: start/menu scheduling regressions where needed.

---

### Task 1: Verified Observed-User Directory

**Files:**

- Create: `src/helpers/userDirectory.js`
- Create: `test/userDirectory.test.js`
- Modify: `src/handlers/inline.js:74-154`
- Modify: `src/index.js:1-55`
- Modify: `README.md:14-30`

**Interfaces:**

- Produces: `createUserDirectory({ getRedisClient, now })`
- Produces: `learnUser(user): Promise<boolean>`
- Produces: `resolveUsername(username): Promise<number | null>`
- Produces: `shutdownUserDirectory(): void`
- Produces: `resetUserDirectoryForTests(): void`
- Consumes: existing `getRedisClient()` from `src/helpers/secrets.js`
- Later tasks extend the same directory with profile cache methods.

- [ ] **Step 1: Write failing directory contract tests**

Create `test/userDirectory.test.js` with a deterministic clock and injected
memory-only directory:

```js
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

test('expires observed usernames after thirty days', async () => {
  let now = 1_000;
  const directory = createUserDirectory({ getRedisClient: () => null, now: () => now });
  await directory.learn({ id: 42, username: 'friend' });

  now += 30 * 24 * 60 * 60 * 1_000 + 1;
  assert.equal(await directory.resolve('friend'), null);
});
```

- [ ] **Step 2: Run the directory tests and verify RED**

Run:

```bash
node --test test/userDirectory.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`src/helpers/userDirectory.js`.

- [ ] **Step 3: Implement the directory**

Create a factory whose instance owns `byUsername` and `byUserId` maps. Normalize
usernames by stripping one leading `@` and lowercasing. Store records as:

```js
{
  userId: String(user.id),
  username: normalized,
  expiresAt: now() + 30 * 24 * 60 * 60 * 1000,
}
```

Use Redis keys:

```js
const usernameKey = (username) => `whisper:directory:username:${username}`;
const userKey = (userId) => `whisper:directory:user:${userId}`;
```

Write both Redis records with `PX` equal to 30 days. When a user changes or
removes a username, read the previous user record and delete the old username
key only if it still points to that user. On any Redis error, log a sanitized
message and perform the same operation in memory.

Export singleton wrappers:

```js
const directory = createUserDirectory({ getRedisClient });
export const learnUser = (user) => directory.learn(user);
export const resolveUsername = (username) => directory.resolve(username);
export const resetUserDirectoryForTests = () => directory.reset();
export const shutdownUserDirectory = () => directory.shutdown();
```

- [ ] **Step 4: Verify the directory tests are GREEN**

Run:

```bash
node --test test/userDirectory.test.js
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing inline integration tests**

Update the inline context factory to accept `fromUsername`, and reset the user
directory in `afterEach`. Replace the old implicit `getChat('@friend')` success
with explicit learning:

```js
test('resolves a username learned from a previous Telegram update without getChat', async () => {
  setStatsEnabled(false);
  await learnUser({ id: 42, username: 'friend' });
  let getChatCalls = 0;
  const ctx = createInlineContext({
    query: '@friend secret',
    getChat: async () => {
      getChatCalls++;
      throw new Error('username getChat must not run');
    },
  });

  await handleInlineQuery(ctx);

  assert.equal(getChatCalls, 0);
  assert.equal(ctx.answers[0].results[0].id.length, 36);
});

test('returns the existing unavailable result for an unknown username', async () => {
  setStatsEnabled(false);
  const ctx = createInlineContext({ query: '@unknown secret' });

  await handleInlineQuery(ctx);

  assert.equal(ctx.answers[0].results[0].id, 'target_unavailable');
});
```

- [ ] **Step 6: Run the inline tests and verify RED**

Run:

```bash
node --test test/inline.test.js
```

Expected: the learned username test FAILS because the handler still calls
`getChat('@friend')`.

- [ ] **Step 7: Route username resolution through the directory**

In `handleInlineQuery`, replace the username `getChat` block with:

```js
const resolvedTargetId = parsed.targetType === 'username'
  ? await resolveUsername(parsed.targetUsername)
  : null;
```

Keep the existing `target_unavailable` result and statistics branch when the
directory returns `null`. Do not add a username fallback in the callback.

Register middleware before all handlers in `src/index.js`:

```js
bot.use(async (ctx, next) => {
  await learnUser(ctx.from);
  return next();
});
```

Document that usernames become verifiable after the target interacts with the
bot and that mappings expire after 30 days.

- [ ] **Step 8: Verify, commit, and push Task 1**

Run:

```bash
node --test test/userDirectory.test.js test/inline.test.js test/callback.test.js
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
git diff --check
```

Expected: all commands exit 0.

Then:

```bash
git add src/helpers/userDirectory.js src/handlers/inline.js src/index.js \
  test/userDirectory.test.js test/inline.test.js README.md
git commit -m "Cache observed Telegram users"
git push origin main
```

---

### Task 2: Draft-Aware Local Rate Limiting

**Files:**

- Modify: `src/helpers/rateLimit.js`
- Create: `test/rateLimit.test.js`
- Create: `test/rateLimit.redis.test.js`
- Modify: `src/handlers/inline.js:74-170`
- Modify: `test/inline.test.js`

**Interfaces:**

- Replaces: `checkRateLimit(userId, increment)`
- Produces: `createDraftRateLimiter({ getRedisClient, now })`
- Produces: `checkDraftRateLimit({ userId, targetKey, secretText }): Promise<RateLimitCheck>`
- `RateLimitCheck` is `{ result: 'allowed', remaining: number, charged: boolean }`
  or `{ result: 'blocked', retryAfter: number, charged: false }`.
- Retains: `RateLimitResult`, `shutdownRateLimit()`,
  `resetRateLimitForTests()`.

- [ ] **Step 1: Write failing memory contract tests**

Create `test/rateLimit.test.js` with:

```js
test('charges character-by-character edits as one draft', async () => {
  let now = 1_000;
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => now });

  for (const secretText of ['h', 'he', 'hel', 'hell', 'hello']) {
    const check = await limiter.check({ userId: 7, targetKey: 'front:friend', secretText });
    assert.equal(check.result, RateLimitResult.ALLOWED);
  }

  assert.equal(
    (await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'hello' })).remaining,
    9
  );
});

test('charges a non-prefix replacement as a distinct draft', async () => {
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => 1_000 });
  await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'first' });
  const check = await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'second' });
  assert.equal(check.charged, true);
  assert.equal(check.remaining, 8);
});

test('charges the next complete query after the draft window', async () => {
  let now = 1_000;
  const limiter = createDraftRateLimiter({ getRedisClient: () => null, now: () => now });
  await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'hello' });
  now += 15_001;
  const check = await limiter.check({ userId: 7, targetKey: 'front:friend', secretText: 'hello!' });
  assert.equal(check.charged, true);
  assert.equal(check.remaining, 8);
});
```

Add a fourth test that submits ten non-prefix drafts, verifies all ten are
allowed, then verifies the eleventh is blocked with `retryAfter === 60`.

- [ ] **Step 2: Run memory limiter tests and verify RED**

Run:

```bash
node --test test/rateLimit.test.js
```

Expected: FAIL because `createDraftRateLimiter` does not exist.

- [ ] **Step 3: Implement the memory limiter contract**

Use constants:

```js
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const DRAFT_WINDOW_MS = 15_000;
```

Each memory record contains:

```js
{
  count,
  windowStart,
  drafts: new Map([[targetKey, { text: secretText, updatedAt: now }]]),
}
```

An edit is free only when it is within 15 seconds and
`oldText.startsWith(newText) || newText.startsWith(oldText)`. Always update the
draft text and timestamp after an allowed edit.

At this point retain the existing Redis fixed-window path unchanged. The next
failing test introduces the new Redis draft contract before that production
path is replaced.

- [ ] **Step 4: Verify memory tests are GREEN**

Run:

```bash
node --test test/rateLimit.test.js
```

Expected: all limiter memory tests PASS.

- [ ] **Step 5: Add isolated Redis parity tests**

In `test/rateLimit.redis.test.js`, start a child `redis-server` with
`--port 0`, `--save ""`, `--appendonly no`, and a Unix socket inside
`fs.mkdtemp(path.join(os.tmpdir(), 'whisper-rate-'))`. Connect ioredis to the
socket, flush only that isolated process, and terminate only the child process
in `after`.

Run the same draft-edit, distinct-draft, expiry, and eleventh-blocked assertions
through:

```js
createDraftRateLimiter({ getRedisClient: () => redis, now: () => now })
```

- [ ] **Step 6: Run Redis tests and verify RED**

Run:

```bash
node --test test/rateLimit.redis.test.js
```

Expected: FAIL because the existing Redis path increments character-by-character
edits instead of applying the draft-lineage contract.

- [ ] **Step 7: Implement the atomic Redis draft contract**

Use one Redis hash per user with `count`, `window_start`, and one draft field
whose name is a SHA-256 digest of `targetKey`. The Lua script receives current
time, both windows, max count, draft field, and secret text. It must:

1. reset the hash when the 60-second window expires;
2. classify prefix edits inside 15 seconds without incrementing;
3. return blocked without storing a new draft when count is already 10;
4. increment and store the draft atomically otherwise;
5. set the key TTL to the remaining rate window plus the draft window;
6. return `{status, remaining, retryAfterMs, charged}`.

Map the Lua array result to the same JavaScript result shape as memory, then
rerun:

```bash
node --test test/rateLimit.redis.test.js
```

Expected: all Redis parity tests PASS and the temporary Redis child exits.

- [ ] **Step 8: Move the inline limit after complete target resolution**

Delete the pre-parse `checkRateLimit(authorId, true)` block. After parsing and
verified target resolution, call:

```js
const rateCheck = await checkDraftRateLimit({
  userId: authorId,
  targetKey: `${parsed.targetPosition}:${parsed.targetType}:${parsed.targetNormalized}`,
  secretText: parsed.secretText,
});
```

Retain the same localized `rate_limited` article and `trackError` call when
blocked. Invalid, incomplete, target-only, and unknown username queries return
before this call.

Replace the old test `rate limits invalid inline queries too` with:

```js
test('does not rate limit incomplete inline typing', async () => {
  setStatsEnabled(false);
  let lastCtx;
  for (let i = 0; i < 20; i++) {
    lastCtx = createInlineContext({ query: '@friend'.slice(0, Math.max(1, i % 7)) });
    await handleInlineQuery(lastCtx);
  }
  assert.notEqual(lastCtx.answers[0].results[0].id, 'rate_limited');
});
```

Add an integration test that learns `friend`, submits
`@friend h` through `@friend hello`, and verifies none is rate limited.

- [ ] **Step 9: Verify, commit, and push Task 2**

Run:

```bash
node --test test/rateLimit.test.js test/rateLimit.redis.test.js test/inline.test.js
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
git diff --check
```

Expected: all commands exit 0 and the full suite has no skipped Redis parity
tests on the current development machine.

Then:

```bash
git add src/helpers/rateLimit.js src/handlers/inline.js \
  test/rateLimit.test.js test/rateLimit.redis.test.js test/inline.test.js
git commit -m "Fix inline request rate limiting"
git push origin main
```

---

### Task 3: Prioritized Telegram Request Scheduler

**Files:**

- Create: `src/helpers/telegramScheduler.js`
- Create: `test/telegramScheduler.test.js`
- Modify: `src/handlers/inline.js`
- Modify: `src/handlers/callback.js`
- Modify: `src/handlers/start.js`
- Modify: `src/helpers/stats.js`
- Modify: `src/index.js`
- Modify: `test/inline.test.js`
- Modify: `test/callback.test.js`
- Modify: `test/start.test.js`

**Interfaces:**

- Produces: `createTelegramScheduler({ now, sleep, limits })`
- Produces singleton wrappers:
  - `scheduleInteractive(operation, meta?)`
  - `scheduleDelivery(scope, operation, meta?)`
  - `scheduleLookup(key, operation, meta?)`
  - `shutdownTelegramScheduler({ graceMs = 5000 } = {})`
  - `setTelegramSchedulerForTests(scheduler)`
  - `resetTelegramSchedulerForTests()`
- `meta` contains only safe fields: `{ method, updateId }`.
- Task 4 extends execution with retry classification without changing handler
  call sites.

- [ ] **Step 1: Write failing scheduler behavior tests**

Create tests with deferred promises and an injected `sleep` recorder:

```js
test('interactive work starts while delivery work is pacing', async () => {
  const sleeps = [];
  const scheduler = createTelegramScheduler({
    now: () => 1_000,
    sleep: (ms) => new Promise((resolve) => sleeps.push({ ms, resolve })),
  });

  const first = scheduler.delivery('chat:1', async () => 'first');
  await first;
  const second = scheduler.delivery('chat:1', async () => 'second');
  const interactive = scheduler.interactive(async () => 'answer');

  assert.equal(await interactive, 'answer');
  assert.equal(sleeps[0].ms, 1_000);
  sleeps[0].resolve();
  assert.equal(await second, 'second');
});

test('deduplicates concurrent lookups by key', async () => {
  let calls = 0;
  let release;
  const scheduler = createTelegramScheduler();
  const operation = async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    return { id: 42 };
  };

  const a = scheduler.lookup('user:42', operation);
  const b = scheduler.lookup('user:42', operation);
  release();

  assert.deepEqual(await Promise.all([a, b]), [{ id: 42 }, { id: 42 }]);
  assert.equal(calls, 1);
});
```

Add tests for interactive concurrency 16, lookup concurrency 8, delivery scope
serialization, the 30-per-second global delivery window, 1,000 queued job
overload, queued rejection on shutdown, and a five-second running-call grace.

- [ ] **Step 2: Run scheduler tests and verify RED**

Run:

```bash
node --test test/telegramScheduler.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement isolated work classes**

Implement one `WorkLane` queue with:

```js
enqueue(operation, meta = {}) -> Promise<unknown>
close(error) -> void
reset() -> void
```

Use FIFO order within each lane. Interactive and lookup lanes drain up to their
concurrency. Delivery jobs additionally pass a pacing gate that tracks the last
start per scope and the last 30 global start timestamps. Do not use blocking
sleep or busy polling.

`lookup(key, operation)` stores the in-flight promise by key and removes it in
`finally`. `shutdown()` rejects queued jobs with
`TelegramSchedulerClosedError`, waits at most the configured grace period for
running jobs, then clears timers and resolves.

- [ ] **Step 4: Verify scheduler tests are GREEN**

Run:

```bash
node --test test/telegramScheduler.test.js
```

Expected: all scheduler tests PASS with no dangling handles.

- [ ] **Step 5: Write failing handler integration tests**

Install a fake through `setTelegramSchedulerForTests` whose
`interactive`, `delivery`, and `lookup` methods record `meta.method` before
calling the supplied operation. Reset the singleton in `afterEach`. Add focused
assertions:

```js
assert.deepEqual(scheduledMethods, ['answerInlineQuery']);
assert.deepEqual(callbackMethods, ['answerCbQuery', 'editMessageText']);
assert.deepEqual(startMethods, ['sendMessage']);
```

The assertions must fail while handlers call Telegraf context methods directly.

- [ ] **Step 6: Route all application Bot API calls**

Wrap:

- every `ctx.answerInlineQuery` with `scheduleInteractive`;
- every `ctx.answerCbQuery` with `scheduleInteractive`;
- `ctx.reply`, `ctx.telegram.sendMessage`, and message edits with
  `scheduleDelivery`;
- daily stats `bot.telegram.sendMessage` with `scheduleDelivery` scoped by
  admin ID.

Derive the delivery scope without message contents:

```js
export const deliveryScopeFor = (ctx) =>
  ctx.chat?.id != null
    ? `chat:${ctx.chat.id}`
    : ctx.callbackQuery?.inline_message_id
      ? `inline:${ctx.callbackQuery.inline_message_id}`
      : `user:${ctx.from?.id ?? 'unknown'}`;
```

Pass method and update ID as metadata, never secret text or API payloads.
Call `shutdownTelegramScheduler()` before Redis shutdown in
`shutdownResources`.

- [ ] **Step 7: Verify, commit, and push Task 3**

Run:

```bash
node --test test/telegramScheduler.test.js test/inline.test.js \
  test/callback.test.js test/start.test.js test/stats.test.js
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
git diff --check
```

Expected: all commands exit 0.

Then:

```bash
git add src/helpers/telegramScheduler.js src/handlers/inline.js \
  src/handlers/callback.js src/handlers/start.js src/helpers/stats.js \
  src/index.js test/telegramScheduler.test.js test/inline.test.js \
  test/callback.test.js test/start.test.js
git commit -m "Add Telegram request scheduling"
git push origin main
```

---

### Task 4: Outcome-Aware Flood-Wait Retries

**Files:**

- Modify: `src/helpers/telegramScheduler.js`
- Modify: `test/telegramScheduler.test.js`
- Modify: `src/handlers/callback.js`
- Modify: `test/callback.test.js`
- Modify: `src/index.js`

**Interfaces:**

- Produces: `TelegramRequestError`
- Produces error fields:
  - `kind`: `rejected`, `ambiguous`, `permanent`, `overloaded`, or `shutdown`
  - `method`: safe method name
  - `retryAfter`: integer seconds when provided
- Scheduler calls accept `operationKind: 'interactive' | 'mutating' | 'read'`.
- Existing wrappers supply the correct kind, so handlers do not classify raw
  Telegraf errors.

- [ ] **Step 1: Write failing retry classification tests**

Add a Telegram-shaped error helper:

```js
const telegramError = (code, retryAfter) => Object.assign(
  new Error(`${code}`),
  { code, parameters: retryAfter == null ? undefined : { retry_after: retryAfter } }
);
```

Cover:

```js
test('waits exact retry_after and retries a rejected call once', async () => {
  const sleeps = [];
  let attempts = 0;
  const scheduler = createTelegramScheduler({
    sleep: async (ms) => { sleeps.push(ms); },
  });

  const result = await scheduler.interactive(async () => {
    attempts++;
    if (attempts === 1) throw telegramError(429, 7);
    return true;
  }, { method: 'answerInlineQuery' });

  assert.equal(result, true);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [7_000]);
});
```

Add tests proving:

- a second `429` is returned as `kind === 'rejected'` without a third attempt;
- read-only network and `5xx` errors retry once after 1,000 ms;
- mutating network and `5xx` errors make one attempt and return
  `kind === 'ambiguous'`;
- explicit permanent `4xx` errors make one attempt and return
  `kind === 'permanent'`;
- errors and logs expose method/update ID but not an operation payload.

- [ ] **Step 2: Run retry tests and verify RED**

Run:

```bash
node --test test/telegramScheduler.test.js
```

Expected: retry assertions FAIL because each operation currently has one
attempt.

- [ ] **Step 3: Implement retry and error mapping**

Classify using Telegraf-compatible fields:

```js
const code = Number(error?.code ?? error?.response?.error_code);
const retryAfter = Number(
  error?.parameters?.retry_after ?? error?.response?.parameters?.retry_after
);
```

Rules:

- code 429: sleep `retryAfter * 1000`, retry once for every operation kind;
- read code >= 500 or non-Telegram network error: sleep 1,000 ms, retry once;
- mutating/interactive code >= 500 or network error: ambiguous, no retry;
- code 400-499 other than 429: permanent, no retry;
- preserve the original error as `cause`.

Do not cap or replace a valid server `retry_after`. If it is missing or invalid,
return rejected without inventing a delay.

- [ ] **Step 4: Write failing callback certainty tests**

Add:

```js
test('does not restore a consumed secret after ambiguous long-message delivery', async () => {
  const secretId = await createLongTargetSecret();
  const ctx = createReadContext(secretId, {
    from: { id: 42 },
    sendMessage: async () => { throw new Error('socket closed'); },
  });

  await handleReadCallback(ctx);

  assert.equal(await getSecret(secretId), null);
});

test('restores a consumed secret after Telegram explicitly rejects delivery', async () => {
  const secretId = await createLongTargetSecret();
  const ctx = createReadContext(secretId, {
    from: { id: 42 },
    sendMessage: async () => { throw telegramError(403); },
  });

  await handleReadCallback(ctx);

  assert.ok(await getSecret(secretId));
});
```

The ambiguous test must fail against the current unconditional restoration.
Change the existing generic `Error('forbidden')` restoration test to throw a
Telegram-shaped `403` error so it continues to prove restoration after an
explicit rejection rather than an ambiguous local failure.

- [ ] **Step 5: Make callback delivery certainty explicit**

Have `deliverSecret` return:

```js
{ delivered: true }
{ delivered: false, outcome: 'rejected' | 'permanent' }
{ delivered: false, outcome: 'ambiguous' }
```

Restore the consumed secret only for explicit `rejected` or `permanent`
outcomes. Do not restore after ambiguous delivery because Telegram may already
have shown the protected message. Keep the existing localized delivery-failed
callback response.

Replace the global error log with a sanitizer that reports update ID, error
kind, safe method, status code, and retry delay only. It must not print raw
context, payload, secret text, token, or environment values.

- [ ] **Step 6: Verify, commit, and push Task 4**

Run:

```bash
node --test test/telegramScheduler.test.js test/callback.test.js
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
git diff --check
```

Expected: all commands exit 0.

Then:

```bash
git add src/helpers/telegramScheduler.js src/handlers/callback.js \
  src/index.js test/telegramScheduler.test.js test/callback.test.js
git commit -m "Handle flood wait retries"
git push origin main
```

---

### Task 5: Cached Numeric Profile Lookups

**Files:**

- Modify: `src/helpers/userDirectory.js`
- Modify: `test/userDirectory.test.js`
- Modify: `src/handlers/inline.js`
- Modify: `test/inline.test.js`
- Modify: `README.md`

**Interfaces:**

- Extends directory with:
  - `getProfile(userId): Promise<UserProfile | null>`
  - `rememberProfile(profile): Promise<boolean>`
- `UserProfile` is:

```js
{
  id: String,
  firstName: String,
  lastName: String,
  username: String | null,
}
```

- Profile TTL is exactly 24 hours.
- Consumes: `scheduleLookup('user:<id>', operation, { method: 'getChat' })`.

- [ ] **Step 1: Write failing profile cache tests**

Add directory tests proving a remembered profile is returned, expires after 24
hours, and learning an observed Telegram user refreshes the matching profile.

Add inline integration:

```js
test('caches numeric target profiles across inline updates', async () => {
  setStatsEnabled(false);
  let getChatCalls = 0;
  const getChat = async () => {
    getChatCalls++;
    return { id: 42, type: 'private', first_name: 'Friend', username: 'friend' };
  };

  await handleInlineQuery(createInlineContext({ query: '42 first', getChat }));
  await handleInlineQuery(createInlineContext({ query: '42 second', getChat }));

  assert.equal(getChatCalls, 1);
});
```

- [ ] **Step 2: Run profile tests and verify RED**

Run:

```bash
node --test test/userDirectory.test.js test/inline.test.js
```

Expected: profile methods are missing and two inline updates call `getChat`
twice.

- [ ] **Step 3: Implement profile storage**

Store profiles in memory and Redis under
`whisper:directory:profile:<userId>` with `PX` 24 hours. Reject non-private
Telegram chats and profiles whose returned ID differs from the requested ID.
Redis failures fall back to memory without blocking whisper creation.

- [ ] **Step 4: Route numeric labels through cache and lookup scheduler**

In `resolveTargetLabels`:

1. call `getProfile(parsed.targetId)`;
2. on miss call `scheduleLookup` around `ctx.telegram.getChat`;
3. validate `chat.type === 'private'` and ID equality;
4. remember the profile;
5. render the existing label priority unchanged;
6. on failure retain the existing ID-only title/message.

Do not use this profile to authorize callback access; authorization continues
to use `targetNormalized` or `resolvedTargetId` already stored in the secret.

- [ ] **Step 5: Verify, commit, and push Task 5**

Run:

```bash
node --test test/userDirectory.test.js test/inline.test.js \
  test/telegramScheduler.test.js
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
git diff --check
```

Expected: all commands exit 0.

Then:

```bash
git add src/helpers/userDirectory.js src/handlers/inline.js \
  test/userDirectory.test.js test/inline.test.js README.md
git commit -m "Cache Telegram profile lookups"
git push origin main
```

---

### Task 6: Completion Audit

**Files:**

- Modify only files required by an independently reproduced audit defect.
- Do not create a cleanup commit for formatting or unrelated refactoring.

**Interfaces:**

- No new interface.
- Evidence must cover every invariant and behavior named in the design.

- [ ] **Step 1: Re-read the design and build an evidence checklist**

Compare every section of
`docs/superpowers/specs/2026-07-29-telegram-resilience-design.md` against the
current source and tests. Mark each requirement as proven, contradicted, or
missing in working notes under `.scratch/`; do not commit the notes.

- [ ] **Step 2: Run the complete safe verification**

Run:

```bash
npm ci --ignore-scripts
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
git diff --check
git status --short --branch
```

Expected: dependencies install cleanly, all tests pass, all source files parse,
diff check exits 0, and the worktree has no uncommitted project changes.

- [ ] **Step 3: Inspect coupled behavior**

Review:

```bash
rg -n "getChat|answerInlineQuery|answerCbQuery|sendMessage|editMessage|\\.reply\\(" src
rg -n "checkRateLimit|checkDraftRateLimit|rate_limited|errors_rate_limit" src test
rg -n "resolvedTargetId|targetNormalized|consumeSecret|restoreSecret" src test
```

Expected:

- username resolution has no `getChat('@username')`;
- eligible application calls use the scheduler;
- invalid and target-only typing bypasses rate charging;
- Telegram flood waits are not counted as local user rate-limit errors;
- callback authorization remains ID-based;
- one-time reads remain atomic.

- [ ] **Step 4: Fix only reproduced gaps**

For each gap, first add a focused failing regression test, verify RED, apply the
smallest owning-layer fix, verify GREEN, run the full gate, then commit and
push with a short English message describing only that correction.

If no gap is reproduced, create no audit-only commit.

- [ ] **Step 5: Verify remote synchronization**

Run:

```bash
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short --branch
git log --oneline --decorate -8
```

Expected: local `HEAD` equals `origin/main`, the worktree is clean, and every
implementation commit is visible in the pushed history.

No deployment or production restart is authorized by this plan.
