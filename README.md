# whisper bot

inline telegram bot for sending secret messages.

- `@bot @username text` — only @username can read
- `@bot text @username` — everyone except @username can read
- secrets expire after 6 hours
- multilingual: en / ru / uk
- optional daily stats for admins

## setup

```bash
# install redis (optional but recommended)
sudo apt install -y redis-server
sudo systemctl start redis-server

# install dependencies
npm install

# configure
cp .env.example .env
nano .env

# run
npm start
```

## env

| variable | required | description |
|---|---|---|
| `BOT_TOKEN` | yes | token from @BotFather |
| `BOT_USERNAME` | no | bot username without @ |
| `REDIS_URL` | no | e.g. `redis://localhost:6379` |
| `STATS_ENABLED` | no | set `true` to enable daily reports |
| `STATS_TIMEZONE` | no | e.g. `Europe/Kyiv` (default: UTC) |
| `STATS_SEND_AT` | no | time to send report, e.g. `09:00` |
| `ADMIN_ID` | no | telegram user id to receive reports |
| `ADMIN_IDS` | no | comma-separated list of admin ids |

without redis, secrets and stats are stored in memory and lost on restart.

## by @blaar × @club5926
