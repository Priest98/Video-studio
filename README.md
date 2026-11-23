# Video Studio

Multi-user AI video repurposing SaaS: long videos in, edited 9:16 clips out, sent into Oyinca approval queues. Full brief in [SPEC.md](SPEC.md).

## Status

Spec only. Phase 1 (auth, dashboard, database) is next.

## Proposed hosting layout

Vercel hosts the web app, Cloudflare R2 stores video, and heavy media and AI work runs on separate compute (Vercel functions cannot run FFmpeg or the models).

| Concern | Where |
| --- | --- |
| Web app and API routes (Next.js) | Vercel |
| Finished clips and temp sources | Cloudflare R2, CDN, signed URLs (no egress fees) |
| Job queue | Separate service (to choose) |
| FFmpeg, WhisperX, MediaPipe, OpenCV | Separate worker host (container or GPU); benchmark first |
| Auth and database | Supabase (Postgres, Auth, RLS) |

FastAPI can remain for the media workers. Confirm before building.

## Repo layout (planned)

```
apps/web        Next.js frontend
apps/api        Workers API
workers/media   Python media and AI workers
packages/       shared types
supabase/       migrations and RLS policies
docs/           evaluation reports
```
