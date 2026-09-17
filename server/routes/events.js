const express = require("express");
const { getCalendarClient, isConnected } = require("../lib/googleClient");
const { getConfig } = require("../lib/configStore");
const { dedupeEvents } = require("../lib/dedupe");

const router = express.Router();

router.get("/", async (req, res) => {
  if (!isConnected()) {
    return res.status(401).json({ error: "Not connected to Google yet." });
  }

  const config = getConfig();
  const enabledCalendars = config.calendars.filter((c) => c.enabled);

  if (enabledCalendars.length === 0) {
    return res.json({ events: [], calendars: [] });
  }

  // Accepts an explicit ?start=YYYY-MM-DD&end=YYYY-MM-DD range (used by the
  // frontend to fetch a full month-grid's worth of days, including the
  // leading/trailing days from adjacent months that fill out the grid).
  // Falls back to "today through +agendaDays" if no range is given.
  let timeMin;
  let timeMax;
  if (req.query.start && req.query.end) {
    timeMin = new Date(`${req.query.start}T00:00:00`);
    timeMax = new Date(`${req.query.end}T23:59:59`);
  } else {
    timeMin = new Date();
    timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + (config.agendaDays || 7));
  }

  try {
    const calendarClient = getCalendarClient();

    const results = await Promise.allSettled(
      enabledCalendars.map((cal, priority) =>
        calendarClient.events
          .list({
            calendarId: cal.id,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 250,
          })
          .then((resp) => ({ cal, priority, items: resp.data.items || [] }))
      )
    );

    const entries = [];
    const errors = [];

    for (const result of results) {
      if (result.status !== "fulfilled") {
        errors.push(result.reason?.message || "Unknown calendar fetch error");
        continue;
      }
      const { cal, priority, items } = result.value;
      for (const event of items) {
        // Skip events the user has declined on this calendar.
        const self = (event.attendees || []).find((a) => a.self);
        if (self && self.responseStatus === "declined") continue;

        entries.push({
          event,
          calendarId: cal.id,
          calendarPriority: priority,
          calendarSummary: cal.summary,
          calendarColor: cal.color,
        });
      }
    }

    const deduped = dedupeEvents(entries).map(({ event, calendarId, calendarSummary, calendarColor }) => ({
      id: event.id,
      title: event.summary || "(No title)",
      description: event.description || "",
      location: event.location || "",
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      allDay: Boolean(event.start?.date && !event.start?.dateTime),
      calendarId,
      calendarSummary,
      calendarColor,
    }));

    deduped.sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({
      events: deduped,
      calendars: enabledCalendars.map((c) => ({ id: c.id, summary: c.summary, color: c.color })),
      errors,
    });
  } catch (err) {
    console.error("[events] fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch calendar events.", detail: err.message });
  }
});

module.exports = router;
