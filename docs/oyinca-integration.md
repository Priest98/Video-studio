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
