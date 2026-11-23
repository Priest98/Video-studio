import CreateForm from "./create-form";

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-[clamp(32px,8vw,44px)] font-medium leading-[1.1]">
        Turn a long video into short clips
      </h1>
      <CreateForm />
    </div>
  );
}
