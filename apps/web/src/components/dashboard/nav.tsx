"use client";

import { Ellipsis, Glasses, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { cn } from "@/lib/utils";
import { CaptureBadge } from "./capture-badge";
import { isActive, PRIMARY_LINKS, SECONDARY_LINKS } from "./nav-links";
import { navRowClass, SignOutButton } from "./sign-out-button";

// Desktop: a sticky sidebar with every page.
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r px-3 py-6 md:flex">
      <Link href="/" className="flex items-center gap-2 px-3 text-sm font-semibold">
        <Glasses className="size-5" />
        Memory glasses
      </Link>
      <CaptureBadge className="mx-3 self-start" />
      <nav className="flex flex-col gap-1">
        {[...PRIMARY_LINKS, ...SECONDARY_LINKS].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={navRowClass(isActive(pathname, href))}>
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <Link href="/wear" className={navRowClass(false)}>
          <Glasses className="size-4" />
          Open the wear page
        </Link>
        <SignOutButton className={navRowClass(false)} />
      </div>
    </aside>
  );
}

// Phones: a slim top bar under the status bar.
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 pt-safe backdrop-blur md:hidden">
      <div className="flex h-12 items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <Glasses className="size-5" />
          Memory glasses
        </Link>
        <CaptureBadge />
      </div>
    </header>
  );
}

// Phones: a tab bar over the home indicator, with the rest of the pages in a
// sheet behind More.
export function TabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = SECONDARY_LINKS.some((link) => isActive(pathname, link.href));

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") setMoreOpen(false);
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
      active ? "text-foreground" : "text-muted-foreground",
    );

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/40 animate-in fade-in"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t bg-background px-3 pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-sm font-semibold">More</span>
              <button
                type="button"
                aria-label="Close"
                className="flex size-10 items-center justify-center rounded-full hover:bg-accent"
                onClick={() => setMoreOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {SECONDARY_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={navRowClass(isActive(pathname, href))}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              ))}
              <Link href="/wear" className={navRowClass(false)}>
                <Glasses className="size-5" />
                Open the wear page
              </Link>
              <SignOutButton className={cn(navRowClass(false), "w-full")} />
            </nav>
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-safe backdrop-blur md:hidden">
        <div className="flex h-16 px-safe">
          {PRIMARY_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMoreOpen(false)}
              className={tabClass(isActive(pathname, href))}
            >
              <Icon className="size-6" />
              {label}
            </Link>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className={tabClass(moreOpen || moreActive)}
          >
            <Ellipsis className="size-6" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
