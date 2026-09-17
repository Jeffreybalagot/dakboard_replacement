const express = require("express");
const { getConfig } = require("../lib/configStore");

const router = express.Router();

// Simple in-memory cache: Open-Meteo is free/keyless but there's no reason to
// hit it more than once every few minutes for a wall dashboard.
let cache = { key: null, at: 0, data: null };
const CACHE_MS = 10 * 60 * 1000;

router.get("/", async (req, res) => {
  const config = getConfig();
  const { lat, lon } = config.location;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "Location lat/lon is not configured yet." });
  }

  const cacheKey = `${lat},${lon},${config.timezone}`;
  if (cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) {
    return res.json(cache.data);
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("timezone", config.timezone || "auto");
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day"
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset"
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("forecast_days", "7");

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo responded ${response.status}`);
    }
    const data = await response.json();

    const payload = {
      location: config.location,
      current: data.current,
      daily: data.daily,
      units: {
        temperature: data.current_units?.temperature_2m || "°F",
        wind: data.current_units?.wind_speed_10m || "mph",
      },
      fetchedAt: new Date().toISOString(),
    };

    cache = { key: cacheKey, at: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    console.error("[weather] fetch failed:", err);
    res.status(502).json({ error: "Failed to fetch weather.", detail: err.message });
  }
});

module.exports = router;
