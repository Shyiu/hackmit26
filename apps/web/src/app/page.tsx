import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Memory glasses</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          A wearable camera that remembers where things are, for people living with dementia.
          Ask &ldquo;where are my keys?&rdquo; out loud and hear the answer. This build runs on
          a phone in a 3D-printed headset.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/headset" className={buttonVariants()}>
          Headset
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Caregiver dashboard
        </Link>
        <Link href="/sim" className={buttonVariants({ variant: "outline" })}>
          Simulator
        </Link>
      </div>
    </div>
  );
}
