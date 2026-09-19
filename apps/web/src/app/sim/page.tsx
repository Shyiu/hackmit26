import { SimulatorView } from "./simulator-view";

// Browser simulator: webcam + mic in, answer audio out. See README "Capture path A".
export default function SimPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Simulator</h1>
        <p className="text-muted-foreground">
          Stands in for the glasses. Video from this camera, audio from this mic, same
          two endpoints the real product uses.
        </p>
      </div>
      <SimulatorView />
    </div>
  );
}
