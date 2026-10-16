# whisper bot

inline telegram bot for short secret messages, built with grammy.

- `@bot @username text` — only that recipient can read once; the author can also open their own secret
- `@bot text @username` — everyone except that recipient can read
- `@bot 123456789 text` — target a numeric telegram user id (also `id:123456789` or `@123456789`)
- `@bot @me text` — target yourself
- secrets expire after 6 hours
- max secret length: 200 characters
- multilingual: en / ru / uk
- optional redis storage
- optional stats collection and daily reports for admins

known usernames are saved with a telegram user id, so a secret stays with its recipient if they change or remove their username. the bot learns from users it observes, including authors of replied-to messages, and refreshes their active usernames at most once every 24 hours. username mappings expire after 30 days.

unknown usernames are checked when someone taps the button. if a username changes owners during the secret's 6-hour lifetime, the new owner can match it.

display names for numeric user ids are cached for 24 hours. this cache doesn't affect who can read a secret.

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

redis is optional. without redis, secrets, user settings, rate limits, and stats are stored in memory and are lost on restart.

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
| `REDIS_URL` | no | e.g. `redis://localhost:6379`; redis is used only while reachable |
| `STATS_ENABLED` | no | set `true` to collect stats and enable daily report scheduling |
| `STATS_TIMEZONE` | no | e.g. `Europe/Kyiv`; invalid values fall back to `UTC` |
| `STATS_SEND_AT` | no | local time for daily report, e.g. `09:00`; invalid values fall back to `09:00` |
| `ADMIN_ID` | no | telegram user id allowed to run `/stats` and receive reports |
| `ADMIN_IDS` | no | comma-separated admin ids; if empty, `ADMIN_ID` is used |

## stats

`/stats` is admin-only.

```text
/stats
/stats 2026-06-17
```

stats are collected only when `STATS_ENABLED=true`. daily reports are sent only when stats are enabled and at least one admin id is configured.

## by @blaar x @club5926
