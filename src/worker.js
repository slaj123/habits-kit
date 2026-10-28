// Habits: one page that reads four companion apps and says what's done today.
// Static files (public/) hold no personal data; only /api/* reaches this code,
// and every /api route except login needs a signed session.
//
// The four app databases (FAMILY_DB, GARDEN_DB, NIGHTS_DB, WORKOUT_DB) are
// only ever read with SELECT. This app's own DB holds settings, push
// subscriptions, the nudge log and the login lockout.
//
// Lock: copied from the Garden. One passcode (HABITS_PASSCODE secret), a
// signed HttpOnly cookie good for a year, 5 misses/IP/15 min, 30/hour overall.

import { ledger, localDay, localHour, addDays, validTz, nudgeText, DEFAULTS, VICES, VICE_DAYS, viceDay, viceSummary, eveningOf, todoList, dayOf } from "./habits.js";
import { sendPush } from "./webpush.js";

const MAX_BODY = 20_000;
const COOKIE = "habits_session";
const SESSION_DAYS = 365;
const IP_LIMIT = 5, IP_WINDOW_MIN = 15;
const GLOBAL_LIMIT = 30, GLOBAL_WINDOW_MIN = 60;
const MIN_PASSCODE = 12;
const HISTORY_DAYS = 400; // enough for any streak to show its true length
const SHOW_DAYS = 90; // the page browses this far back; the grid shows the last 30
// Your person id in the Family Map app: only memories you add count toward the family habit.
const ME = "me";

// Push services a subscription may point at. Anything else is refused, so the
// Worker can't be made to POST to an arbitrary address.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (!configured(env)) return json({ error: "lock not configured" }, 503);
      if (url.pathname === "/api/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/api/logout" && request.method === "POST") return logout();
      // The voice-memo Worker can't hold a cookie; it sends a shared secret.
      if (url.pathname === "/api/ingest/dailylog" && request.method === "POST") return await ingestDailyLog(request, env);
      if (url.pathname === "/api/ingest/screentime" && request.method === "POST") return await ingestScreenTime(request, env);
      if (!(await validSession(request, env))) return json({ error: "signed out" }, 401);
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return json({ error: "server error" }, 500);
    }
  },

  // Hourly. Sends one nudge per day, in the nudge hour, only if something is open.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(maybeNudge(env, new Date(event.scheduledTime || Date.now())));
  },
};

function configured(env) {
  return typeof env.HABITS_PASSCODE === "string" && env.HABITS_PASSCODE.length >= MIN_PASSCODE &&
    typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;
}

// ---------- routes ----------

async function route(request, env, url) {
  const m = request.method;
  const p = url.pathname;
  if (p === "/api/status" && m === "GET") return json(await status(env, new Date()));
  if (p === "/api/settings" && m === "PATCH") return await patchSettings(request, env);
  if (p === "/api/push/subscribe" && m === "POST") return await subscribe(request, env);
  if (p === "/api/push/subscribe" && m === "DELETE") return await unsubscribe(request, env);
  if (p === "/api/push/test" && m === "POST") return await testPush(env);
  if (p === "/api/todos" && m === "POST") return await addTodo(request, env);
  const tm = p.match(/^\/api\/todos\/(\d+)(\/toggle)?$/);
  if (tm && m === "POST" && tm[2]) return await toggleTodo(env, Number(tm[1]));
  if (tm && m === "DELETE" && !tm[2]) return await deleteTodo(env, Number(tm[1]));
  // Vices: a second passcode, asked every time (see unlockVices).
  if (p === "/api/vices/unlock" && m === "POST") return await unlockVices(request, env);
  if (p.startsWith("/api/vices") || p === "/api/screentime") {
    if (!vicesConfigured(env)) return json({ error: "vices lock not configured" }, 503);
    if (!(await validViceToken(request, env))) return json({ error: "vices locked" }, 403);
    if (p === "/api/vices" && m === "GET") return await vicesJson(env);
    if (p === "/api/vices/toggle" && m === "POST") return await toggleVice(request, env);
    if (p === "/api/screentime" && m === "PUT") return await setScreenTime(request, env);
    return json({ error: "not found" }, 404);
  }
  // Signed-in only: lets the phone copy the key into the Screen Time Shortcut.
  if (p === "/api/screentime/key" && m === "GET") return json({ key: env.SCREENTIME_INGEST_SECRET || null });
  return json({ error: "not found" }, 404);
}

async function status(env, now) {
  const settings = await loadSettings(env, now);
  const today = dayOf(now, settings.tz); // the day runs to 3 a.m.
  const from = addDays(today, -(HISTORY_DAYS - 1));
  const { raw, errors } = await loadRaw(env, from);
  const l = ledger(raw, settings, today, from);
  const subs = await env.DB.prepare("SELECT count(*) AS n FROM push_subs").first();
  const nudge = await env.DB.prepare("SELECT sent_at FROM nudges WHERE date = ?").bind(today).first();
  return {
    now: now.toISOString(),
    today,
    hour: localHour(now, settings.tz),
    settings,
    errors,
    streaks: l.streaks,
    days: l.days.slice(-SHOW_DAYS),
    todos: await loadTodos(env, now, settings.tz),
    push: { devices: subs.n, publicKey: env.VAPID_PUBLIC_KEY || null, sentToday: nudge ? nudge.sent_at : null },
  };
}

// Each app is read on its own, so one broken source doesn't blank the page.
async function loadRaw(env, from) {
  const errors = [];
  const safe = async (name, fn, fallback) => {
    try { return await fn(); } catch (e) { console.error(name, e); errors.push(name); return fallback; }
  };
  const sinceIso = addDays(from, -1) + "T00:00:00Z";

  const [family, garden, nights, workout, dailylog] = await Promise.all([
    safe("family", async () => {
      const { results } = await env.FAMILY_DB.prepare(
        "SELECT created_at FROM memories WHERE created_by = ? AND id NOT LIKE 'sample-%' AND created_at >= ?"
      ).bind(ME, sinceIso).all();
      return results.map((r) => r.created_at);
    }, []),
    safe("garden", async () => {
      const { results } = await env.GARDEN_DB.prepare("SELECT data FROM plants").all();
      return results.map((r) => {
        const d = JSON.parse(r.data);
        return { name: d.name, createdAt: d.createdAt, conversations: (d.conversations || []).map((c) => ({ date: c.date })) };
      });
    }, []),
    safe("nights", async () => {
      const [checks, ns, sw] = await Promise.all([
        env.NIGHTS_DB.prepare("SELECT kind, item_id, day_number, date, checked FROM checks WHERE checked = 1").all(),
        env.NIGHTS_DB.prepare("SELECT date, mode FROM nights WHERE mode = 'light'").all(),
        env.NIGHTS_DB.prepare("SELECT date, slot, day_number, item_id FROM swaps WHERE removed = 0").all(),
      ]);
      return { checks: checks.results, nights: ns.results, swaps: sw.results };
    }, { checks: [], nights: [], swaps: [] }),
    safe("workout", async () => {
      const { results } = await env.WORKOUT_DB.prepare("SELECT date, type FROM sessions WHERE date >= ?").bind(from).all();
      return results;
    }, []),
    safe("dailylog", async () => {
      const { results } = await env.DB.prepare("SELECT entry, at, headline FROM daily_logs WHERE at >= ?").bind(sinceIso).all();
      return results;
    }, []),
  ]);
  return { raw: { family, garden, nights, workout, dailylog }, errors };
}

// ---------- daily log ingest ----------
// Body: { entry, at, headline } from voice-memo-logger's notifyHabits().
// `entry` is the memo's file name; the page links to JOURNAL_URL/#e-<entry>.

const ENTRY_RE = /^[A-Za-z0-9._-]{1,120}$/;

async function ingestDailyLog(request, env) {
  const secret = env.DAILYLOG_INGEST_SECRET;
  if (typeof secret !== "string" || secret.length < 24) return json({ error: "ingest not configured" }, 503);
  if (!(await sameSecret(request.headers.get("X-Ingest-Secret") || "", secret))) return json({ error: "unauthorized" }, 401);
  const body = await readBody(request);
  const entry = body && typeof body.entry === "string" ? body.entry : "";
  const at = body && typeof body.at === "string" ? body.at : "";
  const headline = body && typeof body.headline === "string" ? body.headline.trim().slice(0, 200) : "";
  if (!ENTRY_RE.test(entry) || Number.isNaN(Date.parse(at))) return json({ error: "bad body" }, 400);
  await env.DB.prepare("INSERT OR REPLACE INTO daily_logs (entry, at, headline, created_at) VALUES (?, ?, ?, ?)")
    .bind(entry, new Date(at).toISOString(), headline || "Daily log", new Date().toISOString()).run();
  return new Response(null, { status: 204 });
}

// ---------- to-do ----------
// Open tasks roll over until checked; see todoList in habits.js.
const TODO_MAX_LEN = 200, TODO_MAX_OPEN = 200;

async function loadTodos(env, now, tz) {
  const today = viceDay(now.toISOString(), tz);
  const { results } = await env.DB.prepare(
    "SELECT id, text, created_at, created_day, done_at, done_day FROM todos WHERE done_at IS NULL OR done_day >= ?"
  ).bind(today).all();
  return { today, ...todoList(results, today) };
}

async function todosJson(env) {
  const now = new Date();
  const { tz } = await loadSettings(env, now);
  return json({ todos: await loadTodos(env, now, tz) });
}

async function addTodo(request, env) {
  const body = await readBody(request);
  const text = body && typeof body.text === "string" ? body.text.trim().replace(/\s+/g, " ") : "";
  if (!text || text.length > TODO_MAX_LEN) return json({ error: `Task must be 1–${TODO_MAX_LEN} characters.` }, 400);
  const open = await env.DB.prepare("SELECT count(*) AS n FROM todos WHERE done_at IS NULL").first();
  if (open.n >= TODO_MAX_OPEN) return json({ error: "Too many open tasks. Check some off first." }, 400);
  const now = new Date();
  const { tz } = await loadSettings(env, now);
  await env.DB.prepare("INSERT INTO todos (text, created_at, created_day) VALUES (?, ?, ?)")
    .bind(text, now.toISOString(), viceDay(now.toISOString(), tz)).run();
  return todosJson(env);
}

// Checked <-> unchecked. Unchecking keeps the original day, so its age (and
// urgency) comes straight back.
async function toggleTodo(env, id) {
  const row = await env.DB.prepare("SELECT done_at FROM todos WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  if (row.done_at) {
    await env.DB.prepare("UPDATE todos SET done_at = NULL, done_day = NULL WHERE id = ?").bind(id).run();
  } else {
    const now = new Date();
    const { tz } = await loadSettings(env, now);
    await env.DB.prepare("UPDATE todos SET done_at = ?, done_day = ? WHERE id = ?")
      .bind(now.toISOString(), viceDay(now.toISOString(), tz), id).run();
  }
  return todosJson(env);
}

async function deleteTodo(env, id) {
  await env.DB.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  return todosJson(env);
}

// ---------- vices ----------
// Tracked privately: never in the habit streak, never in a push notification.

async function loadVices(env, now, tz) {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400e3).toISOString();
  const [ev, st] = await Promise.all([
    env.DB.prepare("SELECT kind, at FROM vice_events WHERE at >= ?").bind(since).all(),
    env.DB.prepare("SELECT date, minutes, source FROM screen_time WHERE date >= ?").bind(addDays(localDay(now, tz), -VICE_DAYS)).all(),
  ]);
  return viceSummary(ev.results, st.results, tz, viceDay(now.toISOString(), tz));
}

// ---- the vices lock ----
// VICES_PASSCODE is checked on every unlock. A correct one returns a token
// good for VICE_TOKEN_MIN minutes; the page keeps it in memory only (never a
// cookie or storage), so closing or reloading the app locks again. Wrong tries
// share the login lockout table under a "vices:" prefix.
const VICE_TOKEN_MIN = 10;

function vicesConfigured(env) {
  return typeof env.VICES_PASSCODE === "string" && env.VICES_PASSCODE.length >= 4 && typeof env.SESSION_SECRET === "string";
}

async function unlockVices(request, env) {
  if (!vicesConfigured(env)) return json({ error: "vices lock not configured" }, 503);
  const ip = "vices:" + (request.headers.get("CF-Connecting-IP") || "local");
  const now = Date.now();
  const n = await env.DB.prepare("SELECT count(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, new Date(now - IP_WINDOW_MIN * 60_000).toISOString()).first();
  if (n.n >= IP_LIMIT) return json({ error: "locked", message: "Too many wrong tries. Wait 15 minutes." }, 429);
  const body = await readBody(request);
  const given = body && typeof body.passcode === "string" ? body.passcode : "";
  if (!(await sameSecret(given, env.VICES_PASSCODE))) {
    await env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date(now).toISOString()).run();
    return json({ error: "wrong", message: "Wrong passcode." }, 401);
  }
  const exp = Math.floor(now / 1000) + VICE_TOKEN_MIN * 60;
  const token = exp + "." + (await viceSign(String(exp), env));
  return json({ token, expiresIn: VICE_TOKEN_MIN * 60, vices: await loadVicesNow(env) });
}

async function validViceToken(request, env) {
  const [exp, sig] = (request.headers.get("X-Vices-Token") || "").split(".");
  if (!/^\d+$/.test(exp || "") || !sig || Number(exp) < Date.now() / 1000) return false;
  return sameSecret(sig, await viceSign(exp, env));
}

// Separate key from the login cookie's, and changing VICES_PASSCODE voids tokens.
async function viceSign(message, env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET + "\u0000vices\u0000" + env.VICES_PASSCODE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function loadVicesNow(env) {
  const now = new Date();
  const { tz } = await loadSettings(env, now);
  return loadVices(env, now, tz);
}
async function vicesJson(env) { return json({ vices: await loadVicesNow(env) }); }

// Marks or clears one vice for one day (today or up to VICE_DAYS back).
// Body: { kind, date }. Marked = one row at 8 p.m. that day; clearing removes
// every row that day for that kind (old multi-tap rows included).
async function toggleVice(request, env) {
  const body = await readBody(request);
  if (!body || !VICES.includes(body.kind) || !DAY_RE.test(body.date || "")) return json({ error: "bad kind or date" }, 400);
  const now = new Date();
  const { tz } = await loadSettings(env, now);
  const today = viceDay(now.toISOString(), tz);
  if (body.date > today || body.date < addDays(today, -(VICE_DAYS - 1))) return json({ error: "date out of range" }, 400);
  // Rows near that day, then the exact 4 a.m.-to-4 a.m. match in JS.
  const lo = addDays(body.date, -1) + "T00:00:00Z", hi = addDays(body.date, 2) + "T12:00:00Z";
  const { results } = await env.DB.prepare("SELECT id, at FROM vice_events WHERE kind = ? AND at >= ? AND at < ?").bind(body.kind, lo, hi).all();
  const hits = results.filter((r) => viceDay(r.at, tz) === body.date);
  if (hits.length) {
    await env.DB.batch(hits.map((r) => env.DB.prepare("DELETE FROM vice_events WHERE id = ?").bind(r.id)));
  } else {
    await env.DB.prepare("INSERT INTO vice_events (kind, at) VALUES (?, ?)").bind(body.kind, eveningOf(body.date, tz)).run();
  }
  return vicesJson(env);
}

async function setScreenTime(request, env) {
  const body = await readBody(request);
  const minutes = parseMinutes(body?.minutes);
  if (minutes === null || !DAY_RE.test(body?.date || "")) return json({ error: "bad minutes or date" }, 400);
  await writeScreenTime(env, body.date, minutes, "manual");
  return vicesJson(env);
}

// From the iPhone Shortcut. Body: { minutes } (a number, or text such as
// "4h 12m", "4:12", "252", "4.2 hours"); optional { date }. Without a date it
// is today's calendar day where you are (Apple's Screen Time day).
async function ingestScreenTime(request, env) {
  const secret = env.SCREENTIME_INGEST_SECRET;
  if (typeof secret !== "string" || secret.length < 24) return json({ error: "ingest not configured" }, 503);
  if (!(await sameSecret(request.headers.get("X-Ingest-Secret") || "", secret))) return json({ error: "unauthorized" }, 401);
  const body = await readBody(request);
  const minutes = parseMinutes(body?.minutes);
  if (minutes === null) return json({ error: "couldn't read minutes", got: String(body?.minutes ?? "").slice(0, 40) }, 400);
  const { tz } = await loadSettings(env, new Date());
  const date = DAY_RE.test(body?.date || "") ? body.date : dayOf(new Date(), tz);
  await writeScreenTime(env, date, minutes, "shortcut");
  return json({ ok: true, date, minutes });
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function writeScreenTime(env, date, minutes, source) {
  await env.DB.prepare("INSERT OR REPLACE INTO screen_time (date, minutes, source, updated_at) VALUES (?, ?, ?, ?)")
    .bind(date, minutes, source, new Date().toISOString()).run();
}

// Minutes from whatever a Shortcut hands over. null if unreadable or > 24 h.
export function parseMinutes(v) {
  let m = null;
  if (typeof v === "number" && Number.isFinite(v)) m = v;
  else if (typeof v === "string") {
    const s = v.trim().toLowerCase().replace(",", ".");
    let x;
    if ((x = s.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/))) m = Number(x[1]) * 60 + Number(x[2]);
    else if (/^\d+(\.\d+)?$/.test(s)) m = Number(s);
    else if ((x = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)$/))) m = Number(x[1]) * 60;
    else {
      const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
      const mm = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
      if (h || mm) m = (h ? Number(h[1]) * 60 : 0) + (mm ? Number(mm[1]) : 0);
    }
  }
  if (m === null || m < 0 || m > 24 * 60) return null;
  return Math.round(m);
}

// ---------- settings ----------

async function loadSettings(env, now) {
  const { results } = await env.DB.prepare("SELECT name, value FROM settings").all();
  const s = Object.fromEntries(results.map((r) => [r.name, r.value]));
  const tz = validTz(s.tz) ? s.tz : DEFAULTS.tz;
  let startDate = s.startDate;
  if (!startDate) {
    // The first time anything runs is day one of the tracker.
    startDate = dayOf(now, tz);
    await env.DB.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES ('startDate', ?)").bind(startDate).run();
  }
  return {
    tz,
    startDate,
    nudgeHour: s.nudgeHour !== undefined ? Number(s.nudgeHour) : DEFAULTS.nudgeHour,
    familyTarget: DEFAULTS.familyTarget,
    gardenRetiredFrom: s.gardenRetiredFrom || null,
  };
}

async function patchSettings(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: "bad body" }, 400);
  const writes = [];
  const set = (k, v) => writes.push(env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(k, String(v)));

  if ("tz" in body) {
    if (!validTz(body.tz)) return json({ error: "bad time zone" }, 400);
    set("tz", body.tz);
  }
  if ("nudgeHour" in body) {
    const h = body.nudgeHour;
    if (!Number.isInteger(h) || h < 0 || h > 23) return json({ error: "bad hour" }, 400);
    set("nudgeHour", h);
  }
  if ("gardenRetired" in body) {
    if (body.gardenRetired === true) {
      const s = await loadSettings(env, new Date());
      // Retiring counts from today: today's Garden is no longer required.
      set("gardenRetiredFrom", dayOf(new Date(), "tz" in body ? body.tz : s.tz));
    } else if (body.gardenRetired === false) {
      writes.push(env.DB.prepare("DELETE FROM settings WHERE name = 'gardenRetiredFrom'"));
    } else return json({ error: "bad value" }, 400);
  }
  if (!writes.length) return json({ error: "nothing to change" }, 400);
  await env.DB.batch(writes);
  return json(await status(env, new Date()));
}

// ---------- push ----------

async function subscribe(request, env) {
  const body = await readBody(request);
  const endpoint = body && typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = body?.keys?.p256dh, auth = body?.keys?.auth;
  let host = "";
  try { const u = new URL(endpoint); if (u.protocol === "https:") host = u.hostname; } catch {}
  if (!host || !PUSH_HOSTS.some((re) => re.test(host))) return json({ error: "bad endpoint" }, 400);
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh)) return json({ error: "bad key" }, 400);
  if (typeof auth !== "string" || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return json({ error: "bad key" }, 400);
  await env.DB.prepare("INSERT OR REPLACE INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)")
    .bind(endpoint, p256dh, auth, new Date().toISOString()).run();
  return new Response(null, { status: 204 });
}

async function unsubscribe(request, env) {
  const body = await readBody(request);
  if (!body || typeof body.endpoint !== "string") return json({ error: "bad body" }, 400);
  await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(body.endpoint).run();
  return new Response(null, { status: 204 });
}

async function testPush(env) {
  const s = await status(env, new Date());
  const text = nudgeText(s.days[s.days.length - 1]) || "All done today. This is a test nudge.";
  const result = await pushAll(env, { title: "Habits", body: text });
  return json(result);
}

async function pushAll(env, message) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return { sent: 0, failed: 0, error: "push keys not set" };
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs").all();
  let sent = 0, failed = 0;
  for (const sub of results) {
    try {
      const code = await sendPush(sub, message, env);
      if (code === 404 || code === 410) {
        await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
        failed++;
      } else if (code >= 200 && code < 300) sent++;
      else { console.error("push status", code); failed++; }
    } catch (e) {
      console.error("push error", e);
      failed++;
    }
  }
  return { sent, failed };
}

export async function maybeNudge(env, now) {
  if (!configured(env)) return { skipped: "not configured" };
  const settings = await loadSettings(env, now);
  if (localHour(now, settings.tz) !== settings.nudgeHour) return { skipped: "not nudge hour" };
  const s = await status(env, now);
  const day = s.days[s.days.length - 1];
  const text = nudgeText(day);
  if (!text) return { skipped: "all done" };
  // Claim the day first, so an overlapping run can't send a second nudge.
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO nudges (date, sent_at, body) VALUES (?, ?, ?)")
    .bind(s.today, now.toISOString(), text).run();
  if (!claim.meta?.changes && claim.changes !== 1) return { skipped: "already sent" };
  return { text, ...(await pushAll(env, { title: "Habits", body: text })) };
}

// ---------- login (same as the Garden's) ----------

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const now = Date.now();
  const ipSince = new Date(now - IP_WINDOW_MIN * 60_000).toISOString();
  const allSince = new Date(now - GLOBAL_WINDOW_MIN * 60_000).toISOString();
  const counts = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM login_failures WHERE ip = ? AND at > ?) AS ip_n, " +
    "(SELECT count(*) FROM login_failures WHERE at > ?) AS all_n"
  ).bind(ip, ipSince, allSince).first();
  if (counts.ip_n >= IP_LIMIT || counts.all_n >= GLOBAL_LIMIT) {
    return json({ error: "locked", message: "Too many wrong tries. Wait 15 minutes, then try again." }, 429);
  }

  const body = await readBody(request);
  const given = body && typeof body.passcode === "string" ? body.passcode : "";
  if (!(await sameSecret(given, env.HABITS_PASSCODE))) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date(now).toISOString()),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(new Date(now - 86_400_000).toISOString()),
    ]);
    const left = IP_LIMIT - counts.ip_n - 1;
    return json({ error: "wrong", message: left > 0 ? "Wrong passcode." : "Wrong passcode. Locked for 15 minutes." }, 401);
  }

  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const token = exp + "." + (await sign(String(exp), env));
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "no-store",
    },
  });
}

function logout() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` },
  });
}

async function validSession(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!/^\d+$/.test(exp || "") || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return sameSecret(sig, await sign(exp, env));
}

// HMAC key = session secret + passcode, so a new passcode voids old cookies.
async function sign(message, env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET + "\u0000" + env.HABITS_PASSCODE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------- helpers ----------

async function readBody(request) {
  const text = await request.text();
  if (!text || text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
