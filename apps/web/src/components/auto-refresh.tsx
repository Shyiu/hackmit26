"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-renders the server components on the page every `intervalMs` while the tab
// is visible. README "Caregiver dashboard": MVP updates poll every two seconds.
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
