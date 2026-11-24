export default function ConnectForm() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-ink-2">
        You will go to Oyinca to give permission. If you are not signed in there, it asks you to sign in first. Video Studio can send clips for your approval. It cannot post.
      </p>
      <a href="/api/oyinca/connect" className="btn btn-primary w-fit">Connect Oyinca</a>
    </div>
  );
}
