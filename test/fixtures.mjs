// In-memory stand-ins for the five databases, built from each app's
// migration files (copied into test/migrations/), with D1's prepare/bind/first/all/run/batch shape.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);

export function fakeD1(migrationsDir) {
  const db = new DatabaseSync(":memory:");
  const dir = new URL(migrationsDir + "/", root);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); }, _db: db };
}

export function fakeEnv() {
  const env = {
    DB: fakeD1("migrations"),
    FAMILY_DB: fakeD1("test/migrations/family"),
    GARDEN_DB: fakeD1("test/migrations/garden"),
    NIGHTS_DB: fakeD1("test/migrations/nights"),
    WORKOUT_DB: fakeD1("test/migrations/workout"),
    HABITS_PASSCODE: "test-passcode-123",
    SESSION_SECRET: "x".repeat(40),
    VAPID_SUBJECT: "https://habits.test",
    DAILYLOG_INGEST_SECRET: "dailylog-secret-abcdefghijklmnop",
    SCREENTIME_INGEST_SECRET: "screentime-secret-abcdefghijklmnop",
    VICES_PASSCODE: "improve-test",
    ASSETS: { fetch: async () => new Response("asset") },
  };
  const f = env.FAMILY_DB._db;
  f.exec("INSERT INTO people (id, name, initial, kind, sort) VALUES ('me','Me','M','person',4),('mom','Mom','M','person',1),('rex','Rex','R','pet',6)");
  f.exec("INSERT INTO places (id, name, lat, lng) VALUES ('p1','Home',0,0)");
  return env;
}

let n = 0;
export function addMemory(env, createdBy, createdAt, id = "m" + ++n) {
  env.FAMILY_DB._db.prepare(
    "INSERT INTO memories (id, place_id, title, category, date_start, created_by, created_at) VALUES (?, 'p1', 't', 'travel', '2020-01-01', ?, ?)"
  ).run(id, createdBy, createdAt);
}
export function addPlant(env, doc) {
  env.GARDEN_DB._db.prepare("INSERT INTO plants (id, data, updated_at) VALUES (?, ?, ?)").run("pl" + ++n, JSON.stringify(doc), doc.createdAt);
}
export function addCheck(env, kind, key, date, dayNumber = null) {
  env.NIGHTS_DB._db.prepare("INSERT INTO checks (key, kind, item_id, date, day_number, checked, ts, seq) VALUES (?, ?, ?, ?, ?, 1, 0, 1)")
    .run(key, kind, key, date, dayNumber);
}
export function setNightMode(env, date, mode) {
  env.NIGHTS_DB._db.prepare("INSERT OR REPLACE INTO nights (date, mode, mode_ts, seq) VALUES (?, ?, 0, 1)").run(date, mode);
}
export function addWorkout(env, date, type = "lifting") {
  env.WORKOUT_DB._db.prepare("INSERT INTO sessions (id, date, type, source, data, created_at, updated_at) VALUES (?, ?, ?, 'form', '{}', ?, ?)")
    .run("w" + ++n, date, type, date, date);
}
