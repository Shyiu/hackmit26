import type { ReactNode } from "react";
import { MobileHeader, Sidebar, TabBar } from "@/components/dashboard/nav";

// Linear's shell: the sidebar sits directly on the tinted page, and everything
// else lives on a white panel inset from it by a hair. On phones the panel
// fills the screen and the sidebar becomes the tab bar.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-page">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col md:py-1.5 md:pr-1.5">
        <div className="flex min-w-0 flex-1 flex-col bg-panel md:rounded-lg md:border md:border-hairline md:shadow-[0_1px_2px_rgb(20_45_120/0.06)]">
          <MobileHeader />
          <main className="flex-1 px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 md:px-0 md:pt-0 md:pb-0">
            {children}
          </main>
        </div>
      </div>
      <TabBar />
    </div>
  );
}
