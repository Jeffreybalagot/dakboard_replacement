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

function showBanner(message) {
  const banner = document.getElementById("status-banner");
  if (!message) {
    banner.style.display = "none";
    return;
  }
  banner.textContent = message;
  banner.style.display = "block";
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

// Builds the full set of grid cells for the month containing `anchor`,
// padded out to complete weeks (Sun-Sat) at both ends, like a normal
// calendar app month view.
function buildMonthGrid(anchor) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const days = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push({
      date: new Date(cursor),
      key: localDateKeyFromDate(cursor),
      inMonth: cursor.getMonth() === month,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return { days, gridStart, gridEnd, month, year };
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
  for (const day of grid.days) {
    const events = eventsByDay.get(day.key) || [];
    const isToday = day.key === todayKey;

    html += `<div class="day-cell${day.inMonth ? "" : " outside-month"}">`;
    html += `<div class="day-number${isToday ? " today" : ""}">${day.date.getDate()}</div>`;
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
  }
  container.innerHTML = html;
}

async function loadEvents() {
  const grid = buildMonthGrid(new Date());
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
      showBanner(`Some calendars failed to load: ${data.errors.join("; ")}`);
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

  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const seconds = appConfig?.refreshIntervalSeconds || 300;
  refreshTimer = setInterval(() => {
    loadEvents();
    loadWeather();
  }, seconds * 1000);
}

tickClock();
setInterval(tickClock, 1000);

loadConfig().then(() => {
  loadEvents();
  loadWeather();
});
