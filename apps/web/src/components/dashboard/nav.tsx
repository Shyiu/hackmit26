"use client";

import { Ellipsis, Glasses, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { Wordmark } from "@/components/brand";
import { cn } from "@/lib/utils";
import { CaptureBadge } from "./capture-badge";
import { isActive, PRIMARY_LINKS, SECONDARY_LINKS } from "./nav-links";
import { navRowClass, SignOutButton } from "./sign-out-button";

// The tiny muted heading over each group of sidebar rows.
function GroupLabel({ children }: { children: string }) {
  return <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground/80">{children}</p>;
}

// Desktop: a narrow sidebar on the page tint, with the wordmark and the camera
// state at the top and every page grouped below it.
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col px-2 py-2 md:flex">
      <Link
        href="/dashboard"
        className="flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-row-hover"
        aria-label="Memoir home"
      >
        <Wordmark />
      </Link>
      <CaptureBadge className="mx-2 mt-1.5 self-start" />
      <nav className="mt-2 flex flex-col">
        {PRIMARY_LINKS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={navRowClass(isActive(pathname, href))}>
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        ))}
        <GroupLabel>More</GroupLabel>
        {SECONDARY_LINKS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={navRowClass(isActive(pathname, href))}>
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex flex-col">
        <Link href="/wear" className={navRowClass(false)}>
          <Glasses className="size-4 shrink-0" />
          Open the wear page
        </Link>
        <SignOutButton className={navRowClass(false)} />
      </div>
    </aside>
  );
}

// Phones: a slim top bar under the status bar, over the page's own header.
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-panel/90 pt-safe backdrop-blur md:hidden">
      <div className="flex h-12 items-center justify-between gap-3 px-4">
        <Link href="/dashboard" aria-label="Memoir home">
          <Wordmark />
        </Link>
        <CaptureBadge compact />
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

  // The active tab is marked by the icon and label going brand, not by a pill.
  const tabClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors",
      active ? "text-brand-deep" : "text-muted-foreground",
    );
  const iconClass = (active: boolean) => cn("size-5", active ? "text-brand" : "text-muted-foreground");

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-foreground/30 animate-in fade-in"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-lg border-t border-hairline bg-panel px-2 pt-2 pb-[calc(5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom">
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-sm font-semibold">More</span>
              <button
                type="button"
                aria-label="Close"
                className="flex size-9 items-center justify-center rounded-md hover:bg-row-hover"
                onClick={() => setMoreOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="flex flex-col">
              {SECONDARY_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={navRowClass(isActive(pathname, href))}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              ))}
              <Link href="/wear" className={navRowClass(false)}>
                <Glasses className="size-4 shrink-0" />
                Open the wear page
              </Link>
              <SignOutButton className={navRowClass(false)} />
            </nav>
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-panel/95 pb-safe backdrop-blur md:hidden">
        <div className="flex h-16 gap-1 px-2">
          {PRIMARY_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMoreOpen(false)}
              className={tabClass(isActive(pathname, href))}
            >
              <Icon className={iconClass(isActive(pathname, href))} strokeWidth={1.75} />
              {label}
            </Link>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className={tabClass(moreOpen || moreActive)}
          >
            <Ellipsis className={iconClass(moreOpen || moreActive)} />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
