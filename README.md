# dakboard_replacement

A self-hosted replacement for [DAKboard](https://dakboard.com/), built to run as a single Docker
container on your own hardware (e.g. a Raspberry Pi driving a wall-mounted display).

It shows:

- An agenda pulling from **multiple Google calendars**, with automatic de-duplication when the
  same event appears on more than one calendar you've selected (e.g. a shared "Family" calendar).
- **Weather**, highlighted with a current-conditions panel and a 5-day forecast (via
  [Open-Meteo](https://open-meteo.com/), free, no API key needed).
- Your **Immich** photo slideshow, embedded from a kiosk URL you already have running
  (e.g. `https://kiosk.jellymorph.net/`).
- A password-optional **settings page** (`/config.html`) to pick calendars, and set your
  timezone/location and photo URL — no code editing required after initial setup.

---

## 1. How it works

- **Backend**: Node.js + Express (`server/`). Talks to the Google Calendar API, Open-Meteo, and
  persists settings/tokens as small JSON files under `data/` (mount this as a Docker volume so it
  survives restarts).
- **Frontend**: plain HTML/CSS/JS (`public/`), no build step. `index.html` is the dashboard you
  point your display at; `config.html` is the settings GUI.
- **Auth**: Google OAuth2 "offline access" — you sign in once through a browser, and the server
  stores a refresh token so it can keep pulling events without you signing in again.

---

## 2. Google Cloud setup (one-time)

You need your own Google OAuth2 client so the app can read your calendars.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project
   (or reuse an existing one) — e.g. "dakboard-replacement".
2. **Enable the API**: APIs & Services → Library → search "Google Calendar API" → Enable.
3. **Configure the consent screen**: APIs & Services → OAuth consent screen.
   - User type: **External** (unless you have a Google Workspace org — then Internal is fine).
   - Fill in an app name ("Dakboard Replacement"), your email as support/contact.
   - Scopes: you don't need to add any here — the app requests
     `https://www.googleapis.com/auth/calendar.readonly` at sign-in time.
   - Test users: add the Google account(s) whose calendars you want to show (needed while the app
     is in "Testing" publishing status, which is fine for personal use — you never need to submit
     it for verification).
4. **Create credentials**: APIs & Services → Credentials → Create Credentials → OAuth client ID.
   - Application type: **Web application**.
   - Authorized redirect URIs: add the URL you'll reach the dashboard at, with `/auth/google/callback`
     appended. Examples:
     - `http://raspberrypi.local:3000/auth/google/callback`
     - `http://10.50.1.50:3000/auth/google/callback`
     - `https://dakboard.jellymorph.net/auth/google/callback` (if you put it behind your Nginx
       Proxy Manager, which is recommended so you can browse to it as `https://` instead of a raw
       IP:port)
   - Save. You'll get a **Client ID** and **Client Secret** — copy both into your `.env` file (see
     below).

If you ever need to show calendars from a *second* Google account (e.g. a spouse's), just click
"Connect Google Account" again on the settings page and sign in with the other account — both
accounts' calendars will show up in the calendar picker, and duplicate events between them are
automatically collapsed to one.

---

## 3. Configuration

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | no (default `3000`) | Port the server listens on inside the container. |
| `GOOGLE_CLIENT_ID` | yes | From the Google Cloud Console credential you created above. |
| `GOOGLE_CLIENT_SECRET` | yes | Same. |
| `GOOGLE_REDIRECT_URI` | yes | Must exactly match a redirect URI on that OAuth client. |
| `CONFIG_PASSWORD` | no | If set, `/config.html` (and its APIs) require this password to access. Leave blank on a trusted home LAN if you don't want a login step. |

Everything else (timezone, weather location, which calendars are shown, the Immich URL, how many
days of agenda to show, refresh interval) is configured **from the settings page at `/config.html`**
after the container is running — not from environment variables.

---

## 4. Running with Docker

### Option A: `docker compose` (recommended)

```bash
git clone https://github.com/Jeffreybalagot/dakboard_replacement.git
cd dakboard_replacement
cp .env.example .env   # then edit .env with your Google credentials
docker compose up -d --build
```

The `docker-compose.yml` mounts `./data` into the container so your Google token and settings
survive container rebuilds/restarts. Visit `http://<host>:3000/` for the dashboard and
`http://<host>:3000/config.html` for settings.

### Option B: plain `docker`

```bash
docker build -t dakboard-replacement .
docker run -d \
  --name dakboard-replacement \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  dakboard-replacement
```

### Running on Unraid

This runs fine as an Unraid Docker container too:

1. Docker tab → Add Container.
2. Repository: point it at an image you've built/pushed (or use the "docker compose" plugin /
   Unraid's Community Applications "Compose Manager" plugin and paste in `docker-compose.yml`).
3. Add a path mapping: container `/app/data` → e.g. `/mnt/user/appdata/dakboard-replacement`.
4. Add the same environment variables as `.env` above.
5. Port: `3000` (or map to whatever you prefer, and adjust `GOOGLE_REDIRECT_URI` to match).
6. Optionally put it behind Nginx Proxy Manager at something like `dakboard.jellymorph.net` on
   your `br0` macvlan, the same way you did for Grafana — then your `GOOGLE_REDIRECT_URI` and the
   URL your Pi loads both become the clean `https://dakboard.jellymorph.net` address.

---

## 5. First-time setup after the container is running

1. Open `http://<host>:3000/config.html`.
2. Click **Connect Google Account** and sign in. You'll be redirected back automatically.
3. Check the boxes for every calendar you want shown (including calendars from a second connected
   account, if you added one), then **Save Calendar Selection**.
4. Under **Weather & Location**, search for your city and pick it from the results (this fills in
   lat/lon and a matching timezone automatically), then adjust the timezone if needed.
5. Under **Photos**, confirm/edit the Immich kiosk URL (defaults to
   `https://kiosk.jellymorph.net/`).
6. Click **Save Settings**.
7. Go back to `/` — your dashboard should now be populated.

---

## 6. Displaying it on a Raspberry Pi

The dashboard is a normal webpage, so any Pi running a browser in kiosk mode works. On Raspberry Pi OS (with the desktop):

1. Install Chromium if it isn't already: `sudo apt install -y chromium-browser unclutter`.
2. Create an autostart entry so it launches full-screen on boot:

   ```bash
   mkdir -p ~/.config/autostart
   cat > ~/.config/autostart/dashboard-kiosk.desktop <<'EOF'
   [Desktop Entry]
   Type=Application
   Name=Dashboard Kiosk
   Exec=chromium-browser --noerrdialogs --disable-infobars --kiosk --incognito --disable-session-crashed-bubble --check-for-update-interval=31536000 http://<host>:3000/
   X-GNOME-Autostart-enabled=true
   EOF
   ```

   Replace `<host>` with your server's LAN IP or the hostname you set up in Nginx Proxy Manager.

3. (Recommended) Hide the mouse cursor and disable screen blanking:

   ```bash
   # Disable screen blanking / DPMS
   sudo raspi-config nonint do_blanking 1
   ```

   `unclutter` (installed above) will hide the cursor automatically after inactivity if you also
   add `unclutter -idle 0.5 -root &` to the same autostart approach (as a second `.desktop` entry,
   or appended to `~/.config/lxsession/LXDE-pi/autostart`).

4. Reboot the Pi. It should come up straight into the dashboard, full screen.

If you're running a headless/lite Raspberry Pi OS image instead, install a minimal X server + Chromium
and use the same `--kiosk` flags, or use a purpose-built kiosk image like
[DietPi](https://dietpi.com/) with its Chromium Autostart option.

---

## 7. How de-duplication works

Google Calendar assigns a stable `iCalUID` to an event that's shared/copied across calendars — the
backend groups fetched events by that ID first, and falls back to a normalized
title + start time + end time match for the rare case an event doesn't carry one. Whichever
calendar appears first in your saved calendar list "wins" and is the one shown; see
`server/lib/dedupe.js`.

---

## 8. Project structure

```
server/
  index.js            # Express app entrypoint, routes mounting, optional password gate
  routes/
    auth.js            # Google OAuth2 login/callback/status/logout
    config.js           # GET/PUT dashboard settings
    calendars.js         # List Google calendars, save enabled/disabled selection
    events.js            # Aggregated, de-duplicated agenda across enabled calendars
    weather.js            # Open-Meteo current + 7-day forecast, cached 10 min
    geocode.js             # Open-Meteo geocoding, used by the settings page's location search
  lib/
    store.js                # Tiny JSON-file persistence helper
    configStore.js           # Typed wrapper around store.js for dashboard settings
    googleClient.js           # OAuth2 client + token persistence
    dedupe.js                  # Event de-duplication logic
public/
  index.html / css/style.css / js/app.js / js/weatherCodes.js   # The dashboard display
  config.html / css/config.css / js/config.js                    # The settings GUI
  login.html                                                       # Only used if CONFIG_PASSWORD is set
data/                # Created at runtime: config.json, google_tokens.json (gitignored)
Dockerfile
docker-compose.yml
.env.example
```

---

## 9. Troubleshooting

- **"Not connected to Google Calendar yet"** on the dashboard: open `/config.html` and click
  Connect Google Account.
- **OAuth error `redirect_uri_mismatch`**: the `GOOGLE_REDIRECT_URI` in your `.env` must be
  *character-for-character* identical to one of the "Authorized redirect URIs" on the OAuth
  client in Google Cloud Console, including `http` vs `https` and trailing slashes.
- **A calendar's events never show up**: make sure it's checked on `/config.html` under
  "Calendars to show," and that you clicked Save Calendar Selection (a separate save button from
  the rest of settings).
- **Photos panel is blank/black**: some sites send an `X-Frame-Options`/CSP header that blocks
  being embedded in an iframe. If `kiosk.jellymorph.net` ever stops allowing embedding, you'll
  need to adjust that server's headers to allow your dashboard's origin, or swap the photo panel
  for a different embeddable source.
- **Settings changes not saving**: check the container logs (`docker logs dakboard-replacement`)
  — the `data/` volume may not be writable.

---

## License

MIT
