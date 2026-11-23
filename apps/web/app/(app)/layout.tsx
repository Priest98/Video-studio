import Link from "next/link";
import { logout } from "../login/actions";

const NAV = [
  ["Dashboard", "/dashboard"],
  ["New Project", "/projects/new"],
  ["My Projects", "/projects"],
  ["Generated Clips", "/clips"],
  ["Distribution Studio", "/distribution"],
  ["Connected Accounts", "/accounts"],
  ["Templates", "/templates"],
  ["Usage", "/billing"],
  ["Settings", "/settings"],
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r p-4">
        <p className="mb-4 text-lg font-semibold">Video Studio</p>
        {NAV.map(([label, href]) => (
          <Link key={href} href={href} className="rounded px-2 py-1.5 text-sm hover:bg-black/5">
            {label}
          </Link>
        ))}
        <form action={logout} className="mt-auto">
          <button className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-black/5">Log out</button>
        </form>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
