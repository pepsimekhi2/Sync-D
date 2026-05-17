// api/discordAuth.js

const DISCORD_CLIENT_ID     = "1505690730021261393";
const DISCORD_CLIENT_SECRET = "QExFu9WooWV-HLwFEsanABH0UJb_n7VB";
const REDIRECT_URI          = "https://sync-d-khaki.vercel.app/dashboard.html";

const ALLOWED_ORIGINS = [
  "https://sync-d-khaki.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
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
      return res.status(502).json({
        error: "Failed to exchange code",
        detail: err.error_description || err.error || "Unknown",
      });
    }

    const { access_token } = await tokenRes.json();

    const [userRes, guildsRes] = await Promise.all([
      fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
      fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    ]);

    if (!userRes.ok)   return res.status(502).json({ error: "Failed to fetch Discord user" });
    if (!guildsRes.ok) return res.status(502).json({ error: "Failed to fetch Discord guilds" });

    const user   = await userRes.json();
    const guilds = await guildsRes.json();

    return res.status(200).json({
      user: {
        id:          user.id,
        username:    user.username,
        global_name: user.global_name || null,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          : null,
      },
      guilds: guilds.map(g => ({
        id:    g.id,
        name:  g.name,
        owner: g.owner,
        icon:  g.icon
          ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
          : null,
      })),
    });

  } catch (err) {
    console.error("discordAuth error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
