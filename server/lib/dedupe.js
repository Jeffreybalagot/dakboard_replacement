// De-duplicate events that appear on more than one of the user's calendars.
// This commonly happens with shared calendars (e.g. a spouse's calendar that
// is also mirrored onto a "Family" calendar): the same event comes back once
// per calendar it's synced to, and we only want to render it once.
//
// Strategy: build a signature from the normalized title + start + end time.
// Google's own recurring-event id (`event.iCalUID`) is used first when present,
// since it is stable across calendars for the *same* underlying event and is
// more reliable than title matching. Fall back to a normalized-title+time key
// for events that don't share an iCalUID but are clearly the same thing
// (common with events copied rather than truly shared).
function normalizeTitle(summary) {
  return (summary || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function eventTimeKey(event) {
  const start = event.start?.dateTime || event.start?.date || "";
  const end = event.end?.dateTime || event.end?.date || "";
  return `${start}|${end}`;
}

function signatureFor(event) {
  if (event.iCalUID) {
    return `ical:${event.iCalUID}`;
  }
  return `title:${normalizeTitle(event.summary)}|${eventTimeKey(event)}`;
}

/**
 * @param {Array<{event: object, calendarId: string, calendarPriority: number}>} entries
 * @returns {Array<object>} deduped events, each tagged with the calendar it was kept from
 */
function dedupeEvents(entries) {
  const bySignature = new Map();

  for (const entry of entries) {
    const sig = signatureFor(entry.event);
    const existing = bySignature.get(sig);
    if (!existing || entry.calendarPriority < existing.calendarPriority) {
      // Lower priority number wins ties = calendars earlier in the user's
      // configured list "win" when the same event shows up on two of them.
      bySignature.set(sig, entry);
    }
  }

  return Array.from(bySignature.values());
}

module.exports = { dedupeEvents, signatureFor, normalizeTitle };
