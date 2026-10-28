// Fills the LOCAL copies of the four app databases (under .wrangler/) with
// made-up data for the last two weeks, so `wrangler dev` has something to show.
// Never touches the real (remote) databases.
// Run: node scripts/seed-local.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import SETUP from "../src/setup.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const run = (...args) => execFileSync(process.execPath, [wrangler, ...args], { cwd: here, stdio: ["ignore", "ignore", "inherit"] });

const tz = "America/Los_Angeles";
const day = (offset) => new Date(Date.now() + offset * 86400e3).toLocaleDateString("en-CA", { timeZone: tz });
const at = (offset, hhmm) => new Date(`${day(offset)}T${hhmm}:00-07:00`).toISOString();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

mkdirSync(".wrangler/seed", { recursive: true });
const sql = { "family-map": [], "the-garden": [], "thousand-nights": [], "workout-log": [] };

sql["family-map"].push("INSERT OR IGNORE INTO people (id,name,initial,kind,sort) VALUES ('me','Me','M','person',4),('mom','Mom','M','person',1);");
sql["family-map"].push("INSERT OR IGNORE INTO places (id,name,lat,lng) VALUES ('p1','Somewhere',0,0);");
const names = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indy", "Jules", "Kai", "Lane", "Marlow", "Noor"];
for (let o = -13; o <= 0; o++) {
  const fam = o === 0 ? 3 : o === -4 ? 2 : 5 + (o % 2 ? 0 : 1);
  for (let i = 0; i < fam; i++) {
    sql["family-map"].push(`INSERT OR REPLACE INTO memories (id,place_id,title,category,date_start,created_by,created_at) VALUES (${q(`seed${o}-${i}`)},'p1','Seed','travel','2020-01-01','me',${q(at(o, `1${i}:00`))});`);
  }
  const p = { name: names[o + 13], createdAt: at(o, "09:00"), conversations: o === 0 || o === -6 ? [] : [{ date: at(o, "18:30"), method: "Phone" }] };
  sql["the-garden"].push(`INSERT OR REPLACE INTO plants (id,data,updated_at) VALUES (${q("seed" + (o + 13))},${q(JSON.stringify(p))},${q(p.createdAt)});`);
  if (o < 0 && o !== -9) {
    for (const s of ["poem", "story", "essay"]) {
      const n = o + 14;
      sql["thousand-nights"].push(`INSERT OR REPLACE INTO checks (key,kind,item_id,date,day_number,checked,ts,seq) VALUES (${q(`d${String(n).padStart(3, "0")}-${s}`)},'full',${q(s)},${q(day(o))},${n},1,0,1);`);
    }
  }
  if (o === 0) sql["thousand-nights"].push(`INSERT OR REPLACE INTO checks (key,kind,item_id,date,day_number,checked,ts,seq) VALUES ('d014-poem','full','poem',${q(day(0))},14,1,0,1);`);
  if (o !== -2) sql["workout-log"].push(`INSERT OR REPLACE INTO sessions (id,date,type,source,data,created_at,updated_at) VALUES (${q("seed" + o)},${q(day(o))},${q(o % 3 ? "lifting" : "surf")},'form','{}',${q(at(o, "07:00"))},${q(at(o, "07:00"))});`);
}

// Each companion app's tables, from the copies the tests use.
const migrations = { "family-map": "family", "the-garden": "garden", "thousand-nights": "nights", "workout-log": "workout" };
// Only the apps whose habits are on (their databases are the ones bound in wrangler.jsonc).
const habitOf = { "family-map": "family", "the-garden": "garden", "thousand-nights": "nights", "workout-log": "workout" };
for (const [db, app] of Object.entries(migrations)) {
  if (!SETUP.habits.includes(habitOf[db])) continue;
  const dir = fileURLToPath(new URL(`../test/migrations/${app}/`, import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try { run("d1", "execute", db, "--local", "--file", dir + f); } catch { /* already applied */ }
  }
  writeFileSync(`.wrangler/seed/${db}.sql`, sql[db].join("\n"));
  run("d1", "execute", db, "--local", "--file", `.wrangler/seed/${db}.sql`);
  console.log("seeded", db);
}
run("d1", "migrations", "apply", "habits", "--local");
console.log("habits migrated");
