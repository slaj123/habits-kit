// Your habits. Written by `npm run setup` (or Claude Code's /setup) from setup.json.
// Turning habits on and off, time zone and nudge hour can also be changed in the app's Settings,
// which win over this file. A habit can only be on if its app's database is bound in wrangler.jsonc.
export default {
  habits: ["family", "garden", "nights", "workout", "dailylog"],
  timeZone: "America/Los_Angeles",
  nudgeHour: 20,
  familyTarget: 5,
  // Your person id in Family Map: only memories you add count.
  me: "me",
  // Each habit row links to its app. Leave "" for no link.
  urls: { family: "", garden: "", nights: "", workout: "", dailylog: "" },
};
