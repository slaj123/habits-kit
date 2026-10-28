// npm run setup: choose which habits count, connect their apps, and make push keys.
// Writes setup.json (your answers, git-ignored), src/setup.js, and the database
// bindings + push public key in wrangler.jsonc.
// `npm run setup -- --apply` skips the questions and applies setup.json as-is.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { APPLY_ONLY, loadSetup, saveSetup, ask, askNumber, askPick, askTimeZone, askYesNo, done } from "./lib/setup-kit.mjs";
import CURRENT from "../src/setup.js";

const NAMES = { family: "Family (Family Map kit)", garden: "Garden (The Garden kit)", nights: "Reading (1,000 Nights kit)",
  workout: "Workout (Workout Log kit)", dailylog: "Daily Log (Voice Memo Journal kit)" };
const ALL = Object.keys(NAMES);
const DB = { family: ["FAMILY_DB", "family-map"], garden: ["GARDEN_DB", "the-garden"], nights: ["NIGHTS_DB", "thousand-nights"], workout: ["WORKOUT_DB", "workout-log"] };

const s = loadSetup("setup.json", { ...CURRENT, databaseIds: {}, email: "", localDev: true });

if (!APPLY_ONLY) {
  console.log("Habits setup. Press Enter to keep the value in [brackets].");
  console.log("Each habit reads another kit's database, so pick only the apps you've deployed (or will).\n");
  const picked = await askPick("Which habits should count?", ALL.map((h) => NAMES[h]), s.habits.map((h) => NAMES[h]));
  s.habits = ALL.filter((h) => picked.includes(NAMES[h]));
  s.timeZone = await askTimeZone(s.timeZone);
  s.nudgeHour = await askNumber("Hour for the evening nudge, 0-23 (20 = 8 p.m.)", s.nudgeHour, { min: 0, max: 23 });
  if (s.habits.includes("family")) {
    s.familyTarget = await askNumber("Family memories to add per day", s.familyTarget, { min: 1, max: 50 });
    s.me = await ask("Your person id in Family Map (setup there makes you \"me\")", s.me);
  }
  console.log("\nLinks: each habit row opens its app. Paste each app's URL, or leave blank.");
  for (const h of s.habits) s.urls[h] = await ask(`  ${NAMES[h]} URL`, s.urls[h] || "");
  console.log("\nDatabase ids: run `npx wrangler d1 list` to see them. Leave blank to fill in later.");
  for (const h of s.habits.filter((h) => DB[h])) s.databaseIds[h] = await ask(`  ${DB[h][1]} database id`, s.databaseIds[h] || "");
  s.databaseIds.habits = await ask("  This app's own database id (from `npx wrangler d1 create habits`)", s.databaseIds.habits || "");
  s.email = await ask("Your email, for push services to contact if something goes wrong (stays in wrangler.jsonc)", s.email);
  s.localDev = await askYesNo("Set up local testing too (random local passcodes)?", s.localDev);
  saveSetup("setup.json", s);
}
done();

if (!s.habits.length) { console.error("Pick at least one habit."); process.exit(1); }

// 1. src/setup.js: what the Worker and page start from.
const app = { habits: s.habits, timeZone: s.timeZone, nudgeHour: s.nudgeHour, familyTarget: s.familyTarget, me: s.me || "me",
  urls: Object.fromEntries(ALL.map((h) => [h, s.habits.includes(h) ? (s.urls[h] || "").replace(/\/+$/, "") : ""])) };
writeFileSync("src/setup.js",
  "// Your habits. Written by `npm run setup` (or Claude Code's /setup) from setup.json.\n" +
  "// Turning habits on and off, time zone and nudge hour can also be changed in the app's Settings,\n" +
  "// which win over this file. A habit can only be on if its app's database is bound in wrangler.jsonc.\n" +
  `export default ${JSON.stringify(app, null, 2)};\n`);
console.log("Wrote src/setup.js.");

// 2. Push keys: made once. The private half is a secret and never goes in wrangler.jsonc.
mkdirSync("private", { recursive: true });
let publicKey = existsSync("private/vapid-public.txt") ? readFileSync("private/vapid-public.txt", "utf8").trim() : "";
if (!publicKey) {
  const k = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  publicKey = k.publicKey.export({ format: "der", type: "spki" }).subarray(-65).toString("base64url");
  writeFileSync("private/vapid-public.txt", publicKey + "\n");
  writeFileSync("private/vapid-private.jwk.json", JSON.stringify(k.privateKey.export({ format: "jwk" })) + "\n");
  console.log("Made push keys in private/ (git-ignored).");
}

// 3. wrangler.jsonc: only the databases you use, your push public key and contact.
let w = readFileSync("wrangler.jsonc", "utf8");
const id = (x) => s.databaseIds[x] || `REPLACE_WITH_${x.toUpperCase()}_DB_ID`;
const lines = [
  `    { "binding": "DB", "database_name": "habits", "database_id": "${id("habits")}", "migrations_dir": "migrations" }`,
  ...s.habits.filter((h) => DB[h]).map((h) => `    { "binding": "${DB[h][0]}", "database_name": "${DB[h][1]}", "database_id": "${id(h)}" }`),
];
w = w.replace(/"d1_databases": \[[\s\S]*?\n  \]/, `"d1_databases": [\n    // DB is this app's own store. The others are your apps, read-only: this Worker only runs SELECTs on them.\n${lines.join(",\n")}\n  ]`);
w = w.replace(/"VAPID_PUBLIC_KEY": "[^"]*"/, `"VAPID_PUBLIC_KEY": "${publicKey}"`);
if (s.email) w = w.replace(/"VAPID_SUBJECT": "[^"]*"/, `"VAPID_SUBJECT": "mailto:${s.email}"`);
writeFileSync("wrangler.jsonc", w);
console.log("Updated wrangler.jsonc (databases, push key).");
const missing = [...s.habits.filter((h) => DB[h] && !s.databaseIds[h]), ...(s.databaseIds.habits ? [] : ["habits"])];
if (missing.length) console.log(`  Still to fill in: database ids for ${missing.join(", ")} (rerun setup, or edit wrangler.jsonc).`);

if (s.localDev && !existsSync(".dev.vars")) {
  const r = (n) => randomBytes(n).toString("base64url");
  const passcode = r(12);
  writeFileSync(".dev.vars", `HABITS_PASSCODE=${passcode}\nSESSION_SECRET=${r(32)}\nVICES_PASSCODE=${r(12)}\n` +
    `DAILYLOG_INGEST_SECRET=${r(24)}\nSCREENTIME_INGEST_SECRET=${r(24)}\nVAPID_PRIVATE_JWK=${readFileSync("private/vapid-private.jwk.json", "utf8").trim()}\n`);
  console.log(`Wrote .dev.vars (git-ignored). Your LOCAL passcode is: ${passcode}`);
  console.log("Try it with fake data: `npm run seed`, then `npm run dev`.");
}
console.log("\nTo put it online, follow \"Deploy\" in README.md (or ask Claude Code: /setup).");
console.log("The push secret to upload is in private/vapid-private.jwk.json: `npx wrangler secret put VAPID_PRIVATE_JWK` and paste its one line.");
