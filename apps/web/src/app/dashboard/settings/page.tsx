import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function SettingsPage() {
  const { settings, patient } = await dashboardTenant("/dashboard/settings");
  const zones = Intl.supportedValuesOf("timeZone");
  const timeZones = zones.includes(settings.timezone) ? zones : [settings.timezone, ...zones];

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description={patient ? `How the glasses speak and behave for ${patient.displayName}.` : undefined}
      />
      <SettingsForm initial={settings} timeZones={timeZones} />
    </div>
  );
}
