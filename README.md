# whisper bot

Inline Telegram bot for sending short secret messages.

- `@bot @username text` — only that recipient can read once; the author can also open their own secret
- `@bot text @username` — everyone except that recipient can read
- `@bot 123456789 text` — target a numeric Telegram user ID (also `id:123456789` or `@123456789`)
- `@bot @me text` — target yourself
- secrets expire after 6 hours
- max secret length: 200 characters
- multilingual: en / ru / uk
- optional Redis storage
- optional stats collection and daily reports for admins

Username targets are resolved to a Telegram user ID whenever the bot has learned that username from a recent interaction, and the resolved ID is stored with the secret so the recipient stays the same even if they later change or drop their username. The bot learns usernames from any user it observes, including the author of a replied-to message, and it learns all active usernames returned for that user by Telegram, refreshing the list at most once every 24 hours. Username mappings expire after 30 days.

When a username is still unknown at creation time, the secret is created anyway and the recipient is matched against the username Telegram reports when they tap the button. That match is by username rather than user ID, so a username transferred to someone else within the 6 hour secret lifetime would match the new holder.

Display names resolved for numeric user IDs are cached for 24 hours to avoid repeated Telegram profile lookups. This display cache does not affect recipient authorization.

## setup

```bash
# install dependencies
npm install

# configure
cp .env.example .env
nano .env

# run
npm start
```

Redis is optional. Without Redis, secrets, user settings, rate limits, and stats are stored in memory and are lost on restart.

## checks

```bash
npm test
for f in $(find src -name '*.js' -print); do node --check "$f"; done
```

## env

| variable | required | description |
|---|---|---|
| `BOT_TOKEN` | yes | token from @BotFather |
| `BOT_USERNAME` | no | bot username without `@`; invalid values fall back to generic hints |
| `REDIS_URL` | no | e.g. `redis://localhost:6379`; Redis is used only while reachable |
| `STATS_ENABLED` | no | set `true` to collect stats and enable daily report scheduling |
| `STATS_TIMEZONE` | no | e.g. `Europe/Kyiv`; invalid values fall back to `UTC` |
| `STATS_SEND_AT` | no | local time for daily report, e.g. `09:00`; invalid values fall back to `09:00` |
| `ADMIN_ID` | no | Telegram user ID allowed to run `/stats` and receive reports |
| `ADMIN_IDS` | no | comma-separated admin IDs; if empty, `ADMIN_ID` is used |

## stats

`/stats` is admin-only.

```text
/stats
/stats 2026-06-17
```

Stats are collected only when `STATS_ENABLED=true`. Daily reports are sent only when stats are enabled and at least one admin ID is configured.

## by @blaar x @club5926
