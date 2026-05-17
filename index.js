const functions = require("firebase-functions");
const fetch = require("node-fetch");

// ── ENV VARS ──
// Set these in your GitHub repo:
// Settings → Secrets and variables → Actions → New repository secret
// Then pass them through your deploy workflow (see bottom of this file for workflow snippet)
// OR set them directly in Firebase:
// firebase functions:secrets:set DISCORD_CLIENT_ID (Firebase Gen 2)
// OR use a .env file locally that you never commit
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI          = "https://sync-d-khaki.vercel.app/dashboard.html";

const ALLOWED_ORIGINS = [
  "https://sync-d-khaki.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function setCORSHeaders(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

exports.discordAuth = functions.https.onRequest(async (req, res) => {
  setCORSHeaders(req, res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Guard: fail fast if secrets aren't loaded
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    console.error("Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET env vars");
    res.status(500).json({ error: "Server misconfiguration: missing Discord credentials" });
    return;
  }

  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: "Missing code" });
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      console.error("Discord token error:", err);
      return res.status(502).json({
        error: "Failed to exchange code",
        detail: err.error_description || err.error || "Unknown Discord error",
      });
    }

    const tokenData   = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch user + guilds in parallel
    const [userRes, guildsRes] = await Promise.all([
      fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    if (!userRes.ok) {
      console.error("Discord user fetch error:", await userRes.text());
      return res.status(502).json({ error: "Failed to fetch Discord user" });
    }
    if (!guildsRes.ok) {
      console.error("Discord guilds fetch error:", await guildsRes.text());
      return res.status(502).json({ error: "Failed to fetch Discord guilds" });
    }

    const user   = await userRes.json();
    const guilds = await guildsRes.json();

    const avatarURL = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null;

    const cleanGuilds = guilds.map(g => ({
      id:    g.id,
      name:  g.name,
      owner: g.owner,
      icon:  g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
        : null,
    }));

    return res.status(200).json({
      user: {
        id:          user.id,
        username:    user.username,
        global_name: user.global_name || null,
        avatar:      avatarURL,
      },
      guilds: cleanGuilds,
    });

  } catch (err) {
    console.error("discordAuth function error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
});
