# Telegram Resilience Design

## Goal

Make inline whisper creation and Telegram API delivery resistant to false local
rate limits and real Telegram flood control without removing, simplifying, or
changing the bot's existing user-facing features.

## Current behavior and root cause

Telegram sends a new inline query update while a user is typing. The current
handler charges every update against a fixed limit of 10 requests per minute
before it parses the query. Empty, incomplete, and invalid drafts therefore
consume the same budget as a complete whisper.

After parsing a username target, the handler also calls `getChat` for every
updated query. The Bot API cannot be treated as a general username-to-user-ID
directory, and repeated lookups add avoidable API load. Numeric targets cause
another `getChat` call on every update to build a display label.

The current code has no shared scheduling or retry boundary for outbound Bot
API calls. Telegraf exposes Telegram flood-control errors with status `429` and
`parameters.retry_after`, but ordinary calls are not retried by the application.

## Scope and invariants

- Preserve all current commands, inline syntax, languages, statistics, access
  rules, secret lifetime, optional Redis fallback, and one-time target read.
- Keep recipient authorization ID-based. A username match alone must never
  reveal a secret.
- Do not add user-facing features such as remembered recipients, `@me`, group
  whisper commands, media whispers, recall controls, or a second result type.
- Do not add a production dependency.
- Do not contact Telegram or require real credentials during automated tests.
- Keep polling as the startup mode and Telegraf 4.16.3 as the framework.
- Deliver each coherent change as a separate short English commit followed by
  an immediate push.

## Considered approaches

### Minimal call reduction

Move the existing limit after parsing and remove username `getChat` calls.
This addresses the reported symptom but leaves real `429` responses and other
temporary Bot API failures unmanaged.

### In-process resilience layer

Add observed-user and profile caches, draft-aware rate accounting, and a
priority scheduler that classifies retries by outcome certainty. This covers
the full failure surface without changing infrastructure or user-visible
behavior.

This is the selected approach.

### Durable distributed queue

Store every Telegram operation in Redis and recover it after restarts. This is
appropriate for long-running batch jobs or multiple active bot replicas, but it
would add persistence semantics and delivery-latency risks that this
request-response bot does not currently need.

## Architecture

### Observed user directory

A new user-directory helper stores normalized username-to-user-ID mappings and
optional display data. It learns only from Telegram updates that include both
the user's ID and username:

- `/start`, commands, and private messages;
- inline query authors;
- callback query actors.

Redis entries use a 30-day TTL. The in-memory fallback uses the same expiry
contract and periodic cleanup. Learning a renamed user removes the previous
mapping when the old username is known locally, while every lookup verifies
that the stored normalized username matches the requested value.

Username targets are resolved from this directory. If no verified mapping is
available, the existing unavailable-target result is returned. Callback access
continues to compare the actor's ID with the stored resolved target ID.

### Profile lookup cache

Numeric target display data is cached by user ID for 24 hours. A cache hit
avoids `getChat`; a miss performs a scheduled read and stores only private-user
label data. Failed lookups keep the existing ID-based labels and are not cached
as successful profiles.

The cache is an optimization only. It cannot change recipient authorization or
prevent a numeric-ID whisper from being created.

### Draft-aware local rate limiting

Parsing happens before rate accounting.

- Empty, incomplete, invalid, and target-only queries cost zero.
- A draft lineage is identified by author, normalized target, and target mode.
- The first complete query in a lineage costs one unit.
- For 15 seconds after the latest update in that lineage, an exact repeat or a
  text edit where either the previous text or the new text is a prefix of the
  other costs zero. This treats ordinary character-by-character typing as one
  draft.
- A non-prefix replacement or a complete query after the 15-second draft
  window costs one unit.
- The existing 10-per-minute user-facing threshold and localized response are
  retained.

The Redis implementation performs check, increment, deduplication, and expiry
atomically in one Lua script. The memory implementation follows the same
contract. If Redis is unavailable, the existing in-memory fallback remains in
effect.

### Telegram request scheduler

A small in-process scheduler owns application Bot API calls. It has three
isolated classes of work:

- `interactive`: `answerInlineQuery` and `answerCbQuery`, processed immediately
  with up to 16 concurrent calls and never delayed by delivery pacing;
- `delivery`: `sendMessage` and message edits, limited to one operation per
  second for the same chat and 30 operations per second globally;
- `lookup`: read-only profile calls, deduplicated by user ID and limited to
  eight concurrent calls without message-delivery pacing.

Delivery pacing follows Telegram's published free-bot guidance while keeping
unrelated chats independent. Waiting jobs use timers and yield the event loop.
Each work class accepts at most 1,000 waiting jobs; overload returns a
classified local error instead of growing memory without limit.

Handlers retain responsibility for rendering localized user responses.
The scheduler returns success or a typed failure and does not swallow errors.

### Retry and outcome rules

The server-provided `retry_after` value is authoritative for Telegram `429`.
The rejected operation is rescheduled after that delay and retried once.

Read-only operations may also retry once after a network error or Telegram
`5xx`, using a one-second backoff.

Mutating operations follow outcome certainty:

- A Telegram response with `429` explicitly rejects the requested operation,
  so one retry is allowed after `retry_after`.
- A `5xx`, local connection error, or timeout can be ambiguous for a mutating
  operation because the remote side may have completed it before the response
  failed.
- `sendMessage` and message edits are not retried after an ambiguous outcome,
  preventing duplicates.
- Callback and inline-query answers are tied to unique update IDs. They may
  retry only after an explicit Telegram rejection and only while their request
  remains useful.
- Permanent `4xx` errors are returned immediately.

The global Telegraf error hook logs classification, method, update ID, and safe
metadata without secret text, raw environment values, tokens, or complete API
payloads.

## Data flow

For an inline query:

1. Learn the author in the observed-user directory.
2. Load language settings and parse the query.
3. Return usage guidance immediately for an incomplete or invalid query.
4. Resolve a username from the verified directory, or use the numeric ID.
5. Check the draft-aware local limit for a complete query.
6. Resolve display labels through the profile cache when necessary.
7. Create the secret using the existing storage and access contract.
8. Track the existing statistics.
9. Submit the inline answer through the interactive scheduler.

For a callback:

1. Learn the actor.
2. Load and authorize the secret using the existing ID-based rules.
3. Consume a target-only secret atomically as today.
4. Deliver the callback alert or long-message fallback through the scheduler.
5. Restore a consumed secret if Telegram explicitly rejects delivery.
6. Preserve the current no-blind-retry behavior for ambiguous long-message
   outcomes.

## Error handling

- Cache failures degrade to existing uncached behavior.
- Redis failures continue to use the memory fallback and emit a sanitized log.
- A local queue-overload error is logged as a distinct sanitized transport
  failure and returned to the owning handler instead of being mislabeled as
  storage or user rate limiting.
- Real flood waits are tracked separately from the local user rate limit so
  statistics do not mislabel Telegram `429` as user abuse.
- Shutdown stops accepting new scheduled work, rejects queued work, clears
  timers, and gives already running calls five seconds to settle before
  resources close.

## Testing and validation

Every behavior change follows a failing-test-first cycle.

Focused coverage will prove:

- incomplete typing does not consume the local limit;
- ordinary character-by-character edits of one complete draft cost one unit;
- distinct complete drafts still reach the existing threshold;
- memory and Redis limiter contracts match;
- learned usernames resolve to IDs and expire;
- unknown usernames never gain username-only access;
- cached numeric profiles avoid repeated `getChat` calls;
- interactive requests bypass delivery pacing;
- `429` uses the exact `retry_after` delay and retries once;
- permanent failures are not retried;
- ambiguous mutating failures are not retried;
- queue overload and shutdown settle callers without unhandled rejections;
- existing callback consumption, localization, statistics, parsing, and menu
  behavior remain unchanged.

Before each commit and push, run the focused test file, the full `npm test`
suite, JavaScript syntax checks for `src`, and `git diff --check`. The final
audit repeats all checks from a clean worktree and verifies that local `main`,
`origin/main`, and the pushed commit are identical.

## Delivery sequence

1. Add the observed-user directory and remove per-keystroke username API
   resolution.
2. Rework local rate accounting around complete unique drafts.
3. Add the prioritized Telegram request scheduler.
4. Add outcome-aware flood-wait and temporary-error retries.
5. Add numeric profile caching and route remaining eligible API calls through
   the scheduler.
6. Run the full requirement-by-requirement regression audit and fix any
   independently discovered defect in its own commit.

No deployment or production restart is included in this scope.
