import { redirect } from "next/navigation";

// Keep existing dashboard bookmarks pointed at the demo and live scan viewer.
export default function LivePage() {
  redirect("/dashboard/map");
}
