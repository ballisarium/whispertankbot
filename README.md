# whisper bot

Inline Telegram bot for sending short secret messages.

- `@bot @username text` — verified recipient can read once; the author can also open their own secret
- `@bot text @username` — everyone except the verified recipient can read
- `@bot 123456789 text` — use a numeric Telegram user ID when username cannot be verified safely
- secrets expire after 6 hours
- max secret length: 200 characters
- multilingual: en / ru / uk
- optional Redis storage
- optional stats collection and daily reports for admins

Username targets are allowed only when the bot can safely resolve the username to a Telegram user ID. If the bot cannot verify a username, ask that user to start the bot or use their numeric user ID.

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
