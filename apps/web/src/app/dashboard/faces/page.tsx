import { AddFaceForm, DeleteFaceButton } from "@/components/dashboard/face-controls";
import { PageHeader } from "@/components/dashboard/page-header";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function FacesPage() {
  const { tenant } = await dashboardTenant("/dashboard/faces");
  const people = await tenant.people.list();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Faces"
        description="Add the people the wearer knows, so the app can say who is with them."
      />

      <AddFaceForm />

      {people.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No faces yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10">
          {people.map((person) => (
            <li key={person._id.toHexString()} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground uppercase"
                >
                  {person.name.charAt(0)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{person.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{person.relation ?? "No relation set"}</span>
                </span>
              </span>
              <DeleteFaceButton id={person._id.toHexString()} name={person.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
