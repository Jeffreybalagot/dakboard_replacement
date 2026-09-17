const express = require("express");
const { getConfig, saveConfig } = require("../lib/configStore");

const router = express.Router();

const ALLOWED_FONT_SCALES = [0.5, 0.75, 1, 1.25, 1.5];
const ALLOWED_WRAP_MODES = ["1", "2", "full"];

router.get("/", (req, res) => {
  res.json(getConfig());
});

router.put("/", (req, res) => {
  const body = req.body || {};
  const allowed = {};

  if (typeof body.timezone === "string") allowed.timezone = body.timezone;
  if (typeof body.immichUrl === "string") allowed.immichUrl = body.immichUrl;
  if (Number.isFinite(body.agendaDays)) allowed.agendaDays = body.agendaDays;
  if (Number.isFinite(body.refreshIntervalSeconds)) {
    allowed.refreshIntervalSeconds = body.refreshIntervalSeconds;
  }
  if (ALLOWED_FONT_SCALES.includes(body.calendarFontScale)) {
    allowed.calendarFontScale = body.calendarFontScale;
  }
  if (ALLOWED_WRAP_MODES.includes(body.eventWrapMode)) {
    allowed.eventWrapMode = body.eventWrapMode;
  }
  if (body.location && typeof body.location === "object") {
    const { name, lat, lon } = body.location;
    allowed.location = {
      ...(typeof name === "string" ? { name } : {}),
      ...(Number.isFinite(lat) ? { lat } : {}),
      ...(Number.isFinite(lon) ? { lon } : {}),
    };
  }
  if (Array.isArray(body.calendars)) {
    allowed.calendars = body.calendars
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({
        id: c.id,
        summary: String(c.summary || c.id),
        color: c.color || "#4285f4",
        enabled: Boolean(c.enabled),
      }));
  }

  const updated = saveConfig(allowed);
  res.json(updated);
});

module.exports = router;
