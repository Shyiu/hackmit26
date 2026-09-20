import { Settings } from "lucide-react";
import { AttachPatientForm } from "@/components/dashboard/attach-patient-form";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { PushToggle } from "@/components/dashboard/push-toggle";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { dashboardTenant } from "@/lib/server/dashboard";

export default async function SettingsPage() {
  const { settings, patient } = await dashboardTenant("/dashboard/settings");
  const zones = Intl.supportedValuesOf("timeZone");
  const timeZones = zones.includes(settings.timezone) ? zones : [settings.timezone, ...zones];

  return (
    <>
      <PageHeader
        title="Settings"
        icon={Settings}
        description={patient ? `How the glasses speak and behave for ${patient.displayName}.` : undefined}
      />
      <PageBody width="sm">
        <PushToggle testable={process.env.NODE_ENV !== "production"} />
        <SettingsForm initial={settings} timeZones={timeZones} />
        <AttachPatientForm />
      </PageBody>
    </>
  );
}
