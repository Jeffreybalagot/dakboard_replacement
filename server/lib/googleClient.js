const { google } = require("googleapis");
const { readJson, writeJson } = require("./store");

// Stores tokens for every linked Google account, keyed by that account's
// email address, e.g. { "jeff@gmail.com": { tokens, connectedAt, updatedAt } }.
// (Older versions of this app stored a single un-keyed token set under
// "google_tokens" for exactly one account — that key is no longer read, so
// upgrading silently drops that single legacy connection; just reconnect.)
const ACCOUNTS_KEY = "google_accounts";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function readAccounts() {
  return readJson(ACCOUNTS_KEY, {});
}

function writeAccounts(accounts) {
  return writeJson(ACCOUNTS_KEY, accounts);
}

// A "bare" OAuth2 client with no stored credentials — used only to build the
// consent URL and to exchange an auth code for tokens. Do not use this for
// API calls; use getCalendarClientForAccount(email) instead.
function getOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI. Set them in your .env file."
    );
  }
  return new google.auth.OAuth2({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
    // By default google-auth-library trusts the stored expiry_date and will
    // NOT refresh+retry when Google answers 401 "Invalid Credentials" (e.g.
    // the access token was revoked or rotated before its expiry). With this
    // on, a 401 triggers one refresh with the refresh_token and a retry.
    forceRefreshOnFailure: true,
  });
}

// Turns a googleapis/gaxios error into something a human can act on, and
// flags whether the fix is "reconnect this account in the config page".
function describeGoogleError(err) {
  const status = err?.response?.status || err?.code;
  const data = err?.response?.data || {};
  const oauthError = typeof data.error === "string" ? data.error : null; // token endpoint style
  const apiReason = data.error?.errors?.[0]?.reason; // Calendar API style
  const raw = err?.message || "Unknown error";

  if (oauthError === "invalid_grant" || /invalid_grant/i.test(raw)) {
    return {
      needsReconnect: true,
      message: "Google sign-in expired or was revoked — reconnect this account",
      detail: data.error_description || raw,
    };
  }
  if (/no refresh token/i.test(raw)) {
    return { needsReconnect: true, message: "No refresh token stored — reconnect this account", detail: raw };
  }
  if (status === 401 || /invalid credentials/i.test(raw)) {
    return { needsReconnect: true, message: "Invalid credentials — reconnect this account", detail: raw };
  }
  if (status === 404 || apiReason === "notFound") {
    return { needsReconnect: false, message: "Calendar not found (removed or unshared?)", detail: raw };
  }
  if (status === 403) {
    return { needsReconnect: false, message: `Access denied (${apiReason || "forbidden"})`, detail: raw };
  }
  return { needsReconnect: false, message: raw, detail: raw };
}

// Remembers the last fetch result per account so the config page can show
// which account is broken. Only writes when the state actually changes.
function setAccountHealth(email, problem) {
  const accounts = readAccounts();
  const account = accounts[email];
  if (!account) return;
  const next = problem
    ? { message: problem.message, needsReconnect: problem.needsReconnect, at: new Date().toISOString() }
    : null;
  const prev = account.lastError || null;
  if (!prev && !next) return;
  if (prev && next && prev.message === next.message) return;
  account.lastError = next;
  writeAccounts(accounts);
}

function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token every time, not just on first grant
    scope: SCOPES,
  });
}

// Exchanges an auth code for tokens, figures out which Google account those
// tokens belong to, and stores them under that account's own slot — without
// touching any other already-connected account.
async function handleOAuthCallback(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  const email = profile.email;
  if (!email) {
    throw new Error("Google didn't return an email address for this account.");
  }

  const accounts = readAccounts();
  const existing = accounts[email];
  accounts[email] = {
    email,
    tokens: { ...(existing?.tokens || {}), ...tokens },
    connectedAt: existing?.connectedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null, // fresh sign-in clears any previous failure
  };
  writeAccounts(accounts);

  return { email };
}

function listAccounts() {
  const accounts = readAccounts();
  return Object.values(accounts)
    .map((a) => ({
      email: a.email,
      connectedAt: a.connectedAt,
      hasRefreshToken: Boolean(a.tokens?.refresh_token),
      lastError: a.lastError || null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function isConnected() {
  return listAccounts().length > 0;
}

function disconnectAccount(email) {
  const accounts = readAccounts();
  delete accounts[email];
  writeAccounts(accounts);
}

// Builds an authenticated OAuth2 client for one specific linked account, and
// wires it up so a silently-refreshed access token gets persisted back into
// just that account's slot (never clobbering other linked accounts).
function getOAuthClientForAccount(email) {
  const accounts = readAccounts();
  const account = accounts[email];
  if (!account) {
    throw new Error(`No Google account connected for ${email}.`);
  }
  const client = getOAuthClient();
  client.setCredentials(account.tokens);

  client.on("tokens", (newTokens) => {
    const latest = readAccounts();
    const existing = latest[email];
    if (!existing) return; // account was disconnected mid-request
    latest[email] = {
      ...existing,
      tokens: { ...existing.tokens, ...newTokens },
      updatedAt: new Date().toISOString(),
    };
    writeAccounts(latest);
  });

  return client;
}

function getCalendarClientForAccount(email) {
  return google.calendar({ version: "v3", auth: getOAuthClientForAccount(email) });
}

module.exports = {
  getOAuthClient,
  getAuthUrl,
  handleOAuthCallback,
  listAccounts,
  isConnected,
  disconnectAccount,
  getCalendarClientForAccount,
  describeGoogleError,
  setAccountHealth,
  SCOPES,
};
