import { ScanFace } from "lucide-react";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { AddPersonForm, PeopleList } from "@/components/dashboard/people-controls";
import { dashboardTenant } from "@/lib/server/dashboard";
import { listPeople } from "@/lib/server/perception";

export default async function PeoplePage() {
  const { tenant } = await dashboardTenant("/dashboard/people");
  const people = await listPeople(tenant);

  return (
    <>
      <PageHeader
        title="Faces"
        icon={ScanFace}
        description="People the camera should recognize. It only ever matches against the people listed here."
      />
      <PageBody width="md">
      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-muted/60 p-3 text-sm">
        <p>
          <span className="font-medium">A test page for now.</span> Add someone, stream from the phone, and their row
          shows when the camera last matched them and how closely. A match of 0.45 or more names them.
        </p>
      </div>

      <AddPersonForm />
      <PeopleList initial={people} />
      </PageBody>
    </>
  );
}
