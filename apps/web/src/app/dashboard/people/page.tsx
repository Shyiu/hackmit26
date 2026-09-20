import { PageHeader } from "@/components/dashboard/page-header";
import { AddPersonForm, PeopleList } from "@/components/dashboard/people-controls";
import { HttpError } from "@/lib/server/api";
import { dashboardTenant } from "@/lib/server/dashboard";
import { listPeople, type EnrolledPerson } from "@/lib/server/perception";

export default async function PeoplePage() {
  const { principal } = await dashboardTenant("/dashboard/people");
  let people: EnrolledPerson[] = [];
  let unreachable: string | null = null;
  try {
    people = await listPeople(principal.patientId);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    unreachable = error.message;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Faces"
        description="People the camera should recognize. It only ever matches against the people listed here."
      />

      <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4 text-sm">
        <p>
          <span className="font-medium">A test page for now.</span> Add someone, stream from the phone, and their row
          shows when the camera last matched them and how closely. A match of 0.45 or more names them.
        </p>
        {unreachable && <p className="font-medium text-destructive">{unreachable}</p>}
      </div>

      <AddPersonForm />
      <PeopleList initial={people} />
    </div>
  );
}
