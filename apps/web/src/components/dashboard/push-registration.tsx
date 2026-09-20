"use client";

import { useEffect } from "react";
import { pushSupported, registerServiceWorker } from "@/lib/client/push";

// Registers public/sw.js so an already-subscribed device keeps receiving alerts
// after the worker is updated. Subscribing happens in PushToggle on Settings.
export function PushRegistration() {
  useEffect(() => {
    if (pushSupported()) registerServiceWorker().catch(() => null);
  }, []);
  return null;
}
