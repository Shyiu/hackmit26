import { Settings } from "lucide-react";
import { AttachPatientForm } from "@/components/dashboard/attach-patient-form";
import { DevicesPanel } from "@/components/dashboard/devices-panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { dashboardTenant } from "@/lib/server/dashboard";
import { deviceView } from "@/lib/server/views";

export default async function SettingsPage() {
  const { settings, patient, tenant } = await dashboardTenant("/dashboard/settings");
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
        <SettingsForm initial={settings} timeZones={timeZones} />
        <AttachPatientForm />
        <Section title="Devices">
          <DevicesPanel initialDevices={(await tenant.devices.list()).map(deviceView)} />
        </Section>
      </PageBody>
    </>
  );
}
