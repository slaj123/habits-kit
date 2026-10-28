# Habits

A one-page daily habit tracker that fills itself in. You never tick a box: it reads your other apps and shows what you've done today, keeps a streak, and sends one push notification in the evening if anything is still open.

This is a **setup kit** that pairs with four other kits. Deploy the ones you want first, then point Habits at their databases:

| Habit | Reads from | Done when |
| --- | --- | --- |
| Family | [family-map-kit](https://github.com/slaj123/family-map-kit) | You added 5 or more memories today (the target is adjustable) |
| Garden | [the-garden-kit](https://github.com/slaj123/the-garden-kit) | You planted someone new today **and** logged a conversation with that same person |
| Reading | [thousand-nights](https://github.com/slaj123/thousand-nights) | Tonight's poem, story and essay are all checked |
| Workout | [workout-log](https://github.com/slaj123/workout-log) | At least one session is logged |
| Daily Log | [voice-memo-journal](https://github.com/slaj123/voice-memo-journal) | A Daily Log voice memo arrived (one recorded before noon counts for the day before) |

A day runs until 3 a.m. in your time zone, so staying up late still counts. The streak breaks on any miss. In Settings, **I'm out of people** retires the Garden habit from that day on.

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

## 2. Try it locally with fake data

Create `.dev.vars` (git-ignored):

```
HABITS_PASSCODE=local-test-passcode
SESSION_SECRET=any-random-string-at-least-32-characters-long
VICES_PASSCODE=another-local-passcode
```

Fill the local databases with two weeks of made-up activity, then start it:

```bash
npm run seed
npm run dev
```

Open http://localhost:8787.

## 3. Connect your apps

Each habit needs the D1 database of the app it reads. List your databases and their ids:

```bash
npx wrangler login
npx wrangler d1 list
```

In `wrangler.jsonc`, replace each `REPLACE_WITH_..._DB_ID` with the matching id. If you don't use one of the apps, still create an empty database for it (`npx wrangler d1 create <name>`), so the binding exists. That habit will simply never be done.

In `public/app.js`, set the URLs in `APPS` so each row links to its app.

**Family habit:** only memories added by your person id count. The Worker uses `const ME = "me"` in `src/worker.js`. Make sure your row in the Family Map `people` table has id `me`, or change `ME` to your id.

## 4. Push notification keys

Web Push needs a key pair. Generate one:

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});console.log('VAPID_PUBLIC_KEY='+k.publicKey.export({format:'der',type:'spki'}).subarray(-65).toString('base64url'));console.log('VAPID_PRIVATE_JWK='+JSON.stringify(k.privateKey.export({format:'jwk'})))"
```

- Paste the public key into `VAPID_PUBLIC_KEY` in `wrangler.jsonc`. It is safe to publish.
- Set `VAPID_SUBJECT` to `mailto:` plus your email. Push services use it to contact you about problems.
- Keep the private key for step 5. Never commit it.

## 5. Deploy

1. Create this app's own database and its tables:
   ```bash
   npx wrangler d1 create habits
   ```
   Put the id into the first entry in `wrangler.jsonc`, then:
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
   - `VAPID_PRIVATE_JWK`: the whole JSON line from step 4.
   - The two ingest secrets: 24 or more random characters each.

   To generate a random value:
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

- **Time zone and nudge hour:** in the app's Settings. Defaults are in `DEFAULTS` in `src/habits.js`.
- **Family target** (memories per day): `familyTarget` in `DEFAULTS` in `src/habits.js`.
- **The cut-back list:** edit `VICES` in `src/habits.js`, `VICE_ROWS` in `public/app.js`, and the `CHECK` list in `migrations/0003_vices.sql` together.
- **Redeploy:** `npm run deploy`.

## License

MIT. See `LICENSE`.
