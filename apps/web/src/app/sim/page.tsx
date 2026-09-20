import type { Metadata } from "next";
import { SimulatorView } from "./simulator-view";

export const metadata: Metadata = { title: "Simulator" };

// Capture path A: the wear client on a flat page. See PLAN.md "Capture paths".
export default function SimPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Simulator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The wear page on a laptop webcam or a phone held in the hand. Same camera, frame upload,
          and answers, with the video and labels on screen.
        </p>
      </div>
      <SimulatorView />
    </div>
  );
}
