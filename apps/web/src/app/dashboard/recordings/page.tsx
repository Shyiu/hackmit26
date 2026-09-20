import { Clock, Glasses, Smartphone } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { dashboardTenant } from "@/lib/server/dashboard";
import { cn } from "@/lib/utils";

export default async function RecordingsPage() {
  const { settings } = await dashboardTenant("/dashboard/recordings");

  return (
    <>
      <PageHeader title="Recordings" icon={Clock} description="Video the chest phone recorded." />
      <PageBody width="sm">
      <div className="flex flex-col gap-3 rounded-lg border border-hairline p-4">
        <Smartphone className="size-5 text-muted-foreground" />
        <p className="text-sm">
          For now, recordings stay on the phone. Nothing is uploaded, so there&apos;s nothing to list here yet.
        </p>
        <p className="text-xs text-muted-foreground">
          Open the wear page on the chest phone to save a recording to its photos or share it.
          {!settings.recordingAllowed && " Recording is off in Settings right now."}
        </p>
        <Link href="/wear" className={cn(buttonVariants({ size: "sm" }), "w-full sm:w-auto sm:self-start")}>
          <Glasses />
          Open the wear page
        </Link>
      </div>
      </PageBody>
    </>
  );
}
