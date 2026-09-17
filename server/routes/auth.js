const express = require("express");
const {
  getAuthUrl,
  handleOAuthCallback,
  listAccounts,
  isConnected,
  disconnectAccount,
} = require("../lib/googleClient");

const router = express.Router();

// Kick off the OAuth2 "installed app" flow from the config GUI. Safe to call
// even when other Google accounts are already linked — it only ever adds or
// refreshes the one account the user signs in with here.
router.get("/google", (req, res) => {
  try {
    const url = getAuthUrl();
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`Google OAuth is not configured: ${err.message}`);
  }
});

// Google redirects back here with a ?code= after the user approves access.
router.get("/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`Google denied access: ${error}`);
  }
  if (!code) {
    return res.status(400).send("Missing ?code from Google callback.");
  }
  try {
    const { email } = await handleOAuthCallback(code);
    // The config page opens this flow in a popup window (see public/js/config.js).
    // If we got here inside a popup, tell the opener we're done and close
    // ourselves instead of navigating the popup to /config.html. Falls back
    // to a normal redirect if something opened this callback directly
    // (e.g. a bookmarked link, or a browser that blocked window.opener).
    res.send(`<!DOCTYPE html>
<html><body style="background:#111;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>Connected ${email}! You can close this window.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ source: "dakboard-oauth", status: "connected", email: ${JSON.stringify(email)} }, window.location.origin);
    window.close();
  } else {
    window.location.href = "/config.html?connected=1";
  }
</script>
</body></html>`);
  } catch (err) {
    console.error("[auth] OAuth callback failed:", err);
    res.status(500).send(`Failed to complete Google sign-in: ${err.message}`);
  }
});

router.get("/status", (req, res) => {
  res.json({ connected: isConnected(), accounts: listAccounts() });
});

// Disconnect one linked Google account (leaves any others untouched).
router.post("/disconnect", (req, res) => {
  const email = req.body?.email;
  if (!email) {
    return res.status(400).json({ error: "Missing email of the account to disconnect." });
  }
  disconnectAccount(email);
  res.json({ ok: true, accounts: listAccounts() });
});

module.exports = router;
