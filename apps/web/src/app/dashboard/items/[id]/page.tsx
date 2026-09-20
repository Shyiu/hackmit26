import { locationStatus, parseId, type ItemId } from "@memory-glasses/db";
import { ImageOff, Volume2 } from "lucide-react";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { ArchiveItemButton } from "@/components/dashboard/archive-item-button";
import { BackLink } from "@/components/dashboard/back-link";
import { ItemForm } from "@/components/dashboard/item-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS, STATUS_VARIANTS, whereLine } from "@/lib/item-status";
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
    <div className="flex flex-col gap-6">
      {/* Slower than the list: the edit form keeps its own copy of what it loaded. */}
      <AutoRefresh intervalMs={5000} />
      <BackLink href="/dashboard/items" label="Items" />
      <PageHeader
        title={item.name}
        description={item.aliases.length > 0 ? `Also: ${item.aliases.join(", ")}` : undefined}
        action={
          <div className="flex gap-2">
            {!item.active && <Badge variant="destructive">Archived</Badge>}
            <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Last seen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {snapshot ? (
              <>
                <p className="text-lg">{whereLine(snapshot)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
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
              <p className="text-muted-foreground">The camera hasn&apos;t seen it yet.</p>
            )}
            {item.usualSpots.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">Usual spots</h3>
                <ul className="text-sm">
                  {item.usualSpots.map((spot) => (
                    <li key={spot.sentence} className="flex justify-between gap-3">
                      <span className="first-letter:uppercase">{spot.sentence}</span>
                      <span className="text-muted-foreground">
                        {Math.round(spot.share * 100)}% · {spot.samples} {spot.samples === 1 ? "time" : "times"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="size-4" />
              What the wearer would hear
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <blockquote className="border-l-2 pl-3 text-lg leading-snug">{answer.text}</blockquote>
            <p className="text-sm text-muted-foreground">
              Asked now, the answer uses the “{answer.template}” wording.
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sightings</h2>
        {sightings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sightings in the retention window.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {sightings.map((sighting) => (
              <li key={sighting._id.toHexString()} className="flex gap-3 rounded-xl p-3 ring-1 ring-foreground/10">
                {/* Keyframe thumbnails need signed URLs, which aren't built yet. */}
                <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ImageOff className="size-5" aria-label="No thumbnail yet" />
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-medium first-letter:uppercase">{sightingPhrase(sighting)}</p>
                  <p className="text-sm text-muted-foreground">
                    {relativeTime(sighting.lastSeenAt, now)}
                    {sighting.status === "open" && " · still in view"}
                    {` · ${Math.round(sighting.confidence * 100)}% sure`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex max-w-xl flex-col gap-3">
        <h2 className="text-lg font-semibold">Edit</h2>
        <ItemForm
          mode="edit"
          id={item._id.toHexString()}
          updatedAt={item.updatedAt.toISOString()}
          initial={{ name: item.name, aliases: item.aliases, plural: item.plural }}
        />
      </section>

      <section className="flex max-w-xl flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{item.active ? "Archive" : "Archived"}</h2>
        <p className="text-sm text-muted-foreground">
          {item.active
            ? "The camera stops looking for it and its names free up. Its sightings stay until retention removes them."
            : "Restoring it puts it back on the camera's list."}
        </p>
        <ArchiveItemButton id={item._id.toHexString()} name={item.name} active={item.active} />
      </section>
    </div>
  );
}
