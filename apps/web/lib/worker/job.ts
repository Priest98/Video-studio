export const CAPTION_STYLES = ["minimal", "bold_animated", "cinematic", "clean_educational"] as const;
export const QUALITIES = ["standard", "high", "small"] as const;
export const DURATIONS = [20, 30, 45, 60, 90];

export interface ProjectSettings {
  caption_style: (typeof CAPTION_STYLES)[number];
  caption_mode: "word" | "sentence";
  quality: (typeof QUALITIES)[number];
  selection: { clip_count: number; min_seconds: number; max_seconds: number; categories: string[] };
}

const clamp = (n: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(n)) ? Math.min(Math.max(Number(n), lo), hi) : d);

/** Never pass user-controlled settings to the worker unchecked. */
export function parseSettings(raw: Record<string, unknown> | undefined): ProjectSettings {
  const r = raw ?? {}, sel = (r.selection ?? {}) as Record<string, unknown>;
  const min = clamp(sel.min_seconds, 10, 120, 20), max = clamp(sel.max_seconds, 10, 180, 60);
  return {
    caption_style: (CAPTION_STYLES as readonly string[]).includes(r.caption_style as string) ? (r.caption_style as ProjectSettings["caption_style"]) : "bold_animated",
    caption_mode: r.caption_mode === "sentence" ? "sentence" : "word",
    quality: (QUALITIES as readonly string[]).includes(r.quality as string) ? (r.quality as ProjectSettings["quality"]) : "standard",
    selection: {
      clip_count: clamp(sel.clip_count, 1, 20, 5),
      min_seconds: Math.min(min, max), max_seconds: Math.max(min, max),
      categories: Array.isArray(sel.categories) ? sel.categories.map(String).slice(0, 8).map((c) => c.slice(0, 40)) : [],
    },
  };
}

export function workerJob(project: { id: string; workspace_id: string; settings: unknown }, source: { source_url?: string; import_url?: string; rights_confirmed?: boolean }, appUrl: string) {
  const s = parseSettings(project.settings as Record<string, unknown>);
  return { ...source, ...s, project_id: project.id, workspace_id: project.workspace_id, callback_url: `${appUrl}/api/worker/callback` };
}
