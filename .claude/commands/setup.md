---
description: Pick your habits, connect your apps, and deploy Habits
---

Walk the person through setting up Habits. One step at a time, say what each step does in one plain sentence, and wait for them before moving on. Define technical words the first time.

1. **Check tools.** `node --version` (22 or newer for the tests). If `node_modules/` is missing, run `npm install`.

2. **Find their apps.** Ask which companion kits they've deployed: Family Map, The Garden, 1,000 Nights, Workout Log, Voice Memo Journal. Habits can only track those. If they have none, suggest setting one up first and stop here.

3. **Interview them**, one question at a time:
   - Which habits should count. Ids: `family`, `garden`, `nights`, `workout`, `dailylog`.
   - Time zone (turn a city into an IANA name for them) and the nudge hour (0 to 23; 20 means 8 p.m.).
   - If `family` is on: memories per day (default 5), and their Family Map person id (`me` if they used that kit's setup).
   - Each chosen app's URL (for the row links).
   - Database ids: run `npx wrangler login` (if needed) and `npx wrangler d1 list`, then match the names (`family-map`, `the-garden`, `thousand-nights`, `workout-log`). Create this app's own with `npx wrangler d1 create habits`.
   - Their email, for push services to contact them (it goes in `wrangler.jsonc` as `mailto:`).

4. **Write `setup.json`**:
   ```json
   { "habits": [], "timeZone": "", "nudgeHour": 20, "familyTarget": 5, "me": "me",
     "urls": { "family": "", "garden": "", "nights": "", "workout": "", "dailylog": "" },
     "databaseIds": { "habits": "", "family": "", "garden": "", "nights": "", "workout": "" },
     "email": "", "localDev": true }
   ```
   Confirm it with them.

5. **Apply:** `npm run setup -- --apply`. It writes `src/setup.js`, binds only their chosen databases in `wrangler.jsonc`, and makes push keys in `private/` (git-ignored). Optional local look: `npm run seed && npm run dev`.

6. **Deploy** (when they say go):
   - `npx wrangler d1 migrations apply habits --remote`
   - Secrets, which they type themselves: `HABITS_PASSCODE`, `SESSION_SECRET`, `VICES_PASSCODE`, `DAILYLOG_INGEST_SECRET`, `SCREENTIME_INGEST_SECRET`, each with `npx wrangler secret put <NAME>`.
   - `VAPID_PRIVATE_JWK`: they paste the one line from `private/vapid-private.jwk.json`.
   - `npm run deploy`

7. **Phone:** open the URL in Safari, then Share, then Add to Home Screen. Open it from the home screen and allow notifications (iOS only allows push for home-screen apps).

8. If they use Voice Memo Journal: point its `HABITS_INGEST_URL` at `/api/ingest/dailylog` and match the secret (README.md "Optional connections").

End with three lines: what's tracked, where to switch habits later (Settings), and how to redeploy.
