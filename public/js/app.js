/* global weatherInfo */

let appConfig = null;
let refreshTimer = null;

function pad(n) {
  return String(n).padStart(2, "0");
}

function tickClock() {
  const now = new Date();
  let hours = now.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  document.getElementById("clock").innerHTML =
    `${hours}:${pad(now.getMinutes())}<span class="ampm">${ampm}</span>`;

  document.getElementById("date").textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function showBanner(message, { html = false } = {}) {
  const banner = document.getElementById("status-banner");
  if (!message) {
    banner.style.display = "none";
    return;
  }
  if (html) banner.innerHTML = message;
  else banner.textContent = message;
  banner.style.display = "block";
}

// Groups per-calendar errors by Google account so the banner names exactly
// which account(s) are broken and which of their calendars are missing.
function renderCalendarErrors(errors) {
  const byAccount = new Map();
  for (const e of errors) {
    // Older servers sent plain strings; show those as-is.
    const err = typeof e === "string" ? { accountEmail: "unknown account", calendarSummary: "", message: e } : e;
    const key = err.accountEmail || "unknown account";
    if (!byAccount.has(key)) byAccount.set(key, { message: err.message, needsReconnect: false, calendars: [] });
    const entry = byAccount.get(key);
    if (err.calendarSummary) entry.calendars.push(err.calendarSummary);
    if (err.needsReconnect) entry.needsReconnect = true;
  }
  const items = [...byAccount].map(([email, info]) => {
    const cals = info.calendars.length ? ` <span class="banner-cals">(${info.calendars.map(escapeHtml).join(", ")})</span>` : "";
    const action = info.needsReconnect && !/reconnect/i.test(info.message || "") ? ` <span class="banner-action">→ reconnect in Settings</span>` : "";
    const settings = info.needsReconnect ? ` <span class="banner-action">(Settings → Reconnect)</span>` : "";
    return `<li><span class="banner-account">${escapeHtml(email)}</span>${cals}: ${escapeHtml(info.message)}${action || settings}</li>`;
  });
  const n = byAccount.size;
  return `<strong>${n === 1 ? "1 account" : `${n} accounts`} failed to load:</strong><ul class="banner-list">${items.join("")}</ul>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Month grid ----------

function dateKey(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function localDateKeyFromDate(date) {
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

// Key an event by the local calendar date it starts on. All-day events carry
// a plain "YYYY-MM-DD" already (no timezone conversion needed); timed events
// get converted from their ISO datetime to the viewer's local date.
function eventDateKey(event) {
  if (event.allDay) return event.start.slice(0, 10);
  return localDateKeyFromDate(new Date(event.start));
}

function compactTime(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "p" : "a";
  hours = hours % 12 || 12;
  return minutes === 0 ? `${hours}${period}` : `${hours}:${pad(minutes)}${period}`;
}

// Builds a rolling 5-week grid (Sun-Sat rows) with the current week in the
// second row: 1 week before, this week, 3 weeks after.
const WEEKS_BEFORE = 1;
const WEEKS_AFTER = 3;

function buildRollingGrid(anchor) {
  const thisWeekStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());

  const gridStart = new Date(thisWeekStart);
  gridStart.setDate(gridStart.getDate() - WEEKS_BEFORE * 7);

  const totalDays = (WEEKS_BEFORE + 1 + WEEKS_AFTER) * 7;
  const currentWeekKey = localDateKeyFromDate(thisWeekStart);

  const days = [];
  const cursor = new Date(gridStart);
  for (let i = 0; i < totalDays; i++) {
    const weekStart = new Date(cursor);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    days.push({
      date: new Date(cursor),
      key: localDateKeyFromDate(cursor),
      month: cursor.getMonth(),
      year: cursor.getFullYear(),
      isPast: cursor < new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()),
      inCurrentWeek: localDateKeyFromDate(weekStart) === currentWeekKey,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  const gridEnd = new Date(cursor);
  gridEnd.setDate(gridEnd.getDate() - 1);
  return { days, gridStart, gridEnd };
}

// Each month gets its own colour so it's obvious where a new month starts.
// Index 0 = January. Accent is used for the month label / top border, tint
// for the cell background.
const MONTH_COLORS = [
  { accent: "#5b9cff", tint: "rgba(91,156,255,0.10)" },  // Jan
  { accent: "#e56fb0", tint: "rgba(229,111,176,0.10)" }, // Feb
  { accent: "#4cc38a", tint: "rgba(76,195,138,0.10)" },  // Mar
  { accent: "#b58cff", tint: "rgba(181,140,255,0.10)" }, // Apr
  { accent: "#f2c14e", tint: "rgba(242,193,78,0.09)" },  // May
  { accent: "#3fc1c9", tint: "rgba(63,193,201,0.10)" },  // Jun
  { accent: "#ff7b54", tint: "rgba(255,123,84,0.10)" },  // Jul
  { accent: "#7fd35b", tint: "rgba(127,211,91,0.09)" },  // Aug
  { accent: "#6f8cff", tint: "rgba(111,140,255,0.11)" }, // Sep
  { accent: "#ff9f1c", tint: "rgba(255,159,28,0.10)" },  // Oct
  { accent: "#c98b5b", tint: "rgba(201,139,91,0.11)" },  // Nov
  { accent: "#e5534b", tint: "rgba(229,83,75,0.10)" },   // Dec
];

function renderMonthKey(grid) {
  const el = document.getElementById("month-key");
  const seen = [];
  for (const d of grid.days) {
    const id = `${d.year}-${d.month}`;
    if (!seen.some((s) => s.id === id)) seen.push({ id, date: d.date, month: d.month });
  }
  el.innerHTML = seen
    .map((s) => {
      const c = MONTH_COLORS[s.month];
      const label = s.date.toLocaleDateString(undefined, { month: "long" });
      return `<span class="month-key-item" style="--month-accent:${c.accent};--month-tint:${c.tint}">${label}</span>`;
    })
    .join("");
}

function renderLegend(calendars) {
  const legend = document.getElementById("legend");
  if (!calendars || calendars.length === 0) {
    legend.innerHTML = "";
    return;
  }
  legend.innerHTML = calendars
    .map(
      (c) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${c.color}"></span>${escapeHtml(c.summary)}</span>`
    )
    .join("");
}

function renderMonthGrid(grid, eventsByDay) {
  const container = document.getElementById("month-grid");
  const todayKey = localDateKeyFromDate(new Date());
  const MAX_VISIBLE = 5;

  let html = "";
  grid.days.forEach((day, i) => {
    const events = eventsByDay.get(day.key) || [];
    const isToday = day.key === todayKey;
    const color = MONTH_COLORS[day.month];
    const isFirstOfMonth = day.date.getDate() === 1;
    // Show the month name on the 1st, and on the very first cell of the grid.
    const showMonth = isFirstOfMonth || i === 0;

    const classes = ["day-cell"];
    if (day.isPast) classes.push("past");
    if (day.inCurrentWeek) classes.push("current-week");
    if (isToday) classes.push("is-today");
    if (isFirstOfMonth) classes.push("month-start");

    html += `<div class="${classes.join(" ")}" style="--month-accent:${color.accent};--month-tint:${color.tint}">`;
    html += `<div class="day-head">`;
    html += `<div class="day-number${isToday ? " today" : ""}">${day.date.getDate()}</div>`;
    if (showMonth) {
      html += `<div class="month-label">${day.date.toLocaleDateString(undefined, { month: "short" })}</div>`;
    }
    html += `</div>`;
    html += `<div class="day-events">`;

    const visible = events.slice(0, MAX_VISIBLE);
    for (const event of visible) {
      const timeLabel = event.allDay ? "" : `<span class="chip-time">${compactTime(new Date(event.start))}</span>`;
      html += `<div class="event-chip" style="border-left-color:${event.calendarColor}" title="${escapeHtml(event.title)}">${timeLabel}${escapeHtml(event.title)}</div>`;
    }
    if (events.length > MAX_VISIBLE) {
      html += `<div class="day-more">+${events.length - MAX_VISIBLE} more</div>`;
    }

    html += `</div></div>`;
  });
  container.innerHTML = html;
}

async function loadEvents() {
  const grid = buildRollingGrid(new Date());
  renderMonthKey(grid);
  const startParam = localDateKeyFromDate(grid.gridStart);
  const endParam = localDateKeyFromDate(grid.gridEnd);

  try {
    const res = await fetch(`/api/events?start=${startParam}&end=${endParam}`);
    if (res.status === 401) {
      document.getElementById("month-grid").innerHTML = "";
      showBanner('Not connected to Google Calendar yet. Open /config.html to connect.');
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load events");

    renderLegend(data.calendars);

    const eventsByDay = new Map();
    for (const event of data.events) {
      const key = eventDateKey(event);
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key).push(event);
    }

    renderMonthGrid(grid, eventsByDay);

    if (data.errors && data.errors.length) {
      showBanner(renderCalendarErrors(data.errors), { html: true });
    } else {
      showBanner(null);
    }
  } catch (err) {
    console.error(err);
    showBanner("Couldn't load calendar events.");
  }
}

// ---------- Weather ----------

async function loadWeather() {
  try {
    const res = await fetch("/api/weather");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load weather");

    document.getElementById("weather-location").textContent = data.location.name || "";

    const current = data.current;
    const info = weatherInfo(current.weather_code);
    document.getElementById("weather-icon").textContent = info.icon;
    document.getElementById("weather-temp").textContent = `${Math.round(current.temperature_2m)}°`;
    document.getElementById("weather-sub").textContent =
      `${info.label} · Feels ${Math.round(current.apparent_temperature)}°`;

    const forecastEl = document.getElementById("weather-forecast");
    const days = data.daily.time || [];
    let html = "";
    for (let i = 0; i < Math.min(5, days.length); i++) {
      const d = new Date(`${days[i]}T00:00:00`);
      const label = i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" });
      const dInfo = weatherInfo(data.daily.weather_code[i]);
      const precip = data.daily.precipitation_probability_max?.[i];
      html += `
        <div class="forecast-day">
          <div class="forecast-day-label">${label}</div>
          <div class="forecast-icon">${dInfo.icon}</div>
          ${Number.isFinite(precip) ? `<div class="forecast-precip">${precip}%</div>` : ""}
          <div class="forecast-temps"><span class="forecast-hi">${Math.round(data.daily.temperature_2m_max[i])}°</span><span class="forecast-lo">${Math.round(data.daily.temperature_2m_min[i])}°</span></div>
        </div>`;
    }
    forecastEl.innerHTML = html;
  } catch (err) {
    console.error(err);
    document.getElementById("weather-sub").textContent = "Weather unavailable";
  }
}

// ---------- Egg count (Home Assistant) ----------

async function loadEggs() {
  const tile = document.getElementById("egg-tile");
  try {
    const res = await fetch("/api/eggs");
    const data = await res.json();
    if (!data.configured) {
      tile.hidden = true;
      return;
    }
    tile.hidden = false;
    const label = document.getElementById("egg-count");
    if (!res.ok || data.count === null || data.count === undefined) {
      label.textContent = "unavailable";
    } else {
      label.textContent = `${data.count} ${data.count === 1 ? "egg" : "eggs"}`;
    }
  } catch (err) {
    // Leave the last known count on screen if the server is briefly unreachable.
  }
}

// ---------- Config / bootstrap ----------

async function loadConfig() {
  const res = await fetch("/api/config");
  appConfig = await res.json();

  const frame = document.getElementById("photo-frame");
  if (frame.src !== appConfig.immichUrl) {
    frame.src = appConfig.immichUrl;
  }

  document.documentElement.style.setProperty(
    "--calendar-font-scale",
    appConfig.calendarFontScale || 1
  );

  const grid = document.getElementById("month-grid");
  grid.classList.remove("wrap-1", "wrap-2", "wrap-full");
  grid.classList.add(`wrap-${appConfig.eventWrapMode || "1"}`);

  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const seconds = appConfig?.refreshIntervalSeconds || 300;
  refreshTimer = setInterval(() => {
    loadEvents();
    loadWeather();
    loadEggs();
  }, seconds * 1000);
}

tickClock();
setInterval(tickClock, 1000);

loadConfig().then(() => {
  loadEvents();
  loadWeather();
  loadEggs();
});
