import type { ReactNode } from "react";
import { MobileHeader, Sidebar, TabBar } from "@/components/dashboard/nav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 md:px-8 md:pt-8 md:pb-10">
          {children}
        </main>
      </div>
      <TabBar />
    </div>
  );
}
