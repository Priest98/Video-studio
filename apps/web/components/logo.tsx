/** The Video Studio mark: a vertical clip frame with a play button and a caption line. Flat, two colors plus one accent. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 64" width={size} height={size} className={className}>
      <rect width="64" height="64" rx="16" fill="#0a1931" />
      <rect x="19" y="9" width="26" height="46" rx="7" fill="#faf6ef" />
      <path d="M29 20.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 29 20.5Z" fill="#0a1931" />
      <rect x="24.5" y="41" width="15" height="4.5" rx="2.25" fill="#4a7fa7" />
    </svg>
  );
}

/** Mark and name together, for headers. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-lg font-semibold">
      <LogoMark size={size} />
      Video Studio
    </span>
  );
}
