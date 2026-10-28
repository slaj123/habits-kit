// Tiny, dependency-free helpers for `npm run setup`.
//
// Two ways in:
//   npm run setup               asks questions in the terminal, saves setup.json, applies it
//   npm run setup -- --apply    skips the questions and applies an existing setup.json
//                               (this is what Claude Code's /setup uses after it writes setup.json)
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stdin, stdout } from "node:process";

export const APPLY_ONLY = process.argv.includes("--apply");

export function loadSetup(file, defaults) {
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return { ...defaults, ...saved };
}

export function saveSetup(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nSaved your answers to ${file}.`);
}

// Lines are queued as they arrive, so answers piped in all at once
// (`printf "a\nb\n" | npm run setup`) aren't lost between questions.
let rl = null, closed = false;
const queue = [], waiting = [];
function nextLine() {
  if (!rl) {
    rl = createInterface({ input: stdin });
    rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : queue.push(l)));
    rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()(""); });
  }
  if (queue.length) return Promise.resolve(queue.shift());
  if (closed) return Promise.resolve("");
  return new Promise((resolve) => waiting.push(resolve));
}
export function done() { rl?.close(); }

// Free text. Enter keeps the current value.
export async function ask(question, current = "") {
  stdout.write(`${question}${current !== "" ? ` [${current}]` : ""}: `);
  const a = (await nextLine()).trim();
  if (!stdin.isTTY) stdout.write(a + "\n");
  return a || String(current);
}

export async function askNumber(question, current, { min = -Infinity, max = Infinity } = {}) {
  for (;;) {
    const n = Number(await ask(question, current));
    if (Number.isFinite(n) && n >= min && n <= max) return n;
    console.log(`  Enter a number from ${min} to ${max}.`);
  }
}

export async function askYesNo(question, current = true) {
  const a = (await ask(`${question} (y/n)`, current ? "y" : "n")).toLowerCase();
  return a.startsWith("y");
}

// Comma-separated list. Enter keeps the current list.
export async function askList(question, current = []) {
  const a = await ask(`${question} (comma-separated)`, current.join(", "));
  return [...new Set(a.split(",").map((s) => s.trim()).filter(Boolean))];
}

// Pick any of a fixed set of options by number, e.g. "1,3,4".
export async function askPick(question, options, current = options) {
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o}${current.includes(o) ? "  (on)" : ""}`));
  const a = await ask("Numbers to turn on, or Enter to keep", current.map((o) => options.indexOf(o) + 1).filter(Boolean).join(","));
  const picked = a.split(",").map((s) => options[Number(s.trim()) - 1]).filter(Boolean);
  return picked.length ? [...new Set(picked)] : current;
}

export function validTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export async function askTimeZone(current) {
  for (;;) {
    const tz = await ask("Your time zone (e.g. America/New_York, Europe/London)", current || Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (validTimeZone(tz)) return tz;
    console.log("  That isn't a time zone name. See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones");
  }
}

// Runs wrangler from this project's node_modules, printing its output.
export function wrangler(...args) {
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], { stdio: "inherit" });
}

export const sqlString = (s) => "'" + String(s).replace(/'/g, "''") + "'";
