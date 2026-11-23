# Video Studio

Multi-user AI video repurposing SaaS: long videos in, edited 9:16 clips out, sent into Oyinca approval queues. Full brief in [SPEC.md](SPEC.md).

## Status

Spec only. Phase 1 (auth, dashboard, database) is next.

## Proposed Cloudflare layout

Cloudflare hosts the web app, storage and job orchestration. Heavy media and AI work cannot run on Workers, so it needs separate compute.

| Concern | Where |
| --- | --- |
| Web app (Next.js) | Cloudflare Workers via the OpenNext adapter |
| Finished clips and temp sources | R2, served through the CDN, signed URLs |
| Job queue and retries | Cloudflare Queues |
| API and Oyinca transfer orchestration | Workers (TypeScript) calling the worker fleet |
| FFmpeg rendering, WhisperX, MediaPipe, OpenCV | Containers (Cloudflare Containers or a separate GPU/CPU host); benchmark first |
| Auth and database | Supabase (Postgres, Auth, RLS) |

This replaces the draft's FastAPI backend for the web tier. FastAPI can remain for the media workers. Confirm before building.

## Repo layout (planned)

```
apps/web        Next.js frontend
apps/api        Workers API
workers/media   Python media and AI workers
packages/       shared types
supabase/       migrations and RLS policies
docs/           evaluation reports
```
