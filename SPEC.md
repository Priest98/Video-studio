# Video Studio: Master Spec

Multi-user AI video repurposing SaaS that sends finished clips into Oyinca approval queues. Merged from four drafts on 2026-11-23. Original sections 18 to 23 were truncated in the source paste and are missing (see section 12).

## 1. Vision and workflow

Build a commercial, multi-user SaaS (not a personal tool, not a downloader or trimmer) that turns long-form video into edited short-form clips and sends them straight into the user's Oyinca approval queues.

Flow: source video, AI analysis, clip selection, editing, captions, optional voiceover, compression, distribution, Oyinca approval queue.

1. Acquire an authorised video (YouTube link or direct upload).
2. Analyse and transcribe it.
3. Find and select the best moments.
4. Cut clips and convert to vertical 9:16.
5. Track speakers and reframe.
6. Add animated captions and apply a template.
7. Compress without needless quality loss.
8. Let the user assign clips to multiple social accounts.
9. Transfer selected clips into the right Oyinca approval queues.

Oyinca stays responsible for scheduling, approval and publishing. The Studio never publishes to TikTok directly when Oyinca is the destination, and reuses Oyinca's agency and client-workspace structure.

Defaults recommended in the drafts (not yet confirmed): OAuth to connect Oyinca; original uploads retained 7 days after processing, configurable; transfer to Oyinca both automatic and manual.

## 2. Multi-user SaaS, tenancy and billing

Each user has registration and auth, dashboard, projects, uploads, clips, processing history, storage usage, billing records, connected Oyinca accounts, social-account mappings and distribution history.

- Strict tenant isolation: Supabase Auth, PostgreSQL, Row Level Security, tenant-aware relationships, secure token storage, signed storage URLs, server-side subscription and usage enforcement.
- Roles: Owner, Administrator, Editor, Viewer.
- Metered dimensions: processing minutes, generated clips, storage, export usage and quality, active projects, concurrency, available features, connected Oyinca accounts.
- No unlimited expensive processing. Do not fix prices until real costs are benchmarked.

## 3. Import and AI intelligence engine

Sources (initial): authorised YouTube links and direct uploads. Paste link or upload, see info and progress, cancel, view past projects. Target: up to 60 minutes, English, MP4 and common formats; limits configurable; extensible to longer videos and more languages. A public YouTube URL is not permission to download and republish.

Intelligence: no arbitrary 30-second slices. Gemini API for semantic analysis (choose model after benchmarking); WhisperX or faster-whisper for transcripts and timestamps. Look for opinions, surprises, explanations, controversy, emotional, funny and personal-story moments, practical advice, storytelling.

Each proposed clip: start and end timestamps, title, description, transcript, hook, category, duration, engagement score (an estimate, never a virality guarantee), reason for selection.

A clip must start at a sensible point, not begin mid-sentence, hold a complete thought, not end before the speaker finishes, make sense alone and keep context.

User settings: number of clips, min and max duration, preferred categories, editing style. Suggested durations: 20, 30, 45, 60, 90 seconds.

## 4. Editing, captions and compression

Editing: FFmpeg is the primary render engine, with MediaPipe, OpenCV, PySceneDetect, WhisperX and Remotion where they fit. Detect primary speaker, reframe to 9:16, follow movement, handle multiple speakers, avoid cropping key content, subtle zooms, scene detection, dead-air removal where appropriate. Fall back sensibly and allow manual crop when unsure. No forced effects.

Captions: word-by-word and sentence captions, keyword highlights, fonts, sizes, position, boxes, colours, shadow, outline, branding, templates. At least four styles: Minimal, Bold animated, Cinematic, Clean educational. Preview before export; editable text and timestamps; subtitle import and export; safe areas clear of platform UI. Built into the web app.

Compression: MP4, H.264, AAC, 1080 x 1920, 30 fps where appropriate, yuv420p, CRF 23 to 26 as the starting benchmark, medium preset, audio 96 to 128 kbps. Modes: Standard, High quality, Smaller file. Adapt to motion complexity, resolution, source quality, duration, audio. Automatic quality checks and re-encode within limits. Show original size, final size, compression percentage, resolution, quality. Do not over-compress. Size figures are placeholders until benchmarked.

Cost controls: temp source retention with cleanup, reuse identical renders, batch processing with worker limits, storage quotas, usage tracking, finished clips in Cloudflare R2 behind a CDN (web app on Vercel). Never delete final assets against user retention settings.

## 5. Voice Studio

Optional, inside the clip editor: generate, preview, edit, regenerate, render. Existing clips work without narration.

Modes: AI narration (draft script, user edits, speech, sync); custom script; AI dubbing (translate, speak, sync).

| Provider | Role | Licence note to verify |
| --- | --- | --- |
| Kokoro TTS | Self-hosted default | Draft says Apache 2.0; check voice and deployment terms |
| ElevenLabs API | Premium voices | Free tier is not commercial; commercial from Starter plan |
| Qwen3-TTS | Multilingual, cloning | Draft says Apache 2.0; verify |
| Piper TTS | Local option | GPL obligations, per-voice licences |
| FFmpeg | Mixing and sync | n/a |

One provider-independent interface: voice listing, generation, languages, settings, usage and cost tracking, error handling; switch between self-hosted and external.

Audio settings: voice, gender, accents (Nigerian, British, American English where supported), speed, style, voice, music and original volumes, fades, preview. Mixing: keep original, replace speech, narrate over, intro voiceover, music plus narration, ducking.

Billing: track characters, duration, provider cost; quotas; bring-your-own credentials only if stored securely; never share one free account across customers.

Safety: no voice cloning without the person's explicit authorisation; consent verification, abuse prevention, reporting.

## 6. Oyinca integration

Independent SaaS integrating with [Oyinca](https://oyinca.com/). Inspect Oyinca's real architecture and use its actual integration contract; do not invent endpoints or auth. OAuth or another explicitly supported secure protocol. Oyinca keeps publishing, scheduling and approval; the Studio never bypasses approval.

Connection Manager: connect and disconnect; secure credential storage and refresh; fetch authorised workspaces, social accounts and destinations; transfer videos, captions, titles, descriptions, thumbnails; create approval-queue entries; track status; handle expired connections and failures; prevent duplicates.

Multiple connections: one user can connect several Oyinca accounts or agency workspaces as independent OAuth grants. Show name, status, workspaces, social accounts, authorisation status and permission level per connection. Never assume access across accounts.

Send to Oyinca: validate destination permissions; validate assets; check prior transfers; prepare jobs; transfer files; send metadata; create approval records; return per-destination status. Statuses: Pending, Uploading, Transferred, Awaiting approval, Failed, Cancelled. One failure never cancels other successes. Retries and idempotency required.

## 7. Distribution, shuffle and presets

Assignment: one clip to one or several accounts, all clips to selected accounts, per-clip destination selector, bulk matrix (rows clips, columns accounts, checkboxes), exclude accounts, preview before transfer.

Shuffle engine: per-account independent permutation (Fisher-Yates or equivalent); no identical sequences across accounts; reduce repeated adjacent patterns; each account gets each assigned clip exactly once; never schedule the same clip on several accounts at the same time, with a configurable minimum interval; controls: Shuffle, Reshuffle, Undo, Preview, Save plan, Manual order, Reset; spread across Oyinca publishing slots where supported; never auto-publish.

Content integrity: shuffling manages scheduling, it is not for evading platform detection or moderation, and it cannot guarantee platforms won't flag reused content. For distinct content, support real variations (hooks, captions, framing, edits).

Presets: reusable account groups (all TikTok, all YouTube, per client, educational, campaign, custom), editable and deletable.

## 8. Dashboard and design

Clean, minimalist, professional, fast, desktop-first and mobile-usable, strong video preview, clear processing states.

Navigation: Dashboard, New Project, My Projects, Generated Clips, Distribution Studio, Connected Accounts, Templates, Usage and Billing, Settings. Dashboard: projects, videos processed, clips, processing minutes, storage, recent projects and exports, connected Oyinca accounts, transfer activity.

## 9. Architecture and phases

Modular. Video rendering, AI inference and the web app are separately scaled.

| Layer | Choice |
| --- | --- |
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Python, FastAPI, background workers |
| Data and auth | Supabase PostgreSQL, Auth, RLS |
| AI | Gemini API; WhisperX or faster-whisper |
| Video | FFmpeg plus components in section 10 |
| Storage | Cloudflare R2 with CDN |

| Phase | Deliverable |
| --- | --- |
| 1 | Public SaaS, auth, dashboard, database |
| 2 | Ingestion, transcription, AI clip selection |
| 3 | Smart editing, captions, compression |
| 4 | Oyinca OAuth and approval-queue transfer |
| 5 | Subscriptions, usage limits, security, production testing |

Build in phases with tests. Audit repositories and design the architecture first. Voice Studio, distribution and optional repos have no assigned phase yet.

## 10. Open-source repositories (20)

Goal: one unified system, not 20 disconnected integrations. Starting stance is only what the drafts say.

| # | Repository | Role | Starting stance |
| --- | --- | --- | --- |
| 1 | remotion-dev/skills | Agent guidance for Remotion | Dev tooling only |
| 2 | ClipsAI/clipsai | Clipping, face tracking, cropping | Evaluate; reuse or adapt |
| 3 | modelscope/FunClip | Transcript-based selection | Evaluate |
| 4 | yt-dlp/yt-dlp | Source import | Authorised only; never bypass controls |
| 5 | lay295/TwitchDownloader | Twitch VODs, clips, chat | Future connector |
| 6 | streamlink/streamlink | Live capture | Optional, not MVP |
| 7 | obsproject/obs-studio | Recording | Do not embed; import its output |
| 8 | Breakthrough/PySceneDetect | Scene boundaries | Integrate where it helps |
| 9 | WyattBlue/auto-editor | Silence removal | Evaluate; keep storytelling pauses |
| 10 | SYSTRAN/faster-whisper | Transcription | Benchmark vs WhisperX |
| 11 | m-bain/whisperX | Word timestamps | Use for captions and boundaries |
| 12 | snakers4/silero-vad | Voice activity detection | Avoid overlapping detectors |
| 13 | google-ai-edge/mediapipe | Face tracking | Integrate for reframing |
| 14 | opencv/opencv | Crop maths, smoothing | Pair with MediaPipe; 9:16 |
| 15 | SubtitleEdit/subtitleedit | Subtitle editing | Reuse ideas; build in web app |
| 16 | mifi/lossless-cut | Lossless trimming | Only where server-side fits |
| 17 | Zulko/moviepy | Python editing | Avoid duplicating FFmpeg |
| 18 | OpenCut-app/OpenCut | Timeline editor | Future; not MVP if complex |
| 19 | remotion-dev/remotion | React templates | Use; check licence first |
| 20 | FFmpeg/FFmpeg | Core processing | Central component |

Strategy: classify each as core, optional, dev-only, future or unsuitable. Document purpose, licence, commercial limits, maintenance, hardware, dependencies, integration method, performance, security, running cost. Prefer library or API integration over desktop apps. Benchmark overlaps. Modular providers so components can be swapped.

## 11. Pipeline, performance and acceptance

Pipeline: (1) source acquisition, (2) media analysis, (3) content intelligence, (4) clip creation, (5) visual processing, (6) captions and audio, (7) final rendering, (8) distribution.

Performance: background jobs and queues, worker concurrency limits, GPU with CPU fallback, temp cleanup, caching, duplicate-render prevention, processing and storage quotas, model usage tracking. Do not run overlapping models on every video. Measure before choosing hardware.

Acceptance: import authorised video; transcribe; detect scenes; identify candidates; generate clips; track and reframe speakers; accurate captions; templates; optional voiceover; compression; MP4 download; multiple Oyinca accounts; authorised destinations; per-account assignment and independent shuffle; saved distribution plans; transfer to Oyinca queues; retry without duplicates; independent secure users; per-customer cost measurement.

Get right: no dependency monster (benchmark overlaps); no single server for everything; do not compromise the Oyinca integration.

## 12. Gaps and open questions

- Sections 18 to 23 of the original are missing.
- Confirm the three section 1 defaults.
- Oyinca's real API, OAuth and approval-queue contract is unknown; needs access to the Oyinca codebase.
- TTS and Remotion licence claims are unverified.
- Voice Studio, distribution and optional repos have no build phase.
- Treat all file-size targets as placeholders.
