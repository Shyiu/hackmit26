import { locationStatus, parseId, type ItemId } from "@memory-glasses/db";
import { ImageOff, Volume2 } from "lucide-react";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { ArchiveItemButton } from "@/components/dashboard/archive-item-button";
import { BackLink } from "@/components/dashboard/back-link";
import { ItemForm } from "@/components/dashboard/item-form";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/dashboard/status-dot";
import { whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { composeAnswer } from "@/lib/server/answer";
import { dashboardTenant } from "@/lib/server/dashboard";
import { sightingPhrase, stateWords } from "@/lib/sighting-words";

export default async function ItemPage({ params }: PageProps<"/dashboard/items/[id]">) {
  const { id } = await params;
  const { tenant, settings } = await dashboardTenant(`/dashboard/items/${id}`);
  const itemId = parseId<ItemId>(id);
  const item = itemId && (await tenant.items.get(itemId));
  if (!item) notFound();
  const sightings = await tenant.sightings.list({ itemId: item._id, limit: 30 });
  const now = new Date();
  const status = locationStatus(item.lastSighting);
  const answer = composeAnswer({ kind: "match", item, matchedKey: item.name }, settings, now);
  const snapshot = item.lastSighting;

  return (
    <>
      {/* Slower than the list: the edit form keeps its own copy of what it loaded. */}
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title={item.name}
        description={item.aliases.length > 0 ? `Also: ${item.aliases.join(", ")}` : undefined}
        action={
          <>
            {!item.active && <Badge variant="destructive">Archived</Badge>}
            <StatusDot status={status} className="text-sm text-muted-foreground" />
            <BackLink href="/dashboard/items" label="Items" />
          </>
        }
      />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Last seen</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {snapshot ? (
                <>
                  <p className="text-sm">{whereLine(snapshot)}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">When</dt>
                    <dd>{relativeTime(snapshot.lastSeenAt, now)}</dd>
                    <dt className="text-muted-foreground">Room</dt>
                    <dd>{snapshot.room ?? "unknown"}</dd>
                    <dt className="text-muted-foreground">State</dt>
                    <dd>{stateWords(snapshot.state)}</dd>
                    <dt className="text-muted-foreground">Description</dt>
                    <dd>{snapshot.descriptionStatus}</dd>
                  </dl>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">The camera hasn&apos;t seen it yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="size-3.5" />
                What the wearer would hear
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <blockquote className="border-l-2 border-hairline pl-2.5 text-sm leading-snug">{answer.text}</blockquote>
              <p className="text-xs text-muted-foreground">
                Asked now, the answer uses the “{answer.template}” wording.
              </p>
            </CardContent>
          </Card>
        </div>

        <Section title="Sightings">
          {sightings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sightings in the retention window.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
              {sightings.map((sighting) => (
                <li
                  key={sighting._id.toHexString()}
                  className="flex gap-3 px-3 py-2.5 transition-colors hover:bg-row-hover"
                >
                  {/* Keyframe thumbnails need signed URLs, which aren't built yet. */}
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <ImageOff className="size-4" aria-label="No thumbnail yet" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm font-medium first-letter:uppercase">{sightingPhrase(sighting)}</p>
                    <p className="text-xs text-muted-foreground">
                      {relativeTime(sighting.lastSeenAt, now)}
                      {sighting.status === "open" && " · still in view"}
                      {` · ${Math.round(sighting.confidence * 100)}% sure`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <div>
          <Section title="Edit">
            <div className="max-w-xl">
            <ItemForm
              mode="edit"
              id={item._id.toHexString()}
              updatedAt={item.updatedAt.toISOString()}
              initial={{ name: item.name, aliases: item.aliases, plural: item.plural }}
            />
            </div>
          </Section>
        </div>

        <div className="border-t border-hairline pt-5">
          <Section title={item.active ? "Archive" : "Archived"}>
            <p className="max-w-xl text-sm text-muted-foreground">
              {item.active
                ? "The camera stops looking for it and its names free up. Its sightings stay until retention removes them."
                : "Restoring it puts it back on the camera's list."}
            </p>
            <ArchiveItemButton id={item._id.toHexString()} name={item.name} active={item.active} />
          </Section>
        </div>
      </PageBody>
    </>
  );
}
