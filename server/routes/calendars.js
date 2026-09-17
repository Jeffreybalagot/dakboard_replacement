const express = require("express");
const { getCalendarClientForAccount, listAccounts, isConnected } = require("../lib/googleClient");
const { getConfig, setCalendars } = require("../lib/configStore");

const router = express.Router();

// Composite id so the same raw Google calendar id from two different linked
// accounts never collides (e.g. both accounts have a calendar id "primary").
function compositeId(email, calendarId) {
  return `${email}::${calendarId}`;
}

// List every calendar across every linked Google account, merged with the
// user's current show/hide choices, for the config GUI's checklist.
router.get("/", async (req, res) => {
  if (!isConnected()) {
    return res.status(401).json({ error: "Not connected to Google yet." });
  }
  try {
    const config = getConfig();
    const existingById = new Map(config.calendars.map((c) => [c.id, c]));
    const errors = [];

    const perAccount = await Promise.all(
      listAccounts().map(async ({ email }) => {
        try {
          const calendar = getCalendarClientForAccount(email);
          const { data } = await calendar.calendarList.list({ maxResults: 250 });
          const items = data.items || [];
          return items.map((cal) => {
            const id = compositeId(email, cal.id);
            const existing = existingById.get(id);
            return {
              id,
              accountEmail: email,
              calendarId: cal.id,
              summary: cal.summaryOverride || cal.summary,
              color: cal.backgroundColor || "#4285f4",
              primary: Boolean(cal.primary),
              // Default new calendars to enabled so nothing is silently hidden on first connect.
              enabled: existing ? existing.enabled : true,
            };
          });
        } catch (err) {
          console.error(`[calendars] list failed for ${email}:`, err);
          errors.push(`${email}: ${err.message}`);
          return [];
        }
      })
    );

    const merged = perAccount.flat();
    res.json({ calendars: merged, errors });
  } catch (err) {
    console.error("[calendars] list failed:", err);
    res.status(500).json({ error: "Failed to list Google calendars.", detail: err.message });
  }
});

// Save which calendars are enabled/disabled (and their display order), across
// all linked accounts.
router.put("/", (req, res) => {
  const calendars = Array.isArray(req.body) ? req.body : req.body?.calendars;
  if (!Array.isArray(calendars)) {
    return res.status(400).json({ error: "Expected an array of calendars." });
  }
  const cleaned = calendars
    .filter((c) => c && typeof c.id === "string" && typeof c.accountEmail === "string")
    .map((c) => ({
      id: c.id,
      accountEmail: c.accountEmail,
      calendarId: c.calendarId || c.id.slice(c.accountEmail.length + 2),
      summary: String(c.summary || c.id),
      color: c.color || "#4285f4",
      enabled: Boolean(c.enabled),
    }));
  const updated = setCalendars(cleaned);
  res.json(updated.calendars);
});

module.exports = router;
