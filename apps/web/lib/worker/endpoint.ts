import { timingSafeEqual } from "node:crypto";

/**
 * The worker registers its own public address. Only https addresses on Cloudflare quick tunnels are accepted,
 * plus any suffixes listed in WORKER_ALLOWED_HOSTS (comma separated, for a named tunnel on your own domain).
 * The app sends the worker token and signed storage links to this address, so it must never be arbitrary.
 */
export function parseWorkerUrl(raw: unknown, extraSuffixes = ""): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase();
  const suffixes = [".trycloudflare.com", ...extraSuffixes.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).map((s) => (s.startsWith(".") ? s : `.${s}`))];
  if (!suffixes.some((s) => host.endsWith(s) && host.length > s.length)) return null;
  return `https://${host}`;
}

export function bearerMatches(header: string | null, token: string | undefined): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
