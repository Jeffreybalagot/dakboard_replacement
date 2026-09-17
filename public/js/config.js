let currentConfig = null;
let currentCalendars = [];

function toast(msg) {
  const el = document.getElementById("save-toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function populateTimezones(selected) {
  const select = document.getElementById("timezone");
  let zones;
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [
      "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
      "America/Anchorage", "Pacific/Honolulu", "UTC", "Europe/London", "Europe/Paris",
      "Asia/Tokyo", "Australia/Sydney",
    ];
  }
  select.innerHTML = zones.map((z) => `<option value="${z}">${z}</option>`).join("");
  if (selected) select.value = selected;
}

async function loadAuthStatus() {
  const res = await fetch("/auth/status");
  const { connected } = await res.json();

  const pill = document.getElementById("connection-status");
  const connectBtn = document.getElementById("connect-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const calendarSection = document.getElementById("calendar-section");

  if (connected) {
    pill.textContent = "Connected";
    pill.className = "status-pill connected";
    connectBtn.textContent = "Reconnect / Add Another Account";
    disconnectBtn.style.display = "inline-block";
    calendarSection.style.display = "block";
    loadCalendars();
  } else {
    pill.textContent = "Not connected";
    pill.className = "status-pill disconnected";
    disconnectBtn.style.display = "none";
    calendarSection.style.display = "none";
  }
}

async function loadCalendars() {
  const list = document.getElementById("calendar-list");
  list.innerHTML = `<div class="hint" style="padding:8px">Loading calendars&hellip;</div>`;
  try {
    const res = await fetch("/api/calendars");
    const calendars = await res.json();
    if (!res.ok) throw new Error(calendars.error || "Failed to load calendars");
    currentCalendars = calendars;
    renderCalendarList();
  } catch (err) {
    list.innerHTML = `<div class="hint" style="padding:8px">${err.message}</div>`;
  }
}

function renderCalendarList() {
  const list = document.getElementById("calendar-list");
  list.innerHTML = currentCalendars
    .map(
      (cal, i) => `
      <label class="calendar-row">
        <input type="checkbox" data-index="${i}" ${cal.enabled ? "checked" : ""} />
        <span class="cal-dot" style="background:${cal.color}"></span>
        <span class="cal-name">${escapeHtml(cal.summary)}</span>
        ${cal.primary ? '<span class="cal-primary-badge">Primary</span>' : ""}
      </label>`
    )
    .join("");

  list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      currentCalendars[idx].enabled = e.target.checked;
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function saveCalendars() {
  const btn = document.getElementById("save-calendars-btn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/calendars", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentCalendars),
    });
    if (!res.ok) throw new Error("Failed to save");
    toast("Calendar selection saved");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function loadConfig() {
  const res = await fetch("/api/config");
  currentConfig = await res.json();

  document.getElementById("lat").value = currentConfig.location.lat;
  document.getElementById("lon").value = currentConfig.location.lon;
  document.getElementById("current-location-hint").textContent =
    `Currently: ${currentConfig.location.name}`;
  populateTimezones(currentConfig.timezone);
  document.getElementById("immich-url").value = currentConfig.immichUrl;
  document.getElementById("refresh-interval").value = currentConfig.refreshIntervalSeconds;
  document.getElementById("calendar-font-scale").value = String(
    currentConfig.calendarFontScale || 1
  );
  document.getElementById("event-wrap-mode").value = currentConfig.eventWrapMode || "1";
}

let geocodeTimer = null;
function setupGeocodeSearch() {
  const input = document.getElementById("location-search");
  const results = document.getElementById("geocode-results");

  input.addEventListener("input", () => {
    clearTimeout(geocodeTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      results.style.display = "none";
      return;
    }
    geocodeTimer = setTimeout(async () => {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const matches = await res.json();
      if (!Array.isArray(matches) || matches.length === 0) {
        results.style.display = "none";
        return;
      }
      results.innerHTML = matches
        .map(
          (m, i) =>
            `<div class="geocode-result" data-index="${i}">${escapeHtml(m.name)}</div>`
        )
        .join("");
      results.style.display = "block";
      results.querySelectorAll(".geocode-result").forEach((el) => {
        el.addEventListener("click", () => {
          const match = matches[Number(el.dataset.index)];
          document.getElementById("lat").value = match.lat;
          document.getElementById("lon").value = match.lon;
          document.getElementById("current-location-hint").textContent = `Currently: ${match.name}`;
          if (match.timezone) document.getElementById("timezone").value = match.timezone;
          input.value = "";
          results.style.display = "none";
        });
      });
    }, 350);
  });
}

async function saveAllSettings() {
  const btn = document.getElementById("save-all-btn");
  btn.disabled = true;
  try {
    const payload = {
      timezone: document.getElementById("timezone").value,
      immichUrl: document.getElementById("immich-url").value.trim(),
      refreshIntervalSeconds: Number(document.getElementById("refresh-interval").value),
      calendarFontScale: Number(document.getElementById("calendar-font-scale").value),
      eventWrapMode: document.getElementById("event-wrap-mode").value,
      location: {
        lat: Number(document.getElementById("lat").value),
        lon: Number(document.getElementById("lon").value),
        name: document.getElementById("current-location-hint").textContent.replace(/^Currently:\s*/, ""),
      },
    };
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to save settings");
    currentConfig = await res.json();
    toast("Settings saved");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

function openGoogleLinkPopup() {
  const width = 520;
  const height = 680;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  const popup = window.open(
    "/auth/google",
    "dakboard-google-link",
    `width=${width},height=${height},left=${left},top=${top}`
  );

  if (!popup) {
    // Popup blocked — fall back to a normal full-page redirect.
    window.location.href = "/auth/google";
    return;
  }

  // Poll in case the popup is closed manually without ever posting a message
  // (e.g. the user cancels on Google's consent screen).
  const poller = setInterval(() => {
    if (popup.closed) {
      clearInterval(poller);
      loadAuthStatus();
    }
  }, 700);
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source === "dakboard-oauth" && event.data.status === "connected") {
    toast("Google account connected");
    loadAuthStatus();
  }
});

document.getElementById("connect-btn").addEventListener("click", openGoogleLinkPopup);

document.getElementById("disconnect-btn").addEventListener("click", async () => {
  if (!confirm("Disconnect this Google account?")) return;
  await fetch("/auth/logout", { method: "POST" });
  loadAuthStatus();
});

document.getElementById("save-calendars-btn").addEventListener("click", saveCalendars);
document.getElementById("refresh-calendars-btn").addEventListener("click", loadCalendars);
document.getElementById("save-all-btn").addEventListener("click", saveAllSettings);

setupGeocodeSearch();
loadAuthStatus();
loadConfig();

if (new URLSearchParams(window.location.search).get("connected")) {
  toast("Google account connected");
}
