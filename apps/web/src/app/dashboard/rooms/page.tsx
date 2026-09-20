import { PageHeader } from "@/components/dashboard/page-header";
import { RoomForm, RoomList } from "@/components/dashboard/room-controls";
import { dashboardTenant } from "@/lib/server/dashboard";
import { roomView } from "@/lib/server/views";

export default async function RoomsPage() {
  const { tenant } = await dashboardTenant("/dashboard/rooms");
  const rooms = (await tenant.rooms.list()).map(roomView);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Rooms"
        description="The family's names for the rooms in the house, so answers say “the den” the way you do. Name one room “door”: the leaving-the-house routine fires when the wearer is near it."
      />

      <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4 text-sm">
        <p>
          <span className="font-medium">Private rooms</span> are never described in answers. Marking a room private is
          for the later on-device privacy gate; it does not stop frames from being uploaded today, so pause capture
          before entering one.
        </p>
      </div>

      <RoomForm />
      <RoomList initial={rooms} />
    </div>
  );
}
