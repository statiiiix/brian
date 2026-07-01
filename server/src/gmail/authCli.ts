// One-time local OAuth flow: opens a consent URL, catches the redirect on
// 127.0.0.1, exchanges the code, prints the refresh token to paste into .env.
import http from "node:http";
import { loadServerEnv } from "../env.js";

loadServerEnv();

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in server/.env first (see docs/gmail-setup.md).");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/gmail.compose",
  access_type: "offline",
  prompt: "consent",
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
  const code = url.searchParams.get("code");
  if (!code) { res.writeHead(400); res.end("missing ?code"); return; }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const json = (await tokenRes.json()) as { refresh_token?: string; error?: string };

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Done — return to the terminal.");
  server.close();

  if (json.refresh_token) {
    console.log("\nAdd this line to server/.env:\n");
    console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}\n`);
  } else {
    console.error("No refresh_token returned:", JSON.stringify(json));
    process.exitCode = 1;
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this URL in your browser and approve access:\n");
  console.log(authUrl.toString() + "\n");
});
