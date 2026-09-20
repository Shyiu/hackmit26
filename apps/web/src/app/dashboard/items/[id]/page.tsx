/* eslint-disable @next/next/no-img-element */
import { locationStatus, parseId, type ItemId } from "@memory-glasses/db";
import { STATIC_SCAN_SCENE_ID } from "@memory-glasses/shared";
import { ImageOff, Map as MapIcon, Volume2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { ArchiveItemButton } from "@/components/dashboard/archive-item-button";
import { BackLink } from "@/components/dashboard/back-link";
import { ItemForm } from "@/components/dashboard/item-form";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { ScanPanel } from "@/components/dashboard/scan-panel";
import { Section, listBlockClass } from "@/components/dashboard/section";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/dashboard/status-dot";
import { whereLine } from "@/lib/item-status";
import { relativeTime } from "@/lib/relative-time";
import { composeAnswer } from "@/lib/server/answer";
import { dashboardTenant } from "@/lib/server/dashboard";
import { sightingPhrase, stateWords } from "@/lib/sighting-words";

// The live scan wins when it saw the item after the bundled room scan did.
function scanMode(pins: Array<{ sceneId: string; seenAt: Date }>): "static" | "live" {
  const roomPin = pins.find((pin) => pin.sceneId === STATIC_SCAN_SCENE_ID);
  return pins.some((pin) => pin.sceneId !== STATIC_SCAN_SCENE_ID && (!roomPin || pin.seenAt > roomPin.seenAt))
    ? "live"
    : "static";
}

export default async function ItemPage({ params }: PageProps<"/dashboard/items/[id]">) {
  const { id } = await params;
  const { tenant, settings } = await dashboardTenant(`/dashboard/items/${id}`);
  const itemId = parseId<ItemId>(id);
  const item = itemId && (await tenant.items.get(itemId));
  if (!item) notFound();
  const sightings = await tenant.sightings.list({ itemId: item._id, limit: 30 });
  const pins = await tenant.scanPins.listByItem(item._id);
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
              {item.usualSpots.length > 0 && (
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">Usual spots</h3>
                  <ul className="text-sm">
                    {item.usualSpots.map((spot) => (
                      <li key={spot.sentence} className="flex justify-between gap-3">
                        <span className="first-letter:uppercase">{spot.sentence}</span>
                        <span className="text-muted-foreground">
                          {Math.round(spot.share * 100)}% · {spot.samples}{" "}
                          {spot.samples === 1 ? "time" : "times"}
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

        <Section
          title="Where it was last seen"
          action={
            <Link
              href={`/dashboard/map?item=${item._id.toHexString()}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <MapIcon />
              Open in Map
            </Link>
          }
        >
          {pins.length === 0 && (
            <p className="text-sm text-muted-foreground">No 3D location yet. Open the Map to place it.</p>
          )}
          <ScanPanel
            compact
            mode={scanMode(pins)}
            focusItemId={item._id.toHexString()}
            className="aspect-[4/5] max-w-3xl sm:aspect-[16/10]"
          />
        </Section>

        <Section title="Sightings">
          {sightings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sightings in the retention window.</p>
          ) : (
            <ol className={listBlockClass}>
              {sightings.map((sighting) => (
                <li
                  key={sighting._id.toHexString()}
                  className="flex gap-3 px-3 py-2.5 transition-colors hover:bg-row-hover"
                >
                  {sighting.thumbKey || sighting.keyframeKey ? (
                    <a
                      href={`/api/sightings/${sighting._id.toHexString()}/keyframe`}
                      target="_blank"
                      rel="noreferrer"
                      className="block size-10 shrink-0 overflow-hidden rounded-md bg-muted"
                    >
                      <img
                        src={`/api/sightings/${sighting._id.toHexString()}/${sighting.thumbKey ? "thumb" : "keyframe"}`}
                        alt=""
                        className="size-full object-cover"
                      />
                    </a>
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageOff className="size-4" aria-label="No thumbnail yet" />
                    </div>
                  )}
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
