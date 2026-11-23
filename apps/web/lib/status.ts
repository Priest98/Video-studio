/** Plain words for project states. Colour is never the only signal: the word always shows. */
export function statusLabel(status: string): { text: string; tone: string } {
  switch (status) {
    case "ready": return { text: "Ready", tone: "text-ok" };
    case "processing": return { text: "Working on it", tone: "text-steel" };
    case "failed": return { text: "Something went wrong", tone: "text-danger" };
    case "cancelled": return { text: "Stopped", tone: "text-muted" };
    default: return { text: "Waiting to start", tone: "text-ink-2" };
  }
}
