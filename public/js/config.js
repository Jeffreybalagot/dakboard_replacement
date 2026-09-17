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
  const { connected, accounts } = await res.json();

  const list = document.getElementById("accounts-list");
  const calendarSection = document.getElementById("calendar-section");

  if (connected) {
    list.innerHTML = accounts
      .map(
        (a) => `
        <div class="account-row" data-email="${escapeHtml(a.email)}">
          <span class="status-pill connected">Connected</span>
          <span class="account-email">${escapeHtml(a.email)}</span>
          <button class="secondary account-disconnect-btn" data-email="${escapeHtml(a.email)}">Disconnect</button>
        </div>`
      )
      .join("");

    list.querySelectorAll(".account-disconnect-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.dataset.email;
        if (!confirm(`Disconnect ${email}? Its calendars will stop showing on the dashboard.`)) return;
        await fetch("/auth/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        loadAuthStatus();
      });
    });

    calendarSection.style.display = "block";
    loadCalendars();
  } else {
    list.innerHTML = `<p class="hint">No Google accounts connected yet.</p>`;
    calendarSection.style.display = "none";
  }
}

async function loadCalendars() {
  const list = document.getElementById("calendar-list");
  list.innerHTML = `<div class="hint" style="padding:8px">Loading calendars&hellip;</div>`;
  try {
    const res = await fetch("/api/calendars");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load calendars");
    currentCalendars = data.calendars || [];
    renderCalendarList();
    if (data.errors && data.errors.length) {
      toast(`Some accounts failed to load: ${data.errors.join("; ")}`);
    }
  } catch (err) {
    list.innerHTML = `<div class="hint" style="padding:8px">${err.message}</div>`;
  }
}

function renderCalendarList() {
  const list = document.getElementById("calendar-list");

  // Group by linked account so it's clear which calendars belong to whom.
  const byAccount = new Map();
  currentCalendars.forEach((cal, i) => {
    if (!byAccount.has(cal.accountEmail)) byAccount.set(cal.accountEmail, []);
    byAccount.get(cal.accountEmail).push({ ...cal, index: i });
  });

  let html = "";
  for (const [email, cals] of byAccount) {
    html += `<div class="calendar-group-header">${escapeHtml(email)}</div>`;
    html += cals
      .map(
        (cal) => `
        <label class="calendar-row">
          <input type="checkbox" data-index="${cal.index}" ${cal.enabled ? "checked" : ""} />
          <span class="cal-dot" style="background:${cal.color}"></span>
          <span class="cal-name">${escapeHtml(cal.summary)}</span>
          ${cal.primary ? '<span class="cal-primary-badge">Primary</span>' : ""}
        </label>`
      )
      .join("");
  }
  list.innerHTML = html || `<div class="hint" style="padding:8px">No calendars found.</div>`;

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
    toast(event.data.email ? `Connected ${event.data.email}` : "Google account connected");
    loadAuthStatus();
  }
});

document.getElementById("connect-btn").addEventListener("click", openGoogleLinkPopup);

document.getElementById("save-calendars-btn").addEventListener("click", saveCalendars);
document.getElementById("refresh-calendars-btn").addEventListener("click", loadCalendars);
document.getElementById("save-all-btn").addEventListener("click", saveAllSettings);

setupGeocodeSearch();
loadAuthStatus();
loadConfig();

if (new URLSearchParams(window.location.search).get("connected")) {
  toast("Google account connected");
}
