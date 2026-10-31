# Habits

A one-page daily habit tracker that fills itself in. You never tick a box: it reads your other apps and shows what you've done today, keeps a streak, and sends one push notification in the evening if anything is still open.

This is a **setup kit** that pairs with the other kits. **You choose which habits count**, so use one app or all five. Deploy the ones you want first; Habits reads their databases:

| Habit | Reads from | Done when |
| --- | --- | --- |
| Family | [family-map-kit](https://github.com/slaj123/family-map-kit) | You added 5 or more memories today (the target is adjustable) |
| Garden | [the-garden-kit](https://github.com/slaj123/the-garden-kit) | You planted someone new today **and** logged a conversation with that same person |
| Reading | [thousand-nights](https://github.com/slaj123/thousand-nights) | Tonight's poem, story and essay are all checked |
| Workout | [workout-log](https://github.com/slaj123/workout-log) | At least one session is logged |
| Daily Log | [voice-memo-journal](https://github.com/slaj123/voice-memo-journal) | A Daily Log voice memo arrived (one recorded before noon counts for the day before) |

A day runs until 3 a.m. in your time zone, so staying up late still counts. The streak breaks on any miss of a habit you've turned on. Turn habits on or off any time in Settings. In Settings, **I'm out of people** retires the Garden habit from that day on.

It also has:
- a small to-do list;
- a screen-time log, filled by an iPhone Shortcut or typed in;
- a private "cut back" tracker (drinks, smoking, sweets, doomscrolling) behind a second passcode. It is never part of the streak or the push. Edit the list to suit you.

Built as one Cloudflare Worker with a cron trigger, its own D1 database, and read-only access to the other apps' D1 databases. It runs on Cloudflare's free plan.

## What you need

- [Node.js](https://nodejs.org) 22 or newer (the tests use the built-in `node:sqlite`)
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account, the **same one** your other kits are deployed to

## 1. Install and test

```bash
git clone https://github.com/<your-username>/habits-kit.git
cd habits-kit
npm install
npm test
```

**On Windows:** if a `wrangler` step fails with "internal error", the folder path is probably too long (Windows caps paths at 260 characters, and the local database adds a lot). Move the folder somewhere short, like `C:\code\habits-kit`, and run the step again.

## 2. Make it yours

```bash
npm run setup
```

It asks:
- which habits count;
- your time zone and nudge hour;
- your family target and your Family Map id (if you track Family);
- each app's link;
- each app's database id (run `npx wrangler d1 list` to see them, or leave them blank for now);
- your email for push notifications.

Then it:
- saves your answers in `setup.json` (git-ignored);
- writes `src/setup.js`;
- binds **only the databases for your chosen habits** in `wrangler.jsonc`;
- creates your push-notification keys in `private/` (git-ignored);
- with local testing on, writes `.dev.vars` with random local passcodes.

Try it with fake data:

```bash
npm run seed
npm run dev
```

Open http://localhost:8787 and log in with the passcode in `.dev.vars`.

**Change it later:** in the app, open **Settings** to switch habits on or off, change the family target, nudge hour or time zone. Only apps bound in `wrangler.jsonc` can be switched on; rerun `npm run setup` to connect another.

**Set up with Claude Code:** open this folder in [Claude Code](https://claude.com/claude-code) and type `/setup`. It finds your databases with you, applies everything, and walks you through deploying.

## 3. Deploy

1. Create this app's own database if you haven't (`npx wrangler d1 create habits`). Put its id in setup, or paste it into `wrangler.jsonc`. Then create its tables:
   ```bash
   npx wrangler d1 migrations apply habits --remote
   ```
2. Set the secrets. Each command asks for a value:
   ```bash
   npx wrangler secret put HABITS_PASSCODE
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put VAPID_PRIVATE_JWK
   npx wrangler secret put VICES_PASSCODE
   npx wrangler secret put DAILYLOG_INGEST_SECRET
   npx wrangler secret put SCREENTIME_INGEST_SECRET
   ```
   - `HABITS_PASSCODE`: 12 or more characters.
   - `SESSION_SECRET`: 32 or more random characters.
   - `VAPID_PRIVATE_JWK`: paste the single line from `private/vapid-private.jwk.json`.
   - Ingest secrets: 24 or more random characters each.

   Random values:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```

On iPhone, open the URL in Safari, tap **Share**, then **Add to Home Screen**. Open it from the home screen and allow notifications. iOS only allows web push for home-screen apps.

## Optional connections

- **Daily Log:** in voice-memo-journal, set `HABITS_INGEST_URL` to `https://<your-habits-url>/api/ingest/dailylog`, and set its `HABITS_INGEST_SECRET` to the same value as `DAILYLOG_INGEST_SECRET` here.
- **Screen Time Shortcut:** an iPhone Shortcut can `POST https://<your-habits-url>/api/ingest/screentime` with the header `X-Ingest-Secret: <SCREENTIME_INGEST_SECRET>` and body `{ "minutes": "4h 12m" }`. Plain numbers, `4:12` and `4.2 hours` also work.

## Changing things

- **Which habits count, family target, time zone, nudge hour:** the app's Settings.
- **Connect another app:** rerun `npm run setup` (it rebinds `wrangler.jsonc`), then `npm run deploy`.
- **The cut-back list:** edit `VICES` in `src/habits.js`, `VICE_ROWS` in `public/app.js`, and the `CHECK` list in `migrations/0003_vices.sql` together.
- **Redeploy:** `npm run deploy`.

## License

MIT. See `LICENSE`.
