import { Glasses, Smartphone } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

export default async function RecordingsPage() {
  const { settings } = await dashboardTenant("/dashboard/recordings");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title="Recordings" description="Video the chest phone recorded." />
      <div className="flex flex-col gap-4 rounded-xl p-5 ring-1 ring-foreground/10">
        <Smartphone className="size-6 text-muted-foreground" />
        <p className="text-base">
          For now, recordings stay on the phone. Nothing is uploaded, so there&apos;s nothing to list here yet.
        </p>
        <p className="text-sm text-muted-foreground">
          Open the wear page on the chest phone to save a recording to its photos or share it.
          {!settings.recordingAllowed && " Recording is off in Settings right now."}
        </p>
        <Link href="/wear" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto sm:self-start")}>
          <Glasses />
          Open the wear page
        </Link>
      </div>
    </div>
  );
}
