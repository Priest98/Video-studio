/** The caption Video Studio suggests to Oyinca: the written description, else the opening hook, else the title. Never empty if any exist. */
export function clipCaption(clip: { description?: string | null; hook?: string | null; title?: string | null }): string | undefined {
  const pick = [clip.description, clip.hook, clip.title].map((v) => (v ?? "").replace(/\s+/g, " ").trim()).find(Boolean);
  return pick ? pick.slice(0, 2200) : undefined;
}
