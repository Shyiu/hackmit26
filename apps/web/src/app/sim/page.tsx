import { SimulatorView } from "./simulator-view";

// Browser simulator: the headset client on a flat page. See README "Capture paths", path A.
export default function SimPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Simulator</h1>
        <p className="text-muted-foreground">
          The headset view on a flat page. Video from this camera, audio from this mic, and
          the same two endpoints the headset uses. Run it on a laptop, or hold a phone in
          the hand.
        </p>
      </div>
      <SimulatorView />
    </div>
  );
}
