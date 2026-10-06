const express = require("express");

const router = express.Router();

// Reads the chicken coop egg count from Home Assistant. Home Assistant does
// the actual counting (an hourly automation writes input_number.egg_count);
// this route just relays that one entity's state so the browser never sees
// the Home Assistant token.
//
// Configure with env vars: HA_URL, HA_TOKEN (a Home Assistant long-lived
// access token), and optionally HA_EGG_ENTITY. Leave HA_TOKEN blank to hide
// the tile entirely.
let cache = { at: 0, data: null };
const CACHE_MS = 60 * 1000;

router.get("/", async (req, res) => {
  const baseUrl = (process.env.HA_URL || "").replace(/\/+$/, "");
  const token = process.env.HA_TOKEN;
  const entity = process.env.HA_EGG_ENTITY || "input_number.egg_count";

  if (!baseUrl || !token) {
    return res.json({ configured: false });
  }

  if (cache.data && Date.now() - cache.at < CACHE_MS) {
    return res.json(cache.data);
  }

  try {
    const response = await fetch(`${baseUrl}/api/states/${encodeURIComponent(entity)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`Home Assistant responded ${response.status}`);
    }
    const state = await response.json();
    const count = Number.parseFloat(state.state);

    const payload = {
      configured: true,
      count: Number.isFinite(count) ? Math.round(count) : null,
      updatedAt: state.last_updated || null,
    };
    cache = { at: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    console.error("Egg count fetch failed:", err.message);
    res.status(502).json({ configured: true, error: "Could not reach Home Assistant." });
  }
});

module.exports = router;
