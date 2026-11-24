import { createHash, randomBytes } from "node:crypto";

// "Connect Oyinca" uses authorization code + PKCE: the browser goes to Oyinca, the user approves there, and Oyinca
// sends back a one-time code that only this server (holding the verifier) can swap for a token.

export const CONNECT_COOKIE = "oyinca_connect";
export const CONNECT_PARTNER_ID = "video-studio";

export function newConnectAttempt() {
  const verifier = randomBytes(32).toString("base64url"); // 43 characters
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

/** Oyinca's web address (consent screen) is the API address without its trailing /api. */
export function oyincaWebUrl(): string | null {
  if (process.env.OYINCA_WEB_URL) return process.env.OYINCA_WEB_URL.replace(/\/$/, "");
  const api = process.env.OYINCA_API_URL;
  return api ? api.replace(/\/api\/?$/, "").replace(/\/$/, "") : null;
}

export function buildAuthorizeUrl(web: string, redirectUri: string, a: { challenge: string; state: string }): string {
  const u = new URL(`${web}/connect/${CONNECT_PARTNER_ID}`);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", a.state);
  u.searchParams.set("code_challenge", a.challenge);
  return u.toString();
}

export function encodeAttempt(a: { verifier: string; state: string }): string {
  return Buffer.from(JSON.stringify({ verifier: a.verifier, state: a.state })).toString("base64url");
}

export function decodeAttempt(raw: string | undefined): { verifier: string; state: string } | null {
  try {
    const v = JSON.parse(Buffer.from(raw ?? "", "base64url").toString());
    return typeof v?.verifier === "string" && typeof v?.state === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(apiBase: string, code: string, verifier: string, redirectUri: string): Promise<{ token: string }> {
  const res = await fetch(`${apiBase}/partner/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Oyinca refused the code (${res.status})`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("Oyinca returned no token");
  return { token: body.token };
}
