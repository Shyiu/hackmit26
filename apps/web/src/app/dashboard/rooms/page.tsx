import { Lock } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddRoomForm, RoomPrivateSwitch } from "@/components/dashboard/room-controls";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function RoomsPage() {
  const { tenant } = await dashboardTenant("/dashboard/rooms");
  const rooms = await tenant.rooms.list();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Rooms"
        description="Name the rooms the way the family does, so answers say “the den” and not “living room”."
      />

      <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4 text-sm">
        <p>
          <span className="font-medium">Walkthrough enrollment isn&apos;t built yet.</span> Until it is, the camera
          names room types on its own, and these names are a list for later.
        </p>
        <p className="text-muted-foreground">
          “Private” is for a later gate on the phone that stops frames before upload. Today it&apos;s only a flag on
          the server, not a privacy guarantee.
        </p>
      </div>

      <AddRoomForm />

      {rooms.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No rooms yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
          {rooms.map((room) => (
            <li key={room._id.toHexString()} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span className="truncate">{room.name}</span>
                {room.private && <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Private" />}
              </span>
              <RoomPrivateSwitch id={room._id.toHexString()} name={room.name} checked={room.private} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
