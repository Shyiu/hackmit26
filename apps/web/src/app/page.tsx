import { ChevronRight, Glasses, LayoutDashboard, Laptop } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

const DESTINATIONS: { href: string; title: string; body: string; icon: LucideIcon }[] = [
  {
    href: "/wear",
    title: "Wear",
    body: "For the phone on the chest. Streams the camera, answers questions out loud.",
    icon: Glasses,
  },
  {
    href: "/dashboard",
    title: "Caregiver dashboard",
    body: "Where things are, what was asked, and the live view.",
    icon: LayoutDashboard,
  },
  {
    href: "/sim",
    title: "Simulator",
    body: "The same client on a laptop webcam or a phone in the hand.",
    icon: Laptop,
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 pt-safe pb-safe">
      <div className="pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Memory glasses</h1>
        <p className="mt-3 text-muted-foreground">
          A wearable camera that remembers where things are, for people living with dementia.
          Ask &ldquo;where are my keys?&rdquo; out loud and hear the answer.
        </p>
      </div>
      <nav className="flex flex-col gap-3 pb-10">
        {DESTINATIONS.map(({ href, title, body, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-2xl border p-4 transition-colors hover:bg-accent active:bg-accent"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{body}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
