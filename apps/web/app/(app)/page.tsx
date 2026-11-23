import CreateForm from "./create-form";
import HeroStack from "./hero-stack";

export default function Home() {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:gap-16">
      <div className="order-2 flex flex-col gap-8 lg:order-1">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[clamp(36px,9vw,56px)] font-medium leading-[1.05] tracking-[-0.02em]">
            Turn a long video into short clips
          </h1>
          <p className="max-w-[34rem] text-[18px] leading-[1.55] text-ink-2">
            Paste a link, pick a caption style, and get vertical clips with captions, ready to post.
          </p>
        </div>
        <CreateForm />
      </div>
      <div className="order-1 lg:order-2"><HeroStack /></div>
    </div>
  );
}
