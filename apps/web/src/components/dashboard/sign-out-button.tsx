"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={() => void signOut()} className={className}>
      <LogOut className="size-4" />
      Sign out
    </button>
  );
}

// A sidebar row: 28 tall, 13px, a 6px radius, and no colour until it's the page
// you're on — then it fills with the faintest brand tint, the way Linear marks
// the active view.
export const navRowClass = (active: boolean) =>
  cn(
    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors pointer-coarse:h-10",
    active
      ? "bg-brand-soft font-medium text-brand-deep"
      : "text-muted-foreground hover:bg-row-hover hover:text-foreground",
  );
