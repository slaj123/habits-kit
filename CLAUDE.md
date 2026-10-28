# Habits: notes for Claude Code

A daily habit page that fills itself in by reading other kits' D1 databases (Family Map, The Garden, 1,000 Nights, Workout Log) plus Daily Log pings from Voice Memo Journal. One Worker (`src/worker.js`) with an hourly cron for the push nudge. See README.md.

## If the person wants to set it up

Run the `/setup` command (`.claude/commands/setup.md`). Habits only makes sense after at least one companion app is deployed, so ask which ones they have first. Assume they may never have used a terminal. Explain each step in one line before running it.

## Where personal choices live

- `src/setup.js` (written from `setup.json`): which habits count, time zone, nudge hour, family target, their Family Map person id (`me`), and each app's link.
- `wrangler.jsonc`: `npm run setup` rewrites `d1_databases` to bind only the chosen apps, and sets `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT`. A habit can only be on if its binding exists. Without one, the Worker never touches that app.
- In-app Settings: habit switches, family target, nudge hour, time zone. Saved in D1 `settings`, and they win over `src/setup.js`.
- `private/` (git-ignored): the push key pair. The private half goes up with `wrangler secret put VAPID_PRIVATE_JWK`. Never commit it or paste it in chat.
- The "cut back" tracker list is `VICES` in `src/habits.js`, `VICE_ROWS` in `public/app.js` and the `CHECK` in `migrations/0003_vices.sql`. Change all three together.

## Checks before calling anything done

- `npm test` (Node 22+: uses `node:sqlite`). The "workout Error: gone" line is an intentional simulated outage.
- `npm run seed && npm run dev` for a local look with fake data.
