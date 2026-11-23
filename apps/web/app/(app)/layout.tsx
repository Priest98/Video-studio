import Link from "next/link";
import { logout } from "../login/actions";
import { OPEN_MODE } from "@/lib/open-mode";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col px-4 sm:px-6">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" className="text-lg font-semibold">Video Studio</Link>
        <nav className="flex items-center gap-1 text-[15px]">
          <Link href="/projects" className="rounded-lg px-3 py-2 font-medium hover:bg-sunken">My clips</Link>
          {!OPEN_MODE && (
            <form action={logout}><button className="rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken">Log out</button></form>
          )}
        </nav>
      </header>
      <main className="flex-1 pb-16 pt-6">{children}</main>
    </div>
  );
}
