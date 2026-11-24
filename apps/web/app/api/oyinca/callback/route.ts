import { NextResponse, type NextRequest } from "next/server";
import { CONNECT_COOKIE, decodeAttempt, exchangeCode } from "@/lib/oyinca/connect";
import { saveOyincaConnection } from "@/lib/oyinca/save-connection";

/** Oyinca sends the browser back here with a one-time code. Swap it for a token on the server and store it encrypted. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/accounts?${q}`);
    res.cookies.delete({ name: CONNECT_COOKIE, path: "/api/oyinca" });
    return res;
  };
  const fail = (msg: string) => back(`error=${encodeURIComponent(msg)}`);

  const attempt = decodeAttempt(request.cookies.get(CONNECT_COOKIE)?.value);
  const p = request.nextUrl.searchParams;
  if (!attempt || p.get("state") !== attempt.state) return fail("That connection attempt expired. Press Connect Oyinca again.");
  if (p.get("error")) return fail("You chose not to connect Oyinca.");
  const code = p.get("code");
  const base = process.env.OYINCA_API_URL;
  if (!code || !base) return fail("Oyinca did not send a code. Try again.");

  try {
    const { token } = await exchangeCode(base, code, attempt.verifier, `${origin}/api/oyinca/callback`);
    const saved = await saveOyincaConnection(token, "Oyinca");
    if (saved.error) return fail(saved.error);
    return back(`connected=${saved.accounts ?? 0}`);
  } catch {
    return fail("Couldn’t finish connecting to Oyinca. Try again.");
  }
}
