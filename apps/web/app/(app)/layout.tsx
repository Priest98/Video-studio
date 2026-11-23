import Link from "next/link";
import { Film } from "lucide-react";
import { Logo } from "@/components/logo";
import { logout } from "../login/actions";
import { OPEN_MODE } from "@/lib/open-mode";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 sm:px-6 lg:px-8">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="Video Studio home"><Logo /></Link>
        <nav className="flex items-center gap-1 text-[15px]">
          <Link href="/projects" className="flex items-center gap-2 rounded-lg px-3 py-2 font-medium transition-colors hover:bg-sunken">
            <Film aria-hidden size={16} strokeWidth={1.5} />My clips
          </Link>
          {!OPEN_MODE && (
            <form action={logout}><button className="rounded-lg px-3 py-2 text-ink-2 transition-colors hover:bg-sunken">Log out</button></form>
          )}
        </nav>
      </header>
      <main className="flex-1 pb-16 pt-4 sm:pt-8">{children}</main>
    </div>
  );
}
