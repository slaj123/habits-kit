// Pure habit logic. No I/O: the Worker loads raw rows from the four apps,
// this turns them into a day-by-day ledger. Runs in Workers and in Node tests.
//
// A "day" is a calendar date in the chosen time zone (settings.tz).
// 1,000 Nights keeps its own night dates (3 a.m. cutoff), used as-is.

export const HABITS = ["family", "garden", "nights", "workout", "dailylog"];
// Every day ends at 3 a.m., so being up past midnight still counts for the
// day before. Same cutoff as 1,000 Nights.
export const LOG_CUTOFF_HOURS = 3;
export const DAY_CUTOFF_HOURS = LOG_CUTOFF_HOURS;
// The tracker's day for an instant: the local date, with the day running to 3 a.m.
export function dayOf(instant, tz) {
  const t = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  return Number.isNaN(t) ? null : localDay(new Date(t - DAY_CUTOFF_HOURS * 3600e3), tz);
}
// Daily Log gets morning grace: a memo recorded before noon counts for the
// day before, since it's often recorded the next morning. Older days still can't be filled in after the fact.
export const DAILYLOG_CUTOFF_HOURS = 12;
export const DEFAULTS = { tz: "America/Los_Angeles", nudgeHour: 20, familyTarget: 5 };

const fmtCache = new Map();
function parts(date, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// "YYYY-MM-DD" for an instant in a time zone. Bad input gives null.
export function localDay(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d)) return null;
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
export function localHour(instant, tz) {
  return Number(parts(instant instanceof Date ? instant : new Date(instant), tz).hour);
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function validTz(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return typeof tz === "string" && tz.length > 0; }
  catch { return false; }
}

// raw = {
//   family:  ["2026-10-21T18:03:11.000Z", ...]       created_at of memories you added
//   garden:  [{ name, createdAt, conversations: [{ date }] }]
//   nights:  { checks: [{ kind, day_number, date, checked }], nights: [{ date, mode }] }
//   workout: [{ date, type }]
//   dailylog: [{ entry, at, headline }]                 from this app's own DB
// }
// settings = { tz, startDate, gardenRetiredFrom, familyTarget }
// Returns days oldest → newest from `from` to `today`, plus streaks.
export function ledger(raw, settings, today, from) {
  const tz = settings.tz || DEFAULTS.tz;
  const target = settings.familyTarget || DEFAULTS.familyTarget;
  const start = settings.startDate || today;

  // Family: memories added per day.
  const family = new Map();
  for (const at of raw.family || []) {
    const d = dayOf(at, tz);
    if (d) family.set(d, (family.get(d) || 0) + 1);
  }

  // Garden: who was planted each day, and which of them got a conversation that same day.
  const planted = new Map(), called = new Map();
  for (const p of raw.garden || []) {
    const d = dayOf(p.createdAt, tz);
    if (!d) continue;
    const name = String(p.name || "Someone").trim() || "Someone";
    push(planted, d, name);
    if ((p.conversations || []).some((c) => dayOf(c.date, tz) === d)) push(called, d, name);
  }

  // 1,000 Nights (mirrors completedSets in 1000-nights/public/logic.js): a full
  // set counts on the night its last slot was done. A slot is done by checking
  // its item or by a swap ("read my own pick"); a swapped slot stays on the
  // swap's night even if the skipped item is read later from the shelf.
  // A light night counts when its three light items are checked.
  const checkedOn = new Map();
  const setSlots = new Map(); // day_number -> Map(slot -> date)
  const slotOf = (id) => String(id || "").slice(String(id || "").lastIndexOf("-") + 1);
  const putSlot = (day, slot, date, force) => {
    if (!setSlots.has(day)) setSlots.set(day, new Map());
    const m = setSlots.get(day);
    if (force || !m.has(slot)) m.set(slot, date);
  };
  for (const w of raw.nights?.swaps || []) {
    putSlot(w.day_number, w.slot, w.date, true);
    checkedOn.set(w.date, (checkedOn.get(w.date) || 0) + 1);
  }
  const swapped = new Set((raw.nights?.swaps || []).map((w) => w.item_id));
  for (const c of raw.nights?.checks || []) {
    if (!c.checked) continue;
    // A skipped item read later from the shelf doesn't add to tonight's count.
    if (c.kind === "full" && swapped.has(c.item_id)) continue;
    checkedOn.set(c.date, (checkedOn.get(c.date) || 0) + 1);
    if (c.kind === "full") putSlot(c.day_number, slotOf(c.item_id), c.date, false);
  }
  const nightsDone = new Set();
  for (const m of setSlots.values()) {
    if (["poem", "story", "essay"].every((s) => m.has(s))) nightsDone.add([...m.values()].sort().pop());
  }
  const lightMode = new Set((raw.nights?.nights || []).filter((n) => n.mode === "light").map((n) => n.date));
  const lightChecked = new Map();
  for (const c of raw.nights?.checks || []) {
    if (c.checked && c.kind === "light") lightChecked.set(c.date, (lightChecked.get(c.date) || 0) + 1);
  }
  for (const [d, n] of lightChecked) if (n >= 3 && lightMode.has(d)) nightsDone.add(d);

  // Workout: sessions per day.
  const workouts = new Map();
  for (const s of raw.workout || []) push(workouts, s.date, s.type);

  // Daily Log: memos per day, noon cutoff (morning grace).
  const logs = new Map();
  for (const l of raw.dailylog || []) {
    const d = localDay(new Date(Date.parse(l.at) - DAILYLOG_CUTOFF_HOURS * 3600e3), tz);
    if (d) push(logs, d, { entry: l.entry, headline: l.headline });
  }

  const days = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const tracked = d >= start;
    const gardenOn = tracked && !(settings.gardenRetiredFrom && d >= settings.gardenRetiredFrom);
    const fam = family.get(d) || 0;
    const plantedToday = planted.get(d) || [];
    const calledToday = called.get(d) || [];
    const w = workouts.get(d) || [];
    const day = {
      date: d,
      tracked,
      family: { required: tracked, count: fam, target, done: fam >= target },
      garden: {
        required: gardenOn,
        planted: plantedToday,
        called: calledToday,
        waiting: plantedToday.filter((n) => !calledToday.includes(n)),
        done: calledToday.length > 0,
      },
      nights: { required: tracked, count: Math.min(3, checkedOn.get(d) || 0), done: nightsDone.has(d) },
      workout: { required: tracked, count: w.length, types: [...new Set(w)], done: w.length > 0 },
      dailylog: { required: tracked, entries: logs.get(d) || [], done: (logs.get(d) || []).length > 0 },
    };
    if (day.nights.done) day.nights.count = 3;
    day.open = HABITS.filter((h) => day[h].required && !day[h].done);
    day.allDone = tracked && day.open.length === 0;
    days.push(day);
  }

  return { days, streaks: streaks(days, today), today: days[days.length - 1] };
}

// A streak counts back from today if today is done, else from yesterday
// (today isn't missed until midnight). A retired Garden drops out of "all",
// so it can't break the overall streak.
function streaks(days, today) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const run = (ok) => {
    let d = byDate.get(today) && ok(byDate.get(today)) ? today : addDays(today, -1);
    let n = 0;
    while (byDate.has(d) && ok(byDate.get(d))) { n++; d = addDays(d, -1); }
    return n;
  };
  const out = { all: run((x) => x.allDone) };
  for (const h of HABITS) out[h] = run((x) => x[h].done);
  return out;
}

function push(map, k, v) {
  const a = map.get(k);
  if (a) a.push(v); else map.set(k, [v]);
}

// The nudge text: what is still open today, in a few words.
export function nudgeText(day) {
  if (!day.open.length) return null;
  const bits = day.open.map((h) => {
    if (h === "family") return `Family ${day.family.count}/${day.family.target}`;
    if (h === "garden") return day.garden.waiting.length ? `call ${day.garden.waiting[0]}` : "plant + call one person";
    if (h === "nights") return `tonight's reading ${day.nights.count}/3`;
    if (h === "dailylog") return "record your daily log";
    return "log a workout";
  });
  return "Still open: " + bits.join(", ") + ".";
}

// ---------- vices ----------
// Tracked, not habits: they never touch the streak or the push text.
// Each vice is a yes/no per day ("did it that day"). A day runs to 4 a.m.,
// same cutoff as Daily Log, so a late night counts for the evening before.

// Things to cut back on. Edit this list, VICE_ROWS in public/app.js and the CHECK in migrations/0003_vices.sql together.
export const VICES = ["drink", "smoke", "sweets", "scroll"];
export const VICE_DAYS = 90; // how far back the page can show and edit

export function viceDay(at, tz) {
  return localDay(new Date(Date.parse(at) - LOG_CUTOFF_HOURS * 3600e3), tz);
}

// 8 p.m. local on `day`: the instant stored when a past day is marked.
export function eveningOf(day, tz) {
  const guess = Date.parse(`${day}T20:00:00Z`);
  const off = (Number(parts(new Date(guess), tz).hour) - 20 + 24) % 24; // local hour minus UTC hour
  const offset = off > 12 ? off - 24 : off;
  return new Date(guess - offset * 3600e3).toISOString();
}

// events = [{ kind, at }], screen = [{ date, minutes, source }]
// -> {
//   day: today,
//   byDay:   { "YYYY-MM-DD": { drink: true, ... } }   last VICE_DAYS days
//   week:    { drink: days in the last 7, ... }
//   daysSince: { drink: n | null, ... }
//   screen:  { byDate: { "YYYY-MM-DD": { minutes, source } }, weekAvg }
// }
export function viceSummary(events, screen, tz, today) {
  const from = addDays(today, -(VICE_DAYS - 1));
  const weekFrom = addDays(today, -6);
  const out = { day: today, byDay: {}, week: {}, daysSince: {} };
  const last = {};
  const seen = new Set();
  for (const k of VICES) out.week[k] = 0;
  for (const e of events) {
    const d = viceDay(e.at, tz);
    if (!d || !VICES.includes(e.kind) || d > today) continue;
    if (!last[e.kind] || d > last[e.kind]) last[e.kind] = d;
    const key = d + "|" + e.kind;
    if (seen.has(key)) continue; // several taps on one day are still one day
    seen.add(key);
    if (d >= from) (out.byDay[d] ??= {})[e.kind] = true;
    if (d >= weekFrom) out.week[e.kind]++;
  }
  const since = (d) => (d ? daysBetween(d, today) : null);
  for (const k of VICES) out.daysSince[k] = since(last[k]);

  const byDate = {};
  for (const s of screen) if (s.date >= from && s.date <= today) byDate[s.date] = { minutes: s.minutes, source: s.source };
  const week = Object.entries(byDate).filter(([d]) => d >= weekFrom).map(([, s]) => s.minutes);
  out.screen = {
    byDate,
    weekAvg: week.length ? Math.round(week.reduce((a, b) => a + b, 0) / week.length) : null,
  };
  return out;
}

function daysBetween(a, b) {
  const t = (x) => { const [y, m, d] = x.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400e3);
}

// ---------- to-do ----------
// Open tasks roll over daily; the older, the more urgent. Checked tasks stay
// (struck through) for the rest of the day they were checked, then drop off.

// Urgency by age in days: 0 today, 1 yesterday, 2 = 2–3 days, 3 = 4+ days.
export function urgency(age) {
  return age <= 0 ? 0 : age === 1 ? 1 : age <= 3 ? 2 : 3;
}

// rows = [{ id, text, created_at, created_day, done_at, done_day }]
// -> { items: [{ id, text, age, urgency, done }], open, overdue, doneToday }
// Order: open tasks oldest first (most urgent on top), then today's checked ones.
export function todoList(rows, today) {
  const open = [], done = [];
  for (const r of rows) {
    const age = Math.max(0, daysBetween(r.created_day, today));
    const item = { id: r.id, text: r.text, age, urgency: urgency(age), done: !!r.done_at };
    if (!r.done_at) open.push({ ...item, at: r.created_at });
    else if (r.done_day === today) done.push({ ...item, at: r.done_at });
  }
  open.sort((a, b) => b.age - a.age || a.at.localeCompare(b.at));
  done.sort((a, b) => a.at.localeCompare(b.at));
  return {
    items: [...open, ...done].map(({ at, ...x }) => x),
    open: open.length,
    overdue: open.filter((x) => x.age >= 1).length,
    oldest: open.length ? open[0].age : 0,
    doneToday: done.length,
  };
}
