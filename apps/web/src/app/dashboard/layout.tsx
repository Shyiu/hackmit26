import Link from "next/link";
import type { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/dashboard/items", label: "Items" },
  { href: "/dashboard/rooms", label: "Rooms" },
  { href: "/dashboard/questions", label: "Questions" },
  { href: "/dashboard/live", label: "Live view" },
  { href: "/dashboard/messages", label: "Messages" },
  { href: "/dashboard/recordings", label: "Recordings" },
  { href: "/dashboard/latency", label: "Latency" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r px-4 py-6">
        <Link href="/" className="mb-6 block text-sm font-semibold">
          Memory glasses
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
