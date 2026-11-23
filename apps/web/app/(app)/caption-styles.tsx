import type { CSSProperties } from "react";

/** The caption looks the worker burns into the video, drawn the same way here. */
export type CaptionStyle = { id: string; name: string; text: CSSProperties; hi: string; box?: boolean };

export const CAPTION_STYLES: CaptionStyle[] = [
  { id: "bold_animated", name: "Bold", hi: "#ffe500",
    text: { fontWeight: 800, textTransform: "uppercase", fontSize: 17, WebkitTextStroke: "3px #000", paintOrder: "stroke fill" } },
  { id: "minimal", name: "Simple", hi: "#ffffff",
    text: { fontWeight: 400, fontSize: 14, textShadow: "0 0 3px #000, 0 0 3px #000" } },
  { id: "cinematic", name: "Cinematic", hi: "#ffc040",
    text: { fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 15, color: "#f0f0f0", textShadow: "0 2px 3px #000" } },
  { id: "clean_educational", name: "Boxed", hi: "#ffc800", box: true,
    text: { fontWeight: 700, fontSize: 14 } },
];

const SAMPLE = ["Watch", "how", "this", "looks"];

/** Caption text in one style, with the second word highlighted like the real word-by-word captions. */
export function CaptionText({ s, scale = 1 }: { s: CaptionStyle; scale?: number }) {
  const size = Number(s.text.fontSize ?? 14) * scale;
  return (
    <p
      className="max-w-[84%] text-center leading-tight text-white"
      style={{ ...s.text, fontSize: size, ...(s.box ? { background: "rgba(0,0,0,0.72)", padding: "3px 6px", borderRadius: 3 } : {}) }}
    >
      {SAMPLE.map((w, i) => (
        <span key={w} style={{ color: i === 1 ? s.hi : (s.text.color as string | undefined) ?? "#fff" }}>{w}{i < SAMPLE.length - 1 ? " " : ""}</span>
      ))}
    </p>
  );
}

/** Neutral stand-in for a speaker, so the card reads as a video frame without inventing content. */
export function Frame({ s, scale = 1 }: { s: CaptionStyle; scale?: number }) {
  return (
    <div aria-hidden className="relative flex h-full w-full flex-col items-center justify-end overflow-hidden rounded-[inherit] bg-[#11141c]">
      <div className="absolute left-1/2 top-[22%] size-[34%] -translate-x-1/2 rounded-full bg-[#2a3144]" />
      <div className="absolute left-1/2 top-[48%] h-[60%] w-[70%] -translate-x-1/2 rounded-t-[50%] bg-[#1d2333]" />
      <div className="relative mb-[26%] flex w-full justify-center"><CaptionText s={s} scale={scale} /></div>
      <div className="absolute inset-x-[8%] bottom-[7%] h-[3px] rounded-full bg-white/15"><div className="h-full w-[38%] rounded-full bg-steel" /></div>
    </div>
  );
}
