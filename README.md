# Video Studio

Multi-user AI video repurposing SaaS: long videos in, edited 9:16 clips out, sent into Oyinca approval queues. Full brief in [SPEC.md](SPEC.md).

## Status

| Area | State |
| --- | --- |
| Auth, workspaces, RLS schema, dashboard | Built; schema tested on a throwaway Postgres |
| Shuffle and scheduling engine | Built, 10 tests |
| Media worker (selection, reframing, captions, render, compression, voiceover mixing) | Built, 15 tests with real FFmpeg |
| Upload signing, project start, quota checks | Built; needs R2 and worker credentials to run end to end |
| Distribution Studio (matrix, shuffle, undo, reset, manual order, save plan) | Built |
| Oyinca transfer logic and adapter | Built against a proposed contract; Oyinca must add it (see docs/oyinca-integration.md) |
| Not built | Link import, Gemini selection wired to a key, TTS providers, R2 upload of rendered clips, worker-to-web callback, Stripe billing, template editor, caption editor UI, scene detection, speaker selection for multi-speaker video |

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

## Run Phase 1 locally

```
cd apps/web
cp .env.example .env.local   # add your Supabase URL and anon key
npm run dev
```

Apply `supabase/migrations/0001_init.sql` to your Supabase project first. Phase 1 pages built: sign up, log in, dashboard. The other navigation pages are placeholders.
