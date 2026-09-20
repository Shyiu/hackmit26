import { BackLink } from "@/components/dashboard/back-link";
import { ItemForm } from "@/components/dashboard/item-form";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function NewItemPage() {
  await dashboardTenant("/dashboard/items/new");
  return (
    <>
      <PageHeader
        title="Add an item"
        description="The camera starts looking for it once it's saved. Photos come later."
        action={<BackLink href="/dashboard/items" label="Items" />}
      />
      <PageBody width="sm">
        <ItemForm mode="create" />
      </PageBody>
    </>
  );
}
