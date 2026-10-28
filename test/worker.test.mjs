// Drives the real Worker against the five fake databases.
import assert from "node:assert";
import worker, { maybeNudge, parseMinutes } from "../src/worker.js";
import { localDay, addDays } from "../src/habits.js";
import { b64u } from "../src/webpush.js";
import { fakeEnv, addMemory, addPlant, addCheck, addWorkout } from "./fixtures.mjs";

const env = fakeEnv();
const vk = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
env.VAPID_PUBLIC_KEY = b64u.encode(await crypto.subtle.exportKey("raw", vk.publicKey));
env.VAPID_PRIVATE_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", vk.privateKey));

const B = "https://habits.test";
let cookie = "";
async function call(method, path, body) {
  const res = await worker.fetch(new Request(B + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, "CF-Connecting-IP": "9.9.9.9" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }), env);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

// Fail closed with no secrets; static files skip the API.
assert.strictEqual((await worker.fetch(new Request(B + "/api/status"), { ...env, HABITS_PASSCODE: "" })).status, 503);
assert.strictEqual(await (await worker.fetch(new Request(B + "/"), env)).text(), "asset");

// Signed out until the right passcode.
assert.strictEqual((await call("GET", "/api/status")).status, 401);
assert.strictEqual((await call("POST", "/api/login", { passcode: "nope" })).status, 401);
const ok = await call("POST", "/api/login", { passcode: env.HABITS_PASSCODE });
assert.strictEqual(ok.status, 204);
cookie = ok.headers.get("set-cookie").split(";")[0];

// Data for today (Pacific).
const today = localDay(new Date(), "America/Los_Angeles");
const noonToday = new Date(`${today}T12:00:00-07:00`).toISOString();
for (let i = 0; i < 3; i++) addMemory(env, "me", noonToday);
addMemory(env, "mom", noonToday);       // someone else's: not counted
addMemory(env, "rex", noonToday);   // dog post: no record of who posted, not counted
addMemory(env, "me", noonToday, "sample-x"); // seed sample: not counted
addPlant(env, { name: "Dana", createdAt: noonToday, conversations: [{ date: noonToday, method: "Phone" }] });
addCheck(env, "full", "d001-poem", today, 1);
addWorkout(env, today, "climbing");

const s = await call("GET", "/api/status");
assert.strictEqual(s.status, 200);
assert.strictEqual(s.body.today, today);
assert.strictEqual(s.body.settings.startDate, today); // first run = day one
assert.deepStrictEqual(s.body.errors, []);
const t = s.body.days.at(-1);
assert.strictEqual(t.family.count, 3);
assert.ok(t.garden.done);
assert.strictEqual(t.nights.count, 1);
assert.deepStrictEqual(t.workout.types, ["climbing"]);
assert.deepStrictEqual(t.open, ["family", "nights", "dailylog"]);

// Daily Log ingest: shared secret only, well-formed body only.
const ingest = (body, secret = env.DAILYLOG_INGEST_SECRET) => worker.fetch(new Request(B + "/api/ingest/dailylog", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Ingest-Secret": secret },
  body: typeof body === "string" ? body : JSON.stringify(body),
}), env);
const logBody = { entry: `${today}-213000-daily-log-daily-summary`, at: new Date(`${today}T21:30:00-07:00`).toISOString(), headline: "Busy Friday" };
assert.strictEqual((await ingest(logBody, "wrong-secret-wrong-secret-x")).status, 401);
assert.strictEqual((await ingest(logBody, "")).status, 401);
assert.strictEqual((await worker.fetch(new Request(B + "/api/ingest/dailylog", { method: "POST", body: "{}" }), { ...env, DAILYLOG_INGEST_SECRET: "" })).status, 503);
assert.strictEqual((await ingest({ ...logBody, entry: "../etc/passwd" })).status, 400);
assert.strictEqual((await ingest({ ...logBody, at: "yesterday" })).status, 400);
assert.strictEqual((await ingest("not json")).status, 400);
assert.strictEqual(s.body.days.length, 90);

// One broken source shows as an error, the rest still load.
const broken = { ...env, WORKOUT_DB: { prepare: () => { throw new Error("gone"); } } };
const sb = await worker.fetch(new Request(B + "/api/status", { headers: { Cookie: cookie } }), broken);
const sbj = await sb.json();
assert.deepStrictEqual(sbj.errors, ["workout"]);
assert.strictEqual(sbj.days.at(-1).family.count, 3);

// Settings.
assert.strictEqual((await call("PATCH", "/api/settings", { tz: "Mars/Olympus" })).status, 400);
assert.strictEqual((await call("PATCH", "/api/settings", { nudgeHour: 25 })).status, 400);
assert.strictEqual((await call("PATCH", "/api/settings", {})).status, 400);
assert.strictEqual((await call("PATCH", "/api/settings", "nope")).status, 400);
const r = await call("PATCH", "/api/settings", { gardenRetired: true });
assert.strictEqual(r.status, 200);
assert.strictEqual(r.body.settings.gardenRetiredFrom, today);
assert.ok(!r.body.days.at(-1).garden.required);
const back = await call("PATCH", "/api/settings", { gardenRetired: false });
assert.strictEqual(back.body.settings.gardenRetiredFrom, null);
assert.strictEqual((await call("PATCH", "/api/settings", { nudgeHour: 21 })).body.settings.nudgeHour, 21);

// Which habits count: off ones aren't required, unconnected apps can't be on, never zero.
let hs = await call("PATCH", "/api/settings", { habits: ["workout", "nights", "bogus"] });
assert.deepStrictEqual(hs.body.settings.habits, ["nights", "workout"]);
assert.ok(!hs.body.days.at(-1).family.required && hs.body.days.at(-1).workout.required);
assert.ok(hs.body.days.at(-1).open.every((h) => ["nights", "workout"].includes(h)));
assert.strictEqual((await call("PATCH", "/api/settings", { habits: [] })).status, 400);
assert.strictEqual((await call("PATCH", "/api/settings", { familyTarget: 0 })).status, 400);
assert.strictEqual((await call("PATCH", "/api/settings", { familyTarget: 3 })).body.settings.familyTarget, 3);
const noGarden = { ...env, GARDEN_DB: undefined };
const st2 = await worker.fetch(new Request("https://habits.test/api/status", { headers: { Cookie: cookie } }), noGarden);
const s2 = await st2.json();
assert.ok(!s2.settings.available.includes("garden") && !s2.settings.habits.includes("garden"));
await call("PATCH", "/api/settings", { habits: ["family", "garden", "nights", "workout", "dailylog"], familyTarget: 5 });
await call("PATCH", "/api/settings", { nudgeHour: 20 });

// Push subscriptions: only real push services, only well-formed keys.
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const keys = {
  p256dh: b64u.encode(await crypto.subtle.exportKey("raw", ua.publicKey)),
  auth: b64u.encode(crypto.getRandomValues(new Uint8Array(16))),
};
assert.strictEqual((await call("POST", "/api/push/subscribe", { endpoint: "https://evil.example/x", keys })).status, 400);
assert.strictEqual((await call("POST", "/api/push/subscribe", { endpoint: "http://web.push.apple.com/x", keys })).status, 400);
assert.strictEqual((await call("POST", "/api/push/subscribe", { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "short", auth: keys.auth } })).status, 400);
assert.strictEqual((await call("POST", "/api/push/subscribe", { endpoint: "https://web.push.apple.com/live", keys })).status, 204);
assert.strictEqual((await call("POST", "/api/push/subscribe", { endpoint: "https://web.push.apple.com/dead", keys })).status, 204);
assert.strictEqual((await call("GET", "/api/status")).body.push.devices, 2);

// The nudge: a fake push service records what it gets; the "dead" device answers 410.
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, init });
  return new Response(null, { status: url.endsWith("/dead") ? 410 : 201 });
};
// 8 p.m. Pacific tonight, in UTC.
const eightPm = new Date(`${today}T20:00:00-07:00`);
const sevenPm = new Date(eightPm.getTime() - 3600e3);
assert.deepStrictEqual(await maybeNudge(env, sevenPm), { skipped: "not nudge hour" });
const n1 = await maybeNudge(env, eightPm);
assert.strictEqual(n1.text, "Still open: Family 3/5, tonight's reading 1/3, record your daily log.");

// The memo lands: Daily Log is done, and its entry is there for the Listen link.
assert.strictEqual((await ingest(logBody)).status, 204);
assert.strictEqual((await ingest(logBody)).status, 204); // a retry doesn't duplicate
const afterLog = (await call("GET", "/api/status")).body.days.at(-1);
assert.ok(afterLog.dailylog.done);
assert.deepStrictEqual(afterLog.dailylog.entries, [{ entry: logBody.entry, headline: "Busy Friday" }]);
assert.deepStrictEqual(afterLog.open, ["family", "nights"]);
assert.strictEqual(n1.sent, 1);
assert.strictEqual(n1.failed, 1);
assert.strictEqual(sent.length, 2);
const h = sent[0].init.headers;
assert.strictEqual(h["Content-Encoding"], "aes128gcm");
assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
assert.ok(sent[0].init.body.length > 86);
// The dead device was dropped; a second run the same day sends nothing.
assert.strictEqual((await call("GET", "/api/status")).body.push.devices, 1);
assert.deepStrictEqual(await maybeNudge(env, new Date(eightPm.getTime() + 60e3)), { skipped: "already sent" });
assert.strictEqual(sent.length, 2);

// All done -> no nudge (fresh day: tomorrow, with everything finished).
const tomorrow = addDays(today, 1);
const noonTmrw = new Date(`${tomorrow}T12:00:00-07:00`).toISOString();
for (let i = 0; i < 5; i++) addMemory(env, "me", noonTmrw);
addPlant(env, { name: "Eli", createdAt: noonTmrw, conversations: [{ date: noonTmrw }] });
for (const s of ["poem", "story", "essay"]) addCheck(env, "full", "d002-" + s, tomorrow, 2);
addWorkout(env, tomorrow);
await ingest({ entry: "tmrw-log", at: new Date(`${tomorrow}T19:00:00-07:00`).toISOString(), headline: "h" });
assert.deepStrictEqual(await maybeNudge(env, new Date(`${tomorrow}T20:00:00-07:00`)), { skipped: "all done" });

// ---------- vices ----------
for (const [v, want] of [[252, 252], ["252", 252], ["4h 12m", 252], ["4 hr, 12 min", 252], ["4:12", 252], ["4:12:30", 252],
  ["4.2 hours", 252], ["4,2 h", 252], ["45m", 45], ["45 min", 45], ["0", 0], ["", null], ["lots", null], [-5, null], [2000, null], [null, null]]) {
  assert.strictEqual(parseMinutes(v), want, "parseMinutes(" + JSON.stringify(v) + ")");
}
// The vices lock: nothing about vices in the main status, nothing without the passcode.
assert.strictEqual((await call("GET", "/api/status")).body.vices, undefined);
assert.strictEqual((await call("GET", "/api/vices")).status, 403);
assert.strictEqual((await call("POST", "/api/vices", { kind: "drink" })).status, 403);
assert.strictEqual((await call("PUT", "/api/screentime", { date: "2026-10-23", minutes: 5 })).status, 403);
const vreq = async (method, path, body, token) => {
  const res = await worker.fetch(new Request(B + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, "CF-Connecting-IP": "8.8.8.8", "X-Vices-Token": token || "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};
assert.strictEqual((await vreq("POST", "/api/vices/unlock", { passcode: "nope" })).status, 401);
assert.strictEqual((await vreq("GET", "/api/vices", undefined, "123.fake")).status, 403);
const unlocked = await vreq("POST", "/api/vices/unlock", { passcode: env.VICES_PASSCODE });
assert.strictEqual(unlocked.status, 200);
const tok = unlocked.body.token;
let vs = unlocked.body.vices;
assert.deepStrictEqual(vs.byDay, {});
// An expired token is refused.
const expired = (Math.floor(Date.now() / 1000) - 5) + "." + tok.split(".")[1];
assert.strictEqual((await vreq("GET", "/api/vices", undefined, expired)).status, 403);
// A token signed before a passcode change is refused.
assert.strictEqual((await worker.fetch(new Request(B + "/api/vices", { headers: { Cookie: cookie, "X-Vices-Token": tok } }), { ...env, VICES_PASSCODE: "changed-code" })).status, 403);
// Not configured: closed.
assert.strictEqual((await worker.fetch(new Request(B + "/api/vices", { headers: { Cookie: cookie, "X-Vices-Token": tok } }), { ...env, VICES_PASSCODE: "" })).status, 503);

const vday = vs.day;
const toggle = (kind, date) => vreq("POST", "/api/vices/toggle", { kind, date }, tok);
assert.strictEqual((await toggle("meth", vday)).status, 400);
assert.strictEqual((await toggle("drink", "yesterday")).status, 400);
assert.strictEqual((await toggle("drink", addDays(vday, 1))).status, 400);   // no future days
assert.strictEqual((await toggle("drink", addDays(vday, -90))).status, 400); // past the 90-day window
// Today: tap marks it, tap again clears it.
vs = (await toggle("drink", vday)).body.vices;
assert.deepStrictEqual(vs.byDay[vday], { drink: true });
vs = (await toggle("drink", vday)).body.vices;
assert.strictEqual(vs.byDay[vday], undefined);
// A past day works the same and doesn't touch today.
const past = addDays(vday, -3);
vs = (await toggle("scroll", past)).body.vices;
assert.deepStrictEqual(vs.byDay[past], { scroll: true });
assert.strictEqual(vs.daysSince.scroll, 3);
vs = (await toggle("drink", vday)).body.vices;
assert.deepStrictEqual(vs.byDay[vday], { drink: true });
assert.deepStrictEqual(vs.byDay[past], { scroll: true });
// Old multi-tap rows on one day clear in one tap.
const twoTaps = addDays(vday, -5);
for (const h of ["19:00", "23:00"]) env.DB._db.prepare("INSERT INTO vice_events (kind, at) VALUES ('smoke', ?)").run(new Date(`${twoTaps}T${h}:00-07:00`).toISOString());
vs = (await vreq("GET", "/api/vices", undefined, tok)).body.vices;
assert.deepStrictEqual(vs.byDay[twoTaps], { smoke: true });
assert.strictEqual(vs.week.smoke, 1);
vs = (await toggle("smoke", twoTaps)).body.vices;
assert.strictEqual(vs.byDay[twoTaps], undefined);
assert.strictEqual(env.DB._db.prepare("SELECT count(*) AS n FROM vice_events WHERE kind = 'smoke'").get().n, 0);

// Screen time: typed in, then from the Shortcut (latest wins).
assert.strictEqual((await vreq("PUT", "/api/screentime", { date: vs.day, minutes: "lots" }, tok)).status, 400);
vs = (await vreq("PUT", "/api/screentime", { date: vs.day, minutes: "3h 5m" }, tok)).body.vices;
assert.deepStrictEqual(vs.screen.byDate[vs.day], { minutes: 185, source: "manual" });
const stIngest = (body, secret = env.SCREENTIME_INGEST_SECRET) => worker.fetch(new Request(B + "/api/ingest/screentime", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Ingest-Secret": secret }, body: JSON.stringify(body),
}), env);
assert.strictEqual((await stIngest({ minutes: "4h" }, "nope-nope-nope-nope-nope-nope")).status, 401);
assert.strictEqual((await stIngest({ minutes: "a while" })).status, 400);
const sti = await stIngest({ minutes: "4h 12m", date: vs.day });
assert.strictEqual(sti.status, 200);
assert.deepStrictEqual(await sti.json(), { ok: true, date: vs.day, minutes: 252 });
vs = (await vreq("GET", "/api/vices", undefined, tok)).body.vices;
assert.deepStrictEqual(vs.screen.byDate[vs.day], { minutes: 252, source: "shortcut" });

// Wrong vices passcode 5 times from one IP: locked out, even with the right one.
for (let i = 0; i < 4; i++) await vreq("POST", "/api/vices/unlock", { passcode: "nope" });
assert.strictEqual((await vreq("POST", "/api/vices/unlock", { passcode: env.VICES_PASSCODE })).status, 429);
// The Shortcut key: signed-in only.
assert.strictEqual((await call("GET", "/api/screentime/key")).body.key, env.SCREENTIME_INGEST_SECRET);
assert.strictEqual((await worker.fetch(new Request(B + "/api/screentime/key"), env)).status, 401);
// Vices need a session (except the Shortcut's secret route).
const anon = await worker.fetch(new Request(B + "/api/vices", { method: "POST", body: JSON.stringify({ kind: "drink" }) }), env);
assert.strictEqual(anon.status, 401);

// ---------- to-do ----------
assert.deepStrictEqual((await call("GET", "/api/status")).body.todos.items, []);
assert.strictEqual((await call("POST", "/api/todos", { text: "   " })).status, 400);
assert.strictEqual((await call("POST", "/api/todos", { text: "x".repeat(201) })).status, 400);
let td = (await call("POST", "/api/todos", { text: "  Call   the bank " })).body.todos;
assert.deepStrictEqual(td.items.map((x) => [x.text, x.age, x.done]), [["Call the bank", 0, false]]);
const bankId = td.items[0].id;
// A task from 5 days ago rolls over as the most urgent.
env.DB._db.prepare("INSERT INTO todos (text, created_at, created_day) VALUES ('Old task', '2026-01-01T00:00:00Z', ?)").run(addDays(td.today, -5));
td = (await call("GET", "/api/status")).body.todos;
assert.deepStrictEqual(td.items.map((x) => [x.text, x.urgency]), [["Old task", 3], ["Call the bank", 0]]);
assert.strictEqual(td.overdue, 1);
// Check off, uncheck, check again.
td = (await call("POST", `/api/todos/${bankId}/toggle`)).body.todos;
assert.deepStrictEqual([td.open, td.doneToday, td.items.at(-1).done], [1, 1, true]);
td = (await call("POST", `/api/todos/${bankId}/toggle`)).body.todos;
assert.deepStrictEqual([td.open, td.doneToday], [2, 0]);
td = (await call("POST", `/api/todos/${bankId}/toggle`)).body.todos;
// A task checked on an earlier day is gone from the list.
env.DB._db.prepare("UPDATE todos SET done_day = ? WHERE id = ?").run(addDays(td.today, -1), bankId);
td = (await call("GET", "/api/status")).body.todos;
assert.deepStrictEqual(td.items.map((x) => x.text), ["Old task"]);
// Delete; unknown ids; needs a session.
td = (await call("DELETE", `/api/todos/${td.items[0].id}`)).body.todos;
assert.strictEqual(td.open, 0);
assert.strictEqual((await call("POST", "/api/todos/99999/toggle")).status, 404);
assert.strictEqual((await worker.fetch(new Request(B + "/api/todos", { method: "POST", body: JSON.stringify({ text: "x" }) }), env)).status, 401);

// Unsubscribe; unknown route; logout.
assert.strictEqual((await call("DELETE", "/api/push/subscribe", { endpoint: "https://web.push.apple.com/live" })).status, 204);
assert.strictEqual((await call("GET", "/api/status")).body.push.devices, 0);
assert.strictEqual((await call("GET", "/api/nope")).status, 404);
assert.match((await call("POST", "/api/logout")).headers.get("set-cookie"), /Max-Age=0/);

// Lockout after 5 misses from one IP.
cookie = "";
for (let i = 0; i < 4; i++) await call("POST", "/api/login", { passcode: "wrong" });
assert.strictEqual((await call("POST", "/api/login", { passcode: env.HABITS_PASSCODE })).status, 429);

console.log("worker ok");
