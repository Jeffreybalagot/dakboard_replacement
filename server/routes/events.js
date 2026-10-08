const express = require("express");
const {
  getCalendarClientForAccount,
  isConnected,
  describeGoogleError,
  setAccountHealth,
} = require("../lib/googleClient");
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
    // Calendars may belong to different linked Google accounts, each of
    // which needs its own authenticated client. Priority is the calendar's
    // position in the user's configured list, used by dedupe to break ties
    // when the same event appears on more than one enabled calendar.
    // One authenticated client per account (not per calendar), so an
    // account with several enabled calendars refreshes its token once
    // instead of racing N parallel refreshes.
    const clients = new Map();
    const clientFor = (email) => {
      if (!clients.has(email)) clients.set(email, getCalendarClientForAccount(email));
      return clients.get(email);
    };

    const results = await Promise.allSettled(
      enabledCalendars.map(async (cal, priority) => {
        try {
          const resp = await clientFor(cal.accountEmail).events.list({
            calendarId: cal.calendarId || cal.id,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 250,
          });
          return { cal, priority, items: resp.data.items || [] };
        } catch (err) {
          err.cal = cal; // keep track of which calendar/account failed
          throw err;
        }
      })
    );

    const entries = [];
    const errors = [];
    const failedAccounts = new Map(); // email -> problem
    const okAccounts = new Set();

    for (const result of results) {
      if (result.status !== "fulfilled") {
        const err = result.reason || {};
        const cal = err.cal || {};
        const problem = describeGoogleError(err);
        console.error(
          `[events] ${cal.accountEmail || "?"} / ${cal.summary || cal.calendarId || "?"}: ${problem.message} (${problem.detail})`
        );
        errors.push({
          accountEmail: cal.accountEmail || "unknown account",
          calendarId: cal.id,
          calendarSummary: cal.summary || cal.calendarId || "unknown calendar",
          message: problem.message,
          needsReconnect: problem.needsReconnect,
        });
        if (cal.accountEmail && problem.needsReconnect) failedAccounts.set(cal.accountEmail, problem);
        continue;
      }
      const { cal, priority, items } = result.value;
      okAccounts.add(cal.accountEmail);
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
          accountEmail: cal.accountEmail,
        });
      }
    }

    // Persist per-account health so the config page can flag broken accounts.
    for (const [email, problem] of failedAccounts) setAccountHealth(email, problem);
    for (const email of okAccounts) if (!failedAccounts.has(email)) setAccountHealth(email, null);

    const deduped = dedupeEvents(entries).map(
      ({ event, calendarId, calendarSummary, calendarColor, accountEmail }) => ({
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
        accountEmail,
      })
    );

    deduped.sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({
      events: deduped,
      calendars: enabledCalendars.map((c) => ({
        id: c.id,
        summary: c.summary,
        color: c.color,
        accountEmail: c.accountEmail,
      })),
      errors,
    });
  } catch (err) {
    console.error("[events] fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch calendar events.", detail: err.message });
  }
});

module.exports = router;
