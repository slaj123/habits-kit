// Pure ledger rules: day boundaries, each habit's "done", streaks, nudge text.
import assert from "node:assert";
import { ledger, localDay, localHour, addDays, nudgeText, validTz, viceSummary, viceDay, eveningOf, todoList, urgency } from "../src/habits.js";

const LA = "America/Los_Angeles";

// Day boundaries follow the time zone, not UTC.
assert.strictEqual(localDay("2026-10-22T06:30:00Z", LA), "2026-10-21"); // 11:30 p.m. Pacific
assert.strictEqual(localDay("2026-10-22T07:30:00Z", LA), "2026-10-22");
assert.strictEqual(localDay("2026-10-22T06:30:00Z", "Asia/Tokyo"), "2026-10-22");
assert.strictEqual(localHour("2026-10-22T03:00:00Z", LA), 20);
assert.strictEqual(localDay("garbage", LA), null);
assert.strictEqual(addDays("2026-12-31", 1), "2027-01-01");
assert.strictEqual(addDays("2026-03-08", 1), "2026-03-09"); // DST change day
assert.ok(validTz(LA) && !validTz("Mars/Olympus"));

const T = "2026-10-21", Y = "2026-10-20", Y2 = "2026-10-19";
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00-07:00`).toISOString(); // Pacific (PDT)
const settings = { tz: LA, startDate: Y2 };

function full(dayNumber, dates) {
  return ["poem", "story", "essay"].map((s, i) => ({ kind: "full", item_id: `d${String(dayNumber).padStart(3, "0")}-${s}`, day_number: dayNumber, date: dates[i], checked: 1 }));
}

const raw = {
  family: [
    ...[1, 2, 3, 4, 5].map((i) => at(Y, `1${i}:00`)), // 5 yesterday = done
    ...[3, 4, 5].map((i) => at(T, `0${i}:00`)),      // 3 today (the day starts at 3 a.m.)
    at(T, "23:59"),                                  // still today in Pacific (06:59Z tomorrow)
  ],
  garden: [
    // Yesterday: planted Ana and called her the same evening -> done.
    { name: "Ana", createdAt: at(Y, "18:00"), conversations: [{ date: at(Y, "21:00") }] },
    // Two days ago: planted Ben, called him a day late -> not done.
    { name: "Ben", createdAt: at(Y2, "18:00"), conversations: [{ date: at(Y, "09:00") }] },
    // Today: planted Cal, no call yet -> waiting.
    { name: "Cal", createdAt: at(T, "08:00"), conversations: [] },
    // An old plant called today doesn't count: today's call must be to today's plant.
    { name: "Old", createdAt: "2026-01-01T00:00:00Z", conversations: [{ date: at(T, "10:00") }] },
  ],
  nights: {
    checks: [
      ...full(1, [Y2, Y2, Y2]),       // set 1 finished two nights ago
      ...full(2, [Y2, Y, Y]),         // set 2: poem early, finished yesterday -> counts yesterday
      { kind: "full", item_id: "d003-poem", day_number: 3, date: T, checked: 1 }, // tonight 1 of 3
      { kind: "light", day_number: null, date: "2026-10-10", checked: 1 },
    ],
    nights: [],
  },
  workout: [{ date: Y2, type: "lifting" }, { date: Y, type: "tennis" }, { date: T, type: "surf" }, { date: T, type: "lifting" }],
  // Recorded at 1:30 a.m. today: before the 4 a.m. cutoff, so it counts for yesterday.
  dailylog: [{ entry: "2026-10-21-083000-daily-log-daily-summary", at: at(T, "01:30"), headline: "Long Tuesday" }],
};

const l = ledger(raw, settings, T, Y2);
const [d2, d1, d0] = l.days;
assert.deepStrictEqual(l.days.map((d) => d.date), [Y2, Y, T]);

assert.strictEqual(d1.family.count, 5); assert.ok(d1.family.done);
assert.strictEqual(d0.family.count, 4); assert.ok(!d0.family.done);

// The day ends at 3 a.m.: 2:59 counts for the day before, 3:00 for the new day.
const late3 = ledger({ family: [at(T, "02:59"), at(T, "03:00")], garden: [
  // Planted at 11 p.m., called at 1:30 a.m.: same day.
  { name: "Dee", createdAt: at(Y, "23:00"), conversations: [{ date: at(T, "01:30") }] },
] }, settings, T, Y);
assert.deepStrictEqual([late3.days[0].family.count, late3.today.family.count], [1, 1]);
assert.ok(late3.days[0].garden.done);

assert.ok(d1.garden.done);
assert.ok(!d2.garden.done);
assert.deepStrictEqual(d0.garden.waiting, ["Cal"]);
assert.ok(!d0.garden.done);

assert.ok(d2.nights.done);
assert.ok(d1.nights.done);
assert.ok(!d0.nights.done); assert.strictEqual(d0.nights.count, 1);

assert.deepStrictEqual(d0.workout.types, ["surf", "lifting"]);

// Daily Log: the 1:30 a.m. memo belongs to yesterday, with its link target.
assert.ok(d1.dailylog.done);
assert.deepStrictEqual(d1.dailylog.entries, [{ entry: "2026-10-21-083000-daily-log-daily-summary", headline: "Long Tuesday" }]);
assert.ok(!d0.dailylog.done);
// Morning grace: up to noon still counts for yesterday; from noon on, today.
const morning = ledger({ dailylog: [{ entry: "x", at: at(T, "11:45"), headline: "h" }] }, settings, T, Y);
assert.ok(morning.days[0].dailylog.done && !morning.today.dailylog.done);
const noon = ledger({ dailylog: [{ entry: "x", at: at(T, "12:00"), headline: "h" }] }, settings, T, Y);
assert.ok(noon.today.dailylog.done && !noon.days[0].dailylog.done);

// Yesterday was all done; two days ago wasn't (Ben, no family memories).
assert.ok(d1.allDone);
assert.ok(!d2.allDone);
assert.deepStrictEqual(d0.open, ["family", "garden", "nights", "dailylog"]);
// Today isn't missed yet, so streaks count back from yesterday.
assert.strictEqual(l.streaks.all, 1);
assert.strictEqual(l.streaks.workout, 3);
assert.strictEqual(l.streaks.nights, 2);

assert.strictEqual(nudgeText(d0), "Still open: Family 4/5, call Cal, tonight's reading 1/3, record your daily log.");

// Swaps: two read + one swapped = the night counts; reading the skipped item
// later from the shelf doesn't move the set to that later night.
const swapNight = ledger({ nights: {
  checks: [
    { kind: "full", item_id: "d007-poem", day_number: 7, date: Y, checked: 1 },
    { kind: "full", item_id: "d007-essay", day_number: 7, date: Y, checked: 1 },
    { kind: "full", item_id: "d007-story", day_number: 7, date: T, checked: 1 }, // read off the shelf tonight
  ],
  swaps: [{ date: Y, slot: "story", day_number: 7, item_id: "d007-story" }],
  nights: [],
} }, settings, T, Y);
assert.ok(swapNight.days[0].nights.done, "swapped night counts");
assert.ok(!swapNight.today.nights.done, "shelf read doesn't count as tonight");
assert.strictEqual(swapNight.today.nights.count, 0);

// Light nights count once all three light items are checked on a light night.
const light = ledger({ nights: {
  checks: [1, 2, 3].map(() => ({ kind: "light", date: T, checked: 1 })),
  nights: [{ date: T, mode: "light" }],
} }, settings, T, T);
assert.ok(light.today.nights.done);
// Three light checks on a night that isn't light mode don't count.
assert.ok(!ledger({ nights: { checks: [1, 2, 3].map(() => ({ kind: "light", date: T, checked: 1 })), nights: [] } }, settings, T, T).today.nights.done);

// Before the start date nothing is required and the overall streak can't reach back.
const pre = ledger(raw, { tz: LA, startDate: T }, T, Y2);
assert.ok(!pre.days[1].tracked && !pre.days[1].allDone);
assert.strictEqual(pre.streaks.all, 0);

// Out of people: the Garden stops being required, so today can finish without it.
const doneToday = {
  ...raw,
  family: [...raw.family, at(T, "09:00")],
  nights: { checks: [...raw.nights.checks, ...full(9, [T, T, T])], nights: [] },
  dailylog: [...raw.dailylog, { entry: "today", at: at(T, "22:00"), headline: "Today" }],
};
const retired = ledger(doneToday, { ...settings, gardenRetiredFrom: T }, T, Y2);
assert.ok(!retired.today.garden.required);
assert.ok(retired.today.allDone);
assert.strictEqual(retired.streaks.all, 2);
assert.strictEqual(nudgeText(retired.today), null);

// Empty / missing sources don't crash.
const empty = ledger({}, settings, T, T);
assert.deepStrictEqual(empty.today.open, ["family", "garden", "nights", "workout", "dailylog"]);
assert.strictEqual(nudgeText(empty.today), "Still open: Family 0/5, plant + call one person, tonight's reading 0/3, log a workout, record your daily log.");

// ---------- vices ----------
const vs = viceSummary([
  { kind: "drink", at: at(T, "21:00") },
  { kind: "drink", at: at(T, "22:00") },   // two taps, still one day
  { kind: "drink", at: at(T, "02:00") },   // 2 a.m. today counts for last night (Y)
  { kind: "smoke", at: at("2026-10-10", "20:00") },
  { kind: "sweets", at: at(Y2, "23:00") },
  { kind: "scroll", at: at("2026-10-01", "23:00") },
  { kind: "drink", at: at("2026-01-01", "20:00") }, // older than 90 days: counts for days-since only
], [
  { date: T, minutes: 250, source: "shortcut" },
  { date: Y, minutes: 200, source: "manual" },
], LA, T);
assert.strictEqual(vs.day, T);
assert.deepStrictEqual(vs.byDay[T], { drink: true });
assert.deepStrictEqual(vs.byDay[Y], { drink: true });
assert.deepStrictEqual(vs.byDay[Y2], { sweets: true });
assert.deepStrictEqual(vs.byDay["2026-10-10"], { smoke: true });
assert.strictEqual(vs.byDay["2026-01-01"], undefined);
assert.strictEqual(vs.week.drink, 2);            // days, not taps
assert.strictEqual(vs.week.smoke, 0);            // 11 days ago
assert.strictEqual(vs.daysSince.drink, 0);
assert.strictEqual(vs.daysSince.smoke, 11);
assert.strictEqual(vs.daysSince.scroll, 20);
assert.deepStrictEqual(vs.screen.byDate[T], { minutes: 250, source: "shortcut" });
assert.strictEqual(vs.screen.weekAvg, 225);
const none = viceSummary([], [], LA, T);
assert.deepStrictEqual(none.byDay, {});
assert.strictEqual(none.daysSince.drink, null);
assert.strictEqual(none.screen.weekAvg, null);
// eveningOf lands inside its own day in any zone, across DST.
for (const [d, tz] of [[T, LA], ["2026-12-15", LA], ["2026-03-08", LA], [T, "Asia/Tokyo"], [T, "Europe/London"]]) {
  assert.strictEqual(viceDay(eveningOf(d, tz), tz), d, d + " " + tz);
}
// Vices never reach the push text, even on a heavy day.
assert.ok(!/drink|smok|sweets|scroll|screen/i.test(nudgeText(empty.today)));

// ---------- to-do ----------
assert.deepStrictEqual([0, 1, 2, 3, 4, 30].map(urgency), [0, 1, 2, 2, 3, 3]);
const td = todoList([
  { id: 1, text: "old", created_at: "2026-10-16T10:00Z", created_day: "2026-10-16", done_at: null, done_day: null },
  { id: 2, text: "new", created_at: "2026-10-21T10:00Z", created_day: T, done_at: null, done_day: null },
  { id: 3, text: "done today", created_at: "2026-10-20T10:00Z", created_day: Y, done_at: "2026-10-21T11:00Z", done_day: T },
  { id: 4, text: "done yesterday", created_at: "2026-10-19T10:00Z", created_day: Y2, done_at: "2026-10-20T11:00Z", done_day: Y },
  { id: 5, text: "yday", created_at: "2026-10-20T09:00Z", created_day: Y, done_at: null, done_day: null },
  { id: 6, text: "yday later", created_at: "2026-10-20T15:00Z", created_day: Y, done_at: null, done_day: null },
], T);
assert.deepStrictEqual(td.items.map((x) => x.id), [1, 5, 6, 2, 3]); // oldest open first, then today's checked
assert.deepStrictEqual(td.items.map((x) => x.urgency), [3, 1, 1, 0, 1]);
assert.deepStrictEqual([td.open, td.overdue, td.oldest, td.doneToday], [4, 3, 5, 1]);
assert.deepStrictEqual(todoList([], T), { items: [], open: 0, overdue: 0, oldest: 0, doneToday: 0 });

console.log("habits ok");
