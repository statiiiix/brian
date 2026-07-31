// Speech-to-text for the dashboard's capture box: audio in, transcript out.
//
// This is its own function rather than a route on `brian` on purpose. Audio
// requests are large and slow, and the main worker is the whole product — a
// dependency or a memory spike here must not be able to take it down (see the
// pdf-parse boot failure of 2026-07-21). For the same reason nothing is
// imported at module scope: this file evaluates to plain fetch calls, so there
// is no third-party module that can fail to evaluate on the edge runtime.
//
// Deploy WITHOUT --no-verify-jwt so the platform rejects unauthenticated
// callers, and note that the platform check alone is not enough: the anon key
// is a valid JWT and ships in the browser bundle. Every request is therefore
// resolved to a real user against the Auth API before the OpenAI key is spent.

const OPENAI_TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";

// gpt-transcribe is OpenAI's recommended file-transcription model at
// $0.0045/min. gpt-4o-mini-transcribe is $0.003/min if a third off matters more
// than accuracy on company jargon; override with TRANSCRIBE_MODEL to switch.
const DEFAULT_MODEL = "gpt-transcribe";

// OpenAI accepts 25 MB. Capture is a voice note, not a recording session, so
// the ceiling here is lower — anything larger is a mistake worth naming.
const MAX_BYTES = 20 * 1024 * 1024;

// Steers spelling and punctuation toward how the brain is actually talked to.
const PROMPT =
  "A short spoken work note about company processes, decisions, policies, "
  + "refunds, escalations, and team preferences. Preserve punctuation and capitalization.";

function cors(origin: string | null): Record<string, string> {
  const allowed = Deno.env.get("TRANSCRIBE_ALLOWED_ORIGINS");
  const list = allowed?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  const allow = list.length === 0 ? "*" : (origin && list.includes(origin) ? origin : list[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/**
 * Resolve the caller against the Auth API. Returns the user id, or null when
 * the token is missing, expired, or is the anon key rather than a session.
 */
async function callerId(authorization: string | null): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anon) return null;

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anon },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ?? null;
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, headers);

  const userId = await callerId(req.headers.get("Authorization"));
  if (!userId) return json({ error: "unauthorized" }, 401, headers);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "transcription is not configured" }, 503, headers);

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    if (value instanceof File) audio = value;
  } catch {
    return json({ error: "expected multipart/form-data with a file field" }, 400, headers);
  }
  if (!audio) return json({ error: "no audio file provided" }, 400, headers);
  if (audio.size === 0) return json({ error: "the recording was empty" }, 400, headers);
  if (audio.size > MAX_BYTES) {
    return json({ error: "recording is too long — keep it under 20 MB" }, 413, headers);
  }

  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "capture.webm");
  upstream.append("model", Deno.env.get("TRANSCRIBE_MODEL") ?? DEFAULT_MODEL);
  upstream.append("prompt", PROMPT);

  const res = await fetch(OPENAI_TRANSCRIPTIONS, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
  });

  if (!res.ok) {
    // The upstream body can carry account details; log it, return a summary.
    const detail = await res.text().catch(() => "");
    console.error("openai transcription failed", res.status, detail.slice(0, 500));
    return json({ error: "could not transcribe that recording" }, 502, headers);
  }

  const result = await res.json().catch(() => null);
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  if (!text) return json({ error: "nothing was said in that recording" }, 422, headers);

  return json({ text, languages: result?.languages ?? [] }, 200, headers);
});
