import { Settings } from "lucide-react";
import { AccountPreferencesForm } from "@/components/dashboard/account-preferences-form";
import { AttachPatientForm } from "@/components/dashboard/attach-patient-form";
import { PairDeviceCard } from "@/components/dashboard/pair-device-card";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { dashboardPreferences, dashboardTenant } from "@/lib/server/dashboard";

export default async function SettingsPage() {
  const { settings, patient, tenant, principal } = await dashboardTenant("/dashboard/settings");
  const [devices, preferences] = await Promise.all([tenant.devices.list(), dashboardPreferences(principal)]);
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
        <AccountPreferencesForm initial={preferences} />
        <PairDeviceCard
          initialDevices={devices.map((device) => ({
            _id: device._id.toHexString(),
            kind: device.kind,
            label: device.label,
            lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
            revokedAt: device.revokedAt?.toISOString() ?? null,
            createdAt: device.createdAt.toISOString(),
          }))}
        />
        <AttachPatientForm />
      </PageBody>
    </>
  );
}
