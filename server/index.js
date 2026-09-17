require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const configRoutes = require("./routes/config");
const calendarRoutes = require("./routes/calendars");
const eventRoutes = require("./routes/events");
const weatherRoutes = require("./routes/weather");
const geocodeRoutes = require("./routes/geocode");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

const CONFIG_COOKIE = "dakboard_config_auth";

// Optional shared-secret gate for the config GUI, so it's not wide open on
// your LAN. Leave CONFIG_PASSWORD unset/blank in .env to disable this.
app.post("/auth/login", (req, res) => {
  const password = process.env.CONFIG_PASSWORD;
  if (!password) return res.json({ ok: true });
  if (req.body?.password !== password) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  res.cookie(CONFIG_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  });
  res.json({ ok: true });
});

app.use((req, res, next) => {
  const password = process.env.CONFIG_PASSWORD;
  const guardedPaths = ["/config.html", "/api/config", "/api/calendars", "/auth"];
  const isGuarded = guardedPaths.some((p) => req.path === p || req.path.startsWith(p));
  const isLoginRoute = req.path === "/auth/login";
  if (!password || !isGuarded || isLoginRoute) return next();

  if (req.cookies?.[CONFIG_COOKIE] === password) return next();
  if (req.path === "/config.html") {
    return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }
  return res.status(401).json({ error: "Not authenticated. Log in at /login.html." });
});

app.use("/auth", authRoutes);
app.use("/api/config", configRoutes);
app.use("/api/calendars", calendarRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/geocode", geocodeRoutes);

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Dakboard replacement listening on http://0.0.0.0:${PORT}`);
});
