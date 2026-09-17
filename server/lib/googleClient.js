const { google } = require("googleapis");
const { readJson, writeJson } = require("./store");

const TOKEN_KEY = "google_tokens";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

function getOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI. Set them in your .env file."
    );
  }
  const client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  const tokens = readJson(TOKEN_KEY, null);
  if (tokens) {
    client.setCredentials(tokens);
  }

  // Persist refreshed access tokens (and the refresh token, first time we get one)
  // so a container restart doesn't force the user to re-authenticate.
  client.on("tokens", (newTokens) => {
    const merged = { ...readJson(TOKEN_KEY, {}), ...newTokens };
    writeJson(TOKEN_KEY, merged);
  });

  return client;
}

function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token every time, not just on first grant
    scope: SCOPES,
  });
}

async function handleOAuthCallback(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  const merged = { ...readJson(TOKEN_KEY, {}), ...tokens };
  writeJson(TOKEN_KEY, merged);
  return merged;
}

function isConnected() {
  const tokens = readJson(TOKEN_KEY, null);
  return Boolean(tokens && (tokens.refresh_token || tokens.access_token));
}

function disconnect() {
  writeJson(TOKEN_KEY, {});
}

function getCalendarClient() {
  const auth = getOAuthClient();
  return google.calendar({ version: "v3", auth });
}

module.exports = {
  getOAuthClient,
  getAuthUrl,
  handleOAuthCallback,
  isConnected,
  disconnect,
  getCalendarClient,
  SCOPES,
};
