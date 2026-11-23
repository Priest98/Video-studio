/**
 * Open mode: no sign-up or login. Every visitor acts as the single owner of the oldest workspace, using the
 * service-role client (RLS is bypassed). Anyone with the URL can use the app, its storage, the media worker and
 * any connected Oyinca accounts. Enabled only by AUTH_MODE=open; the default is normal sign-in.
 */
export const OPEN_MODE = process.env.AUTH_MODE === "open";
