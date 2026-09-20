import { Box } from "lucide-react";
import type { ScanFeedStatus } from "@/hooks/use-scan-feed";
import { cn } from "@/lib/utils";

// One chip for the wearer's status row, shown only while frames reach the 3D
// room scan. Looks like the neutral StatusChip in wear-view.
export function ScanStatusChip({ status, className }: { status: ScanFeedStatus; className?: string }) {
  if (status !== "scanning") return null;
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5", className)}>
      <Box className="size-4" />
      3D scan
    </span>
  );
}
