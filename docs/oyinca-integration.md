# Oyinca integration contract

Findings from reading `Priest98/OYINCA` (shallow clone, 2026-11-23), and what Oyinca must add before the Studio can send clips.

## What Oyinca has today

- User authentication with JWTs (`apps/api/src/auth`). `JwtAuthGuard` plus `BrandAccessGuard` protect brand routes.
- Brand-scoped media routes under `brands/:brandId/media` (`media.controller.ts`): `upload` (multipart, 50 MB cap) and `register`.
- `register` only accepts a file already in Oyinca's own Vercel Blob storage under `/{brandId}/`, with a matching content type (`media.service.ts`, `registerUploadedAsset`). It rejects any other URL.
- Approval defaults to manual and Brain confidence cannot grant autonomy (`apps/api/src/engine/CONTEXT.md`). Publishing requires connected capability, entitlement, approval policy and due status.
- `apps/api/src/oauth` is Oyinca acting as an OAuth client to social platforms. It is not a provider for other apps.

## What is missing

1. A way for a third-party app to authenticate on behalf of a user: partner OAuth (authorization code with PKCE) or per-user integration tokens.
2. An endpoint that ingests a video from a signed URL, or a way to obtain an upload target inside Oyinca storage.
3. An endpoint that creates a post or media asset in the approval queue, with idempotency.
4. An endpoint listing the brands and social accounts the token may submit to, with permission levels.

## Proposed contract (not implemented in Oyinca)

All calls: `Authorization: Bearer <partner token>`, tenant resolved from the token, never from request input.

| Call | Purpose |
| --- | --- |
| `GET /partner/v1/accounts` | Brands and social accounts the token may submit to, each with `canSubmit` |
| `POST /partner/v1/approval-queue/submissions` | Create one approval-queue entry from a signed `videoUrl`, with `Idempotency-Key` header |

The submission body carries `brandId`, `accountId`, `videoUrl`, `filename`, `mimeType`, `sizeBytes`, optional `title`, `caption`, `thumbnailUrl` and `suggestedPublishAt`. Oyinca fetches the file, runs its own content checks, and replies `{ assetId, state: "awaiting_approval" }`.

Requirements on Oyinca's side:

- Submissions land in manual approval regardless of any Autopilot setting. Partner tokens must not be able to publish.
- The same `Idempotency-Key` returns the original result and creates nothing new.
- `suggestedPublishAt` is a hint only; Oyinca's scheduling decides.
- Scopes limited to `accounts:read` and `submissions:create`; revocable per connection; refreshable.
- One Studio user may hold several independent grants (separate Oyinca accounts or agency workspaces).

## Studio side (built)

`apps/web/lib/oyinca/client.ts` is the adapter. Its endpoint paths are configuration (`PROPOSED_PATHS`), not facts, and it exposes no publish method. `transfer.ts` handles per-item status, idempotency keys, retries (3 attempts on transient errors), expired credentials, and failure isolation between accounts. Tests cover each case against a fake client.

Until Oyinca ships the contract, "Connect Oyinca" and "Send to Oyinca" stay disabled in the UI.

## Partner API patch (drafted, not applied to Oyinca)

`docs/oyinca-patch/0001-partner-api.patch` is a `git format-patch` against Oyinca's repo (branch `feat/partner-api`, local only, never pushed). Apply with `git am docs/oyinca-patch/0001-partner-api.patch` after review.

What it adds:
- `PartnerConnection` (sha256-hashed `ptk_` tokens, scopes, expiry, revocation) and `PartnerSubmission` (unique per connection + Idempotency-Key). Migration included.
- `GET /partner/v1/accounts` and `POST /partner/v1/approval-queue/submissions`. There is no publish route. Submissions create a `NEEDS_APPROVAL` post with no schedule.
- `POST/GET/DELETE /integrations/partner-tokens` (JWT-protected) so a signed-in Oyinca user issues, lists and revokes tokens. The token is shown once.
- Submissions reuse `MediaService.uploadAsset`, so MIME, magic-byte and storage-limit checks still apply. Video fetch is https-only with a host allowlist (`PARTNER_ALLOWED_VIDEO_HOSTS`), no redirects, and a size cap (`PARTNER_MAX_VIDEO_BYTES`, default 100 MB).

Not verified: `npm ci` failed in the Oyinca workspace, so the Nest code has not been compiled. Only `partner.util` is tested (6 tests). Run `prisma generate`, `tsc` and a manual end-to-end test before merging. Check the `Post`/`PostMedia`/`PostTarget`/`MediaAsset` field names used in `partner.service.ts` against your schema. The serverless memory limit may force a lower size cap. An OAuth consent screen can later replace manual token paste.

## Video Studio side

- Connect: press **Connect Oyinca** on the Accounts page. The browser goes to Oyinca's `/connect/video-studio` consent screen (sign-in first if needed), then returns to `/api/oyinca/callback` with a one-time code. The server swaps it for a `ptk_` token using PKCE (verifier kept in a 10-minute httpOnly cookie) and stores it as below. Oyinca needs `PARTNER_CLIENTS` to list this app's callback address exactly. Earlier design: paste the token.
- Token verification: It is verified against `/partner/v1/accounts`, then stored AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEY`, 32 bytes base64) in `oyinca_credentials`. Accounts are synced.
- Send: "Send to Oyinca" on a saved plan creates one transfer per item (unique idempotency key), submits with up to 3 attempts, flags the connection expired on auth errors, and isolates failures per item.
- Required env: `OYINCA_API_URL` (for example `https://oyinca.com/api`), optional `OYINCA_WEB_URL`, `TOKEN_ENCRYPTION_KEY`.
