"use client";

import { useRef } from "react";
import { CAPTION_STYLES, Frame } from "./caption-styles";

/** Three vertical clips floating in depth. Tilts toward the pointer; stays still for reduced motion. */
export default function HeroStack() {
  const stage = useRef<HTMLDivElement>(null);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const el = stage.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(x * 16).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * 12).toFixed(2)}deg`);
  }
  function reset() {
    stage.current?.style.setProperty("--ry", "0deg");
    stage.current?.style.setProperty("--rx", "0deg");
  }

  const cards = [
    { s: CAPTION_STYLES[2], t: "translate3d(-104%, 6%, -90px) rotateY(24deg) rotateZ(-5deg)" },
    { s: CAPTION_STYLES[3], t: "translate3d(104%, 6%, -90px) rotateY(-24deg) rotateZ(5deg)" },
    { s: CAPTION_STYLES[0], t: "translate3d(0, -4%, 60px)" },
  ];

  return (
    <div onPointerMove={move} onPointerLeave={reset} className="stack-scene relative mx-auto h-[300px] w-full max-w-[460px] sm:h-[440px]" aria-hidden>
      <div ref={stage} className="stack-stage absolute inset-0 flex items-center justify-center">
        {cards.map(({ s, t }) => (
          <div
            key={s.id}
            className="absolute aspect-[9/16] w-[32%] rounded-[18px] border border-white/10 bg-[#11141c] p-0 shadow-[0_28px_44px_-12px_rgba(10,25,49,0.45),inset_0_1px_0_rgba(255,255,255,0.1)]"
            style={{ transform: t }}
          >
            <Frame s={s} scale={0.9} />
            <span className="absolute left-2 top-2 size-3 rounded-tl-[4px] border-l-2 border-t-2 border-white/40" />
            <span className="absolute right-2 top-2 size-3 rounded-tr-[4px] border-r-2 border-t-2 border-white/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
