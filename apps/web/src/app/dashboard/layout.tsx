import type { ReactNode } from "react";
import { Sidebar, TabBar } from "@/components/dashboard/nav";
import { caregiverWearers } from "@/lib/server/dashboard";

// Linear's shell: the sidebar sits directly on the tinted page, and everything
// else lives on a white panel inset from it by a hair. On phones the panel
// fills the screen and the sidebar becomes the tab bar.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const wearers = await caregiverWearers();
  return (
    <div className="flex min-h-dvh bg-page">
      <Sidebar patients={wearers.patients} selectedId={wearers.selectedId} />
      <div className="flex min-w-0 flex-1 flex-col md:py-1.5 md:pr-1.5">
        <div className="flex min-w-0 flex-1 flex-col bg-panel md:rounded-lg md:border md:border-hairline md:shadow-[0_1px_2px_rgb(20_45_120/0.06)]">
          <main className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
        </div>
      </div>
      <TabBar patients={wearers.patients} selectedId={wearers.selectedId} />
    </div>
  );
}
