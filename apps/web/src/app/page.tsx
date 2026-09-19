import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Memory glasses</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Smart glasses that remember where things are, for people living with dementia.
          Ask &ldquo;where are my keys?&rdquo; out loud, get an answer back.
        </p>
      </div>
      <div className="flex gap-3">
        <Button render={<Link href="/dashboard" />}>Caregiver dashboard</Button>
        <Button render={<Link href="/sim" />} variant="outline">
          Simulator
        </Button>
      </div>
    </div>
  );
}
