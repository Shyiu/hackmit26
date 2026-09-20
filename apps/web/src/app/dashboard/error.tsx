"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex max-w-md flex-col gap-4 border-y border-border py-6">
      <h1 className="text-xl font-bold text-brand-deep">This page didn’t load</h1>
      <p className="text-muted-foreground">
        The dashboard couldn’t reach its data. Check your connection and try again. If it keeps happening, the
        database may be down.
      </p>
      <Button onClick={reset} size="lg" className="self-start">
        Try again
      </Button>
    </div>
  );
}
