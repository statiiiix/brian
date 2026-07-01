# Gmail setup for Brian (one time, ~10 min)

1. Go to https://console.cloud.google.com/ → create (or pick) a project.
2. "APIs & Services" → "Library" → enable **Gmail API**.
3. "APIs & Services" → "OAuth consent screen" → External → fill app name
   ("Brian") + your email → add yourself (a7madinquiries@gmail.com) as a
   **test user**. Scopes can stay empty here.
4. "APIs & Services" → "Credentials" → "Create credentials" → **OAuth client ID**
   → Application type: **Desktop app** (Desktop clients allow loopback
   `http://127.0.0.1` redirects without registering the URI).
5. Copy the client ID + secret into `server/.env`:

   ```
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   ```

6. Run `cd server && npm run gmail:auth`, open the printed URL, approve
   (Google will warn the app is unverified — "Continue" is fine, you are the
   only test user), and paste the printed `GMAIL_REFRESH_TOKEN=...` line into
   `server/.env`.
7. Never commit `.env`. The token has only the `gmail.compose` scope
   (create drafts + send); it cannot read mail.

After that, verify with `npx tsx src/scripts/gmailSmoke.ts` (creates one draft
in your own inbox — check Drafts, then delete it).
