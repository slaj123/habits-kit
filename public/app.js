// Habits page. Everything shown comes from GET /api/status; nothing is stored here.

// Links come from src/setup.js (urls), sent with the status. Habits you've turned off are hidden.
const APPS = {
  family: { name: "Family Map", url: "", short: "F" },
  garden: { name: "The Garden", url: "", short: "G" },
  nights: { name: "1,000 Nights", url: "", short: "N" },
  workout: { name: "Workout", url: "", short: "W" },
  dailylog: { name: "Daily Log", url: "", short: "L" },
};
const ALL = ["family", "garden", "nights", "workout", "dailylog"];
let ORDER = ALL; // the habits that are on, set from state.settings in render()

const $ = (id) => document.getElementById(id);
let state = null;
let viewIdx = null; // index into state.days; null = today (the last day)
// Vices unlock: memory only, never stored. Reload, leaving the app, or
// VICE_IDLE_MS without a tap locks it again.
let viceToken = null, vices = null, viceTimer = null;
const VICE_IDLE_MS = 5 * 60_000;

// ---------- api ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) { showLogin(); throw new Error("signed out"); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && (data.message || data.error)) || "HTTP " + res.status);
  return data;
}

async function refresh() {
  try {
    state = await api("GET", "/api/status");
    render();
  } catch (e) {
    if (e.message !== "signed out") setMsg("Couldn't load: " + e.message);
  }
}

// ---------- login ----------

function showLogin() {
  $("main").hidden = true;
  $("login").hidden = false;
  $("passcode").focus();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-msg").textContent = "";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode: $("passcode").value }),
  });
  if (res.ok) {
    $("passcode").value = "";
    $("login").hidden = true;
    refresh();
  } else {
    const d = await res.json().catch(() => ({}));
    $("login-msg").textContent = d.message || "Couldn't sign in.";
  }
});

$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  showLogin();
});

// ---------- render ----------

function render() {
  const s = state;
  ORDER = ALL.filter((h) => s.settings.habits.includes(h));
  for (const h of ALL) APPS[h].url = (s.settings.urls || {})[h] || "";
  const today = s.days[s.days.length - 1];
  $("login").hidden = true;
  $("main").hidden = false;

  $("date").textContent = fmtDate(s.today);
  renderLeft();

  $("errors").hidden = !s.errors.length;
  $("errors").textContent = s.errors.length
    ? "Couldn't read " + s.errors.map((h) => APPS[h].name).join(", ") + ". Shown as open until it answers."
    : "";

  const required = ORDER.filter((h) => today[h].required);
  $("streak").textContent = s.streaks.all;
  $("streak-label").textContent = (s.streaks.all === 1 ? "day" : "days") + ", all " + words(required.length);

  renderTodos(s.todos);
  renderSummaries();
  renderDay();
  renderGrid(s.days.slice(-30), s.days.length - 30);
  renderViceLock();
  renderSettings();
}

// The chosen day: today by default, or a past day picked with ‹ › or the grid.
function renderDay() {
  const s = state;
  const last = s.days.length - 1;
  const idx = viewIdx === null ? last : Math.max(0, Math.min(last, viewIdx));
  const day = s.days[idx];
  const isToday = idx === last;
  $("day-name").textContent = isToday ? "Today · " + fmtDate(day.date) : fmtDate(day.date);
  const req = ORDER.filter((h) => day[h].required);
  const doneAny = ORDER.filter((h) => day[h].done).length;
  $("day-sum").textContent = req.length
    ? `${req.filter((h) => day[h].done).length} of ${req.length} done`
    : `before tracking · ${doneAny} of ${ORDER.length} done anyway`;
  $("day-prev").disabled = idx === 0;
  $("day-next").disabled = isToday;
  $("day-today").hidden = isToday;
  $("ledger").innerHTML = ORDER.map((h, i) => row(h, i, day, isToday ? s.streaks[h] : null, isToday)).join("");
  renderViceLock();
}

// The date the page is showing (today unless browsing).
function viewedDate() {
  const last = state.days.length - 1;
  return state.days[viewIdx === null ? last : Math.max(0, Math.min(last, viewIdx))].date;
}

function showDay(idx) {
  viewIdx = idx >= state.days.length - 1 ? null : Math.max(0, idx);
  renderDay();
  renderGrid(state.days.slice(-30), state.days.length - 30);
}
$("day-prev").addEventListener("click", () => showDay((viewIdx ?? state.days.length - 1) - 1));
$("day-next").addEventListener("click", () => showDay((viewIdx ?? state.days.length - 1) + 1));
$("day-today").addEventListener("click", () => showDay(state.days.length - 1));

function row(h, i, day, run, isToday) {
  const d = day[h];
  const app = APPS[h];
  let detail = "", mark = "", href = app.url;
  if (h === "family") {
    detail = d.done ? `<b>${d.count}</b> added` : `<b>${d.count}</b> of ${d.target} memories added`;
    mark = tally(d.count, d.target);
  } else if (h === "garden") {
    if (day.tracked && !d.required) detail = "Retired: out of people";
    else if (d.done) detail = `Planted and called <b>${esc(d.called[0])}</b>`;
    else if (d.waiting.length) detail = isToday ? `Planted <b>${esc(d.waiting[0])}</b>. Call them today.` : `Planted <b>${esc(d.waiting[0])}</b>, no call that day`;
    else detail = isToday ? "Plant one new person, then call them" : "Nobody new planted";
    mark = stateTag(d, isToday);
  } else if (h === "nights") {
    detail = d.done ? (isToday ? "Tonight's three, read" : "All three read") : `<b>${d.count}</b> of 3 read${isToday ? " tonight" : ""}`;
    mark = stateTag(d, isToday);
  } else if (h === "dailylog") {
    // Done: the row opens that day's entry on the Journal site, audio included.
    const last = d.entries[d.entries.length - 1];
    const more = d.entries.length > 1 ? ` <span class="more">+${d.entries.length - 1} more</span>` : "";
    detail = last ? `Listen: <b>${esc(last.headline)}</b>${more}` : isToday ? "Record tonight's voice memo" : "No log recorded";
    if (last && app.url) href = app.url + "/#e-" + encodeURIComponent(last.entry);
    mark = stateTag(d, isToday);
  } else {
    detail = d.done ? `<b>${esc(d.types.join(", "))}</b>` : isToday ? "No session logged yet" : "No session logged";
    mark = stateTag(d, isToday);
  }
  const showRun = run !== null && d.required;
  // No link set in src/setup.js: the row is plain, not a link to nowhere.
  const open = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">` : `<a>`;
  return `<li class="${d.required || d.done ? "" : "off"}">${open}
    <span class="idx">0${i + 1}</span>
    <span class="name">${app.name}</span>
    <span class="mark">${mark}<span class="run">${showRun ? run + "d" : "&nbsp;"}</span></span>
    <span class="detail">${detail}</span>
  </a></li>`;
}

// Today: Done / Open. Past days: Done / Missed. Before tracking: Done / dash.
function stateTag(d, isToday) {
  if (d.done) return `<span class="state done">Done</span>`;
  if (!d.required) return `<span class="state off">–</span>`;
  return `<span class="state open">${isToday ? "Open" : "Missed"}</span>`;
}

// Five-bar gate: four strokes, the fifth slashes across. Uncounted strokes are ghosts.
function tally(n, target) {
  const xs = [5, 13, 21, 29];
  const wob = [[0, 1], [1, -1], [-1, 0], [0, 1]]; // slight hand-drawn lean
  const bars = xs.map((x, i) =>
    `<line class="${n > i ? "on" : "ghost"}" x1="${x + wob[i][0]}" y1="4" x2="${x + wob[i][1]}" y2="26"/>`).join("");
  const slash = `<line class="slash ${n >= target ? "on" : "ghost"}" x1="1" y1="21" x2="33" y2="9"/>`;
  const extra = n > target ? `<span class="extra">+${n - target}</span>` : "";
  return `<span style="display:flex;align-items:center;gap:4px"><svg class="tally" width="34" height="30" viewBox="0 0 34 30" aria-label="${n} of ${target}">${bars}${slash}</svg>${extra}</span>`;
}

// days = the last 30; offset = index of days[0] within state.days.
// Each cell opens its day; the day being viewed is outlined.
function renderGrid(days, offset) {
  const today = state.today;
  const viewed = viewIdx === null ? state.days.length - 1 : viewIdx;
  // Before tracking started nothing was required, but finished days still show.
  const cell = (day, ok, required, i) => {
    let c = ok ? "done" : "none";
    if (required && !ok) c = day.date === today ? "pending" : "miss";
    if (!required && ok) c += " early";
    if (offset + i === viewed) c += " viewed";
    return `<i class="c ${c}" data-idx="${offset + i}" title="${day.date}"></i>`;
  };
  let html = "";
  for (const h of ORDER) {
    html += `<span class="lab">${APPS[h].short}</span>`;
    html += days.map((d, i) => cell(d, d[h].done, d[h].required, i)).join("");
  }
  html += `<span class="sep"></span><span class="lab all">∑</span>`;
  html += days.map((d, i) => `<span class="all">${cell(d, d.allDone, d.tracked, i)}</span>`).join("");
  $("grid").innerHTML = html;
}
$("grid").addEventListener("click", (e) => {
  const c = e.target.closest("[data-idx]");
  if (!c) return;
  showDay(Number(c.dataset.idx));
  document.querySelector(".daynav").scrollIntoView({ block: "start", behavior: "smooth" });
});

// Time left until midnight in the tracker's time zone.
function renderLeft() {
  if (!state) return;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: state.settings.tz, hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  // The day ends at 3 a.m.: count down to the next 3:00.
  const cur = Number(p.hour) * 60 + Number(p.minute);
  const mins = (cur < 180 ? 180 : 24 * 60 + 180) - cur;
  const today = state.days[state.days.length - 1];
  const open = today.open.length;
  $("left").textContent = open ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m left` : "Done";
  $("left").classList.toggle("urgent", open > 0 && mins <= 4 * 60);
}

// ---------- vices ----------
// Tap + to log, − to undo today's last one. Never part of the streak or a push.

const VICE_ROWS = [
  { kind: "drink", name: "Drank", short: "D" },
  { kind: "smoke", name: "Smoked", short: "S" },
  { kind: "sweets", name: "Sweets", short: "W" },
  { kind: "scroll", name: "Doomscrolled", short: "C" },
];

// Yes/no per day for the day being viewed; tap to flip it.
function renderVices(v) {
  if (!v) return;
  const date = viewedDate();
  const isToday = date === v.day;
  const did = v.byDay[date] || {};
  const since = (n) => n === null ? "never logged" : n === 0 ? "last: today" : `<span class="clean">${n} day${n === 1 ? "" : "s"} since</span>`;
  const rows = VICE_ROWS.map((r) => {
    const yes = !!did[r.kind];
    return `<li class="vice">
      <span class="vname">${r.name}</span>
      <button type="button" class="vtoggle ${yes ? "yes" : ""}" data-toggle="${r.kind}" aria-pressed="${yes}"
        aria-label="${r.name} on ${fmtDate(date)}: ${yes ? "yes" : "no"}">${yes ? "Yes" : "No"}</button>
      <span class="vmeta"><b>${v.week[r.kind]}</b> of last 7 days · ${since(v.daysSince[r.kind])}</span>
    </li>`;
  });
  const st = v.screen.byDate[date];
  rows.push(`<li class="vice screen">
    <span class="vname">Screen time</span>
    <span class="big">
      <span class="mins ${st ? "" : "none"}">${st ? fmtMins(st.minutes) : isToday ? "not in yet" : "none"}</span>
      <button type="button" class="btn small ghost" id="st-edit">Edit</button>
    </span>
    <span class="vmeta">${st ? (st.source === "shortcut" ? "from Shortcut" : "typed in") : isToday ? "Shortcut posts it at 11:55 pm" : "not logged"}${v.screen.weekAvg === null ? "" : ` · <b>${fmtMins(v.screen.weekAvg)}</b> 7-day avg`}</span>
  </li>`);
  $("vice-list").innerHTML = rows.join("");
  renderViceGrid(v, date);
}

// Same 30 days as the habit grid: a filled square = did it that day.
function renderViceGrid(v, viewed) {
  const days = state.days.slice(-30), offset = state.days.length - 30;
  let html = "";
  for (const r of VICE_ROWS) {
    html += `<span class="lab">${r.short}</span>`;
    html += days.map((d, i) => {
      const yes = v.byDay[d.date]?.[r.kind];
      return `<i class="c ${yes ? "vdid" : "none"}${d.date === viewed ? " viewed" : ""}" data-idx="${offset + i}" title="${d.date}"></i>`;
    }).join("");
  }
  $("vice-grid").innerHTML = html;
}

function fmtMins(m) { return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; }

function renderViceLock() {
  const open = !!(viceToken && vices);
  $("vice-sum").innerHTML = open ? viceSumText(vices) : "Locked.";
  $("vice-lock").hidden = open;
  $("vice-open").hidden = !open;
  if (open) renderVices(vices);
  else $("vice-list").innerHTML = ""; // nothing left in the page while locked
}

function lockVices() {
  viceToken = null; vices = null;
  clearTimeout(viceTimer);
  $("vice-pass").value = "";
  renderViceLock();
}
function touchVices() { clearTimeout(viceTimer); viceTimer = setTimeout(lockVices, VICE_IDLE_MS); }

async function viceApi(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Vices-Token": viceToken || "" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) { showLogin(); throw new Error("signed out"); }
  if (res.status === 403) { lockVices(); throw new Error("Locked again. Enter the passcode."); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.message || data.error)) || "HTTP " + res.status);
  return data;
}

$("vice-lock").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("vice-msg").textContent = "";
  try {
    const res = await fetch("/api/vices/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: $("vice-pass").value }),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    $("vice-pass").value = "";
    if (!res.ok) { $("vice-msg").textContent = data.message || "Couldn't unlock."; return; }
    viceToken = data.token; vices = data.vices;
    touchVices();
    renderViceLock();
  } catch (err) { $("vice-msg").textContent = err.message; }
});
$("vice-relock").addEventListener("click", lockVices);
$("vice-grid").addEventListener("click", (e) => {
  const c = e.target.closest("[data-idx]");
  if (!c) return;
  touchVices();
  showDay(Number(c.dataset.idx));
  document.querySelector(".daynav").scrollIntoView({ block: "start", behavior: "smooth" });
});
// Leaving the app (switching apps, locking the phone) locks the vices.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") lockVices(); });

$("vice-list").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  try {
    let r;
    const date = viewedDate();
    if (b.dataset.toggle) r = await viceApi("POST", "/api/vices/toggle", { kind: b.dataset.toggle, date });
    else if (b.id === "st-edit") {
      const cur = vices.screen.byDate[date];
      const v = prompt(`Screen time for ${fmtDate(date)} (e.g. 4h 12m, or minutes)`, cur ? fmtMins(cur.minutes) : "");
      if (v === null || !v.trim()) return;
      r = await viceApi("PUT", "/api/screentime", { date, minutes: v.trim() });
    } else return;
    vices = r.vices;
    touchVices();
    renderViceLock();
  } catch (err) { $("vice-msg").textContent = err.message; }
});

$("st-key").addEventListener("click", async () => {
  try {
    const { key } = await api("GET", "/api/screentime/key");
    if (!key) { setMsg("Key isn't set up on the server."); return; }
    await navigator.clipboard.writeText(key);
    setMsg("Key copied. Paste it into the Shortcut.");
  } catch (e) { setMsg("Couldn't copy: " + e.message); }
});

// ---------- to-do ----------
// Open tasks roll over daily; older ones look more urgent (u0–u3).

function renderTodos(t) {
  if (!t) return;
  const bits = [`<b>${t.open}</b> open`];
  if (t.overdue) bits.push(`<b class="warn">${t.overdue}</b> rolled over${t.oldest >= 4 ? ` · oldest ${t.oldest} days` : ""}`);
  if (t.doneToday) bits.push(`<b>${t.doneToday}</b> done today`);
  $("todo-sum").innerHTML = t.open || t.doneToday ? bits.join(" · ") : "Nothing on the list.";
  $("todo-list").innerHTML = t.items.map((x) => `<li class="todo-item u${x.done ? 0 : x.urgency}${x.done ? " done" : ""}">
      <button type="button" class="tbox" data-todo-toggle="${x.id}" aria-pressed="${x.done}" aria-label="${x.done ? "Uncheck" : "Check off"}: ${esc(x.text)}"></button>
      <span class="ttext">${esc(x.text)}</span>
      ${!x.done && x.age ? `<span class="tage">${x.age === 1 ? "since yesterday" : x.age + " days"}</span>` : ""}
      <button type="button" class="tdel" data-todo-del="${x.id}" aria-label="Delete: ${esc(x.text)}">×</button>
    </li>`).join("");
}

$("todo-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("todo-text").value.trim();
  if (!text) return;
  try {
    const r = await api("POST", "/api/todos", { text });
    $("todo-text").value = "";
    state.todos = r.todos;
    renderTodos(state.todos);
  } catch (err) { alert(err.message); }
});

$("todo-list").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-todo-toggle]"), d = e.target.closest("[data-todo-del]");
  try {
    let r;
    if (t) r = await api("POST", `/api/todos/${t.dataset.todoToggle}/toggle`);
    else if (d) {
      if (!confirm("Delete this task?")) return;
      r = await api("DELETE", `/api/todos/${d.dataset.todoDel}`);
    } else return;
    state.todos = r.todos;
    renderTodos(state.todos);
  } catch (err) { alert(err.message); }
});

// ---------- section summaries ----------

function renderSummaries() {
  const s = state;
  const today = s.days[s.days.length - 1];
  const req = ORDER.filter((h) => today[h].required);
  const left = req.filter((h) => !today[h].done);
  $("habits-sum").innerHTML = !req.length ? "Tracking hasn't started yet."
    : left.length ? `<b>${req.length - left.length}</b> of ${req.length} done · left: ${left.map((h) => APPS[h].name).join(", ")}`
    : `All ${words(req.length)} done today.`;

  // Last 7 tracked days, today included only once it's finished.
  const week = s.days.slice(-7).filter((d) => d.tracked && (d.date !== s.today || d.allDone));
  if (!week.length) { $("grid-sum").textContent = "Fills in as the days go by."; return; }
  const per = ORDER.map((h) => [h, week.filter((d) => d[h].done).length]);
  const best = per.reduce((a, b) => (b[1] > a[1] ? b : a));
  const worst = per.reduce((a, b) => (b[1] < a[1] ? b : a));
  $("grid-sum").innerHTML = `Everything done <b>${week.filter((d) => d.allDone).length}</b> of last ${week.length} day${week.length === 1 ? "" : "s"}`
    + (best[1] !== worst[1] ? ` · best: ${APPS[best[0]].name} ${best[1]}/${week.length} · weakest: ${APPS[worst[0]].name} ${worst[1]}/${week.length}` : "");
}

function viceSumText(v) {
  const n = (k) => v.week[k];
  return "Last 7 days: " + VICE_ROWS.map((r) => `${r.name.toLowerCase()} <b>${n(r.kind)}</b>`).join(" · ")
    + (v.screen.weekAvg !== null ? ` · screen <b>${fmtMins(v.screen.weekAvg)}</b>/day` : "");
}

// ---------- settings ----------

function renderSettings() {
  const s = state.settings;
  const sel = $("nudge-hour");
  if (!sel.options.length) {
    for (let h = 12; h <= 23; h++) sel.add(new Option(fmtHour(h), h));
  }
  sel.value = s.nudgeHour;

  const devices = state.push.devices;
  const sent = state.push.sentToday;
  $("push-note").textContent = (devices ? `On for ${devices} device${devices > 1 ? "s" : ""}. ` : "Off. ") +
    (sent ? "Sent today at " + new Date(sent).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "." : "Only fires if something is open.");
  pushButton();

  const phoneTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $("tz-note").textContent = s.tz.replace(/_/g, " ") + (phoneTz !== s.tz ? ` · phone is on ${phoneTz.replace(/_/g, " ")}` : "");
  $("tz-btn").hidden = phoneTz === s.tz;

  const retired = !!s.gardenRetiredFrom;
  $("garden-note").textContent = retired ? "Retired " + fmtDate(s.gardenRetiredFrom) + ". Not required." : "One new person a day, called the same day.";
  $("garden-btn").textContent = retired ? "Resume" : "I'm out of people";

  $("start-note").textContent = fmtDate(s.startDate);

  // Which habits count. Only apps connected in wrangler.jsonc can be turned on.
  $("habit-toggles").innerHTML = s.available.map((h) =>
    `<label class="habit-toggle"><input type="checkbox" value="${h}"${s.habits.includes(h) ? " checked" : ""}> ${APPS[h].name}</label>`).join("");
  $("family-target").value = s.familyTarget;
  $("family-row").hidden = !s.habits.includes("family");
  $("garden-row").hidden = !s.habits.includes("garden");
}

$("habit-toggles").addEventListener("change", () => {
  const on = [...$("habit-toggles").querySelectorAll("input:checked")].map((i) => i.value);
  if (!on.length) { setMsg("Keep at least one habit on."); return render(); }
  saveSettings({ habits: on });
});
$("family-target").addEventListener("change", (e) => {
  const t = Math.round(Number(e.target.value));
  if (t >= 1 && t <= 50) saveSettings({ familyTarget: t }); else { setMsg("Pick 1 to 50."); render(); }
});

$("nudge-hour").addEventListener("change", (e) => saveSettings({ nudgeHour: Number(e.target.value) }));
$("tz-btn").addEventListener("click", () => saveSettings({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
$("garden-btn").addEventListener("click", () => {
  const retire = !state.settings.gardenRetiredFrom;
  if (retire && !confirm("Retire the Garden habit? It stops counting from today.")) return;
  saveSettings({ gardenRetired: retire });
});

async function saveSettings(patch) {
  try {
    state = await api("PATCH", "/api/settings", patch);
    render();
    setMsg("Saved.");
  } catch (e) { setMsg(e.message); }
}

function setMsg(t) {
  $("set-msg").textContent = t;
  if (t) setTimeout(() => { if ($("set-msg").textContent === t) $("set-msg").textContent = ""; }, 4000);
}

// ---------- push ----------

const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let swReg = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((r) => { swReg = r; pushButton(); }).catch(() => {});
}

async function currentSub() {
  if (!swReg || !pushSupported) return null;
  return swReg.pushManager.getSubscription();
}

async function pushButton() {
  const btn = $("push-btn");
  if (!pushSupported) {
    btn.disabled = true;
    btn.textContent = "Turn on";
    if (isIOS && !standalone) $("push-note").textContent = "Add to Home Screen first, then open it from there.";
    return;
  }
  const sub = await currentSub();
  btn.disabled = false;
  btn.textContent = sub ? "Turn off" : "Turn on";
}

$("push-btn").addEventListener("click", async () => {
  try {
    const existing = await currentSub();
    if (existing) {
      await api("DELETE", "/api/push/subscribe", { endpoint: existing.endpoint });
      await existing.unsubscribe();
      setMsg("Nudges off on this device.");
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setMsg("Notifications are blocked. Allow them in Settings."); return; }
      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToBytes(state.push.publicKey),
      });
      await api("POST", "/api/push/subscribe", sub.toJSON());
      setMsg("Nudges on.");
    }
    await refresh();
  } catch (e) { setMsg("Couldn't change nudges: " + e.message); }
});

$("push-test").addEventListener("click", async () => {
  try {
    const r = await api("POST", "/api/push/test");
    setMsg(r.error ? r.error : `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}${r.failed ? `, ${r.failed} failed` : ""}.`);
    refresh();
  } catch (e) { setMsg(e.message); }
});

// ---------- helpers ----------

function b64uToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function fmtDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtHour(h) { return (h % 12 || 12) + (h < 12 ? " am" : " pm"); }
function words(n) { return ["zero", "one", "two", "three", "four", "five"][n] || String(n); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- go ----------

refresh();
setInterval(renderLeft, 30_000);
setInterval(refresh, 5 * 60_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
