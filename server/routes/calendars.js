const express = require("express");
const { getCalendarClient, isConnected } = require("../lib/googleClient");
const { getConfig, setCalendars } = require("../lib/configStore");

const router = express.Router();

// List every calendar on the connected Google account, merged with the
// user's current show/hide + ordering choices, for the config GUI's checklist.
router.get("/", async (req, res) => {
  if (!isConnected()) {
    return res.status(401).json({ error: "Not connected to Google yet." });
  }
  try {
    const calendar = getCalendarClient();
    const { data } = await calendar.calendarList.list({ maxResults: 250 });
    const items = data.items || [];

    const config = getConfig();
    const existingById = new Map(config.calendars.map((c) => [c.id, c]));

    const merged = items.map((cal) => {
      const existing = existingById.get(cal.id);
      return {
        id: cal.id,
        summary: cal.summaryOverride || cal.summary,
        color: cal.backgroundColor || "#4285f4",
        primary: Boolean(cal.primary),
        // Default new calendars to enabled so nothing is silently hidden on first connect.
        enabled: existing ? existing.enabled : true,
      };
    });

    res.json(merged);
  } catch (err) {
    console.error("[calendars] list failed:", err);
    res.status(500).json({ error: "Failed to list Google calendars.", detail: err.message });
  }
});

// Save which calendars are enabled/disabled (and their display order).
router.put("/", (req, res) => {
  const calendars = Array.isArray(req.body) ? req.body : req.body?.calendars;
  if (!Array.isArray(calendars)) {
    return res.status(400).json({ error: "Expected an array of calendars." });
  }
  const cleaned = calendars
    .filter((c) => c && typeof c.id === "string")
    .map((c) => ({
      id: c.id,
      summary: String(c.summary || c.id),
      color: c.color || "#4285f4",
      enabled: Boolean(c.enabled),
    }));
  const updated = setCalendars(cleaned);
  res.json(updated.calendars);
});

module.exports = router;
