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

export const navRowClass = (active: boolean) =>
  cn(
    "flex min-h-10 items-center gap-3 rounded-full px-4 text-sm transition-colors pointer-coarse:min-h-12",
    active
      ? "bg-brand font-medium text-white shadow-[0_6px_16px_-8px_rgb(47_95_208/0.7)]"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  );
