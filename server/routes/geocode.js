const express = require("express");

const router = express.Router();

// Lets the config GUI turn "Dublin, CA" into lat/lon without the user having
// to look coordinates up themselves. Uses Open-Meteo's free geocoding API
// (same provider as weather, no key required).
router.get("/", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing ?q search text." });

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", "5");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Geocoding API responded ${response.status}`);
    const data = await response.json();
    const results = (data.results || []).map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
    }));
    res.json(results);
  } catch (err) {
    console.error("[geocode] failed:", err);
    res.status(502).json({ error: "Geocoding lookup failed.", detail: err.message });
  }
});

module.exports = router;
