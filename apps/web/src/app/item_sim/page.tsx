import type { Metadata } from "next";
import { ItemSimView } from "./item-sim-view";

export const metadata: Metadata = { title: "Item detection test" };

// A testing session for the detection -> sighting -> description pipeline:
// the same capture client as /sim, plus a live status panel so a dev can
// confirm an item was actually seen and logged without asking a question.
export default function ItemSimPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Item detection test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hold a tracked item (see the list below) in front of the camera. A label appears on the
          video the moment the detector recognizes it; the status list below updates once a
          sighting is confirmed and again once the vision model has described where it is.
        </p>
      </div>
      <ItemSimView />
    </div>
  );
}
