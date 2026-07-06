export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface EmailInput {
  to: string;
  subject: string;
  body: string;
}

export type FetchFn = typeof fetch;

export function gmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GmailConfig | null {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
  return { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN };
}

export async function getAccessToken(cfg: GmailConfig, fetchFn: FetchFn): Promise<string> {
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`gmail token exchange failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

// RFC 2822 message, base64url-encoded as the Gmail API requires.
function toRaw({ to, subject, body }: EmailInput): string {
  const msg = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");
  return Buffer.from(msg).toString("base64url");
}

async function gmailPost(
  cfg: GmailConfig,
  path: string,
  payload: unknown,
  fetchFn: FetchFn
): Promise<any> {
  const token = await getAccessToken(cfg, fetchFn);
  const res = await fetchFn(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`gmail ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function createDraft(
  cfg: GmailConfig,
  input: EmailInput,
  fetchFn: FetchFn = fetch
): Promise<{ draft_id: string }> {
  const json = await gmailPost(cfg, "users/me/drafts", { message: { raw: toRaw(input) } }, fetchFn);
  return { draft_id: json.id };
}

export async function sendEmail(
  cfg: GmailConfig,
  input: EmailInput,
  fetchFn: FetchFn = fetch
): Promise<{ message_id: string }> {
  const json = await gmailPost(cfg, "users/me/messages/send", { raw: toRaw(input) }, fetchFn);
  return { message_id: json.id };
}
