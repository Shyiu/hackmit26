import { Glasses, Laptop, LayoutDashboard, UserPlus } from "lucide-react";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { Tile } from "@/components/home/tiles";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-12">
      <header className="flex flex-col gap-4">
        <Wordmark className="text-lg" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-balance">Where did I put my keys?</h1>
          <p className="mt-2 text-muted-foreground">
            A camera worn on the chest remembers where things were last seen, and answers out loud
            for people living with dementia.
          </p>
        </div>
      </header>
      <nav className="grid grid-cols-2 gap-3">
        <Tile href="/wear" title="Wear" icon={Glasses} tone="terracotta" />
        <Tile href="/dashboard" title="Dashboard" icon={LayoutDashboard} tone="lavender" />
        <Tile href="/sim" title="Simulator" icon={Laptop} tone="sky" />
        <Tile href="/signup" title="Sign up" icon={UserPlus} tone="butter" />
      </nav>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-terracotta-deep">
          Sign in
        </Link>
      </p>
    </div>
  );
}
