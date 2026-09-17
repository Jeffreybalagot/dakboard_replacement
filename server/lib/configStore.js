const { readJson, writeJson } = require("./store");

const CONFIG_KEY = "config";

const DEFAULT_CONFIG = {
  // IANA timezone name, e.g. "America/Los_Angeles"
  timezone: "America/Los_Angeles",
  location: {
    name: "Dublin, CA",
    lat: 37.7022,
    lon: -121.9358,
  },
  // Every Google calendar the user has connected, with a checkbox to show/hide it.
  // { id, summary, color, enabled }
  calendars: [],
  // How many days ahead the agenda panel should show.
  agendaDays: 7,
  // Public URL of the Immich kiosk slideshow to embed.
  immichUrl: "https://kiosk.jellymorph.net/",
  // Seconds between frontend refreshes of events/weather.
  refreshIntervalSeconds: 300,
  // Multiplier applied to the calendar event text size (0.5 - 1.5).
  calendarFontScale: 1,
};

function getConfig() {
  const stored = readJson(CONFIG_KEY, {});
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    location: { ...DEFAULT_CONFIG.location, ...(stored.location || {}) },
  };
}

function saveConfig(partial) {
  const current = getConfig();
  const next = {
    ...current,
    ...partial,
    location: { ...current.location, ...(partial.location || {}) },
  };
  writeJson(CONFIG_KEY, next);
  return next;
}

function setCalendars(calendars) {
  return saveConfig({ calendars });
}

module.exports = { getConfig, saveConfig, setCalendars, DEFAULT_CONFIG };
