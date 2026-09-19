import { BackLink } from "@/components/dashboard/back-link";
import { ItemForm } from "@/components/dashboard/item-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function NewItemPage() {
  await dashboardTenant("/dashboard/items/new");
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackLink href="/dashboard/items" label="Items" />
      <PageHeader
        title="Add an item"
        description="The camera starts looking for it once it's saved. Photos come later."
      />
      <ItemForm mode="create" />
    </div>
  );
}
