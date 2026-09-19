import { locationStatus, tenantRepos, type LocationStatus } from "@memory-glasses/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { relativeTime } from "@/lib/server/answer";
import { principalFromSession, SESSION_COOKIE } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

const STATUS_LABELS: Record<LocationStatus, string> = {
  observed: "Seen resting",
  held: "In hand",
  moved: "Being moved",
  uncertain: "Place unclear",
  unseen: "Not seen yet",
};

export default async function ItemsPage() {
  const principal = await principalFromSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!principal) redirect("/login?next=/dashboard/items");
  const items = await tenantRepos(getDb(), principal.patientId).items.list();
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Items</h1>
        <p className="text-muted-foreground">Where each tracked item was last seen, and what the wearer would hear.</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items yet. Run `pnpm db:seed` for the demo set.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Where</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item._id.toHexString()}>
                <TableCell className="font-medium">
                  {item.name}
                  {item.aliases.length > 0 && (
                    <span className="block text-xs text-muted-foreground">{item.aliases.join(", ")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{STATUS_LABELS[locationStatus(item.lastSighting)]}</Badge>
                </TableCell>
                <TableCell>{item.lastSighting ? relativeTime(item.lastSighting.lastSeenAt, now) : "never"}</TableCell>
                <TableCell>{item.lastSighting?.sentence ?? "unknown"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
