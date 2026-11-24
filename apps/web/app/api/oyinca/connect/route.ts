import { NextResponse } from "next/server";
import { currentWorkspace } from "@/lib/workspace";
import { buildAuthorizeUrl, CONNECT_COOKIE, encodeAttempt, newConnectAttempt, oyincaWebUrl } from "@/lib/oyinca/connect";

/** Start "Connect Oyinca": remember the PKCE verifier in a short-lived httpOnly cookie, then go to Oyinca's consent screen. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const { role } = await currentWorkspace();
  if (!["owner", "admin"].includes(role)) return NextResponse.redirect(`${origin}/accounts?error=${encodeURIComponent("Only owners and admins can connect Oyinca.")}`);
  const web = oyincaWebUrl();
  if (!web) return NextResponse.redirect(`${origin}/accounts?error=${encodeURIComponent("Oyinca is not configured.")}`);

  const attempt = newConnectAttempt();
  const res = NextResponse.redirect(buildAuthorizeUrl(web, `${origin}/api/oyinca/callback`, attempt));
  res.cookies.set(CONNECT_COOKIE, encodeAttempt(attempt), {
    httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: "/api/oyinca", maxAge: 600,
  });
  return res;
}
