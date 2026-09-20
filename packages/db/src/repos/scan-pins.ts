import { duplicateKeyOf, parseDocument } from "../errors";
import { newId, type ItemId, type ScanPinId } from "../ids";
import { scanPinDocSchema, type ScanPinDoc } from "../schema/scan";
import { tenantCollection, type RepoContext } from "./context";

export type ScanPositionInput = {
  itemId: ItemId;
  sceneId: string;
  position: [number, number, number];
  source: ScanPinDoc["source"];
  /** The observed frame this position was solved from. Omit for a pin placed by hand. */
  frame?: string;
};

export type ScanObservationInput = {
  itemId: ItemId;
  sceneId: string;
  /** splat-slam's name for the kept frame, the same string as cameras[].file once it's posed. */
  frame: string;
  u: number;
  v: number;
  seenAt: Date;
};

const positionWrite = scanPinDocSchema.pick({ sceneId: true, position: true, source: true, updatedAt: true });
const observationWrite = scanPinDocSchema.pick({ sceneId: true, observation: true, seenAt: true, updatedAt: true });

/**
 * One pin per item per 3D scene: where the arrow points. A detection lands
 * first as an observation in a frame; the position follows once splat-slam
 * has posed that frame, or straight away when the caregiver places it by hand.
 */
export function scanPinsRepo(ctx: RepoContext) {
  const pins = tenantCollection(ctx, "scanPins");

  return {
    listByScene(sceneId: string): Promise<ScanPinDoc[]> {
      return pins.find({ sceneId }).sort({ seenAt: -1 }).toArray();
    },

    listByItem(itemId: ItemId): Promise<ScanPinDoc[]> {
      return pins.find({ itemId }).sort({ seenAt: -1 }).toArray();
    },

    /**
     * Places the pin. With `frame`, the write lands only while that frame is
     * still the pin's observation, so a slow solve can't move a pin that a
     * newer sighting already replaced; null means it lost.
     */
    async setPosition(input: ScanPositionInput): Promise<ScanPinDoc | null> {
      const now = ctx.now();
      const { sceneId, ...$set } = parseDocument(positionWrite, {
        sceneId: input.sceneId,
        position: input.position,
        source: input.source,
        updatedAt: now,
      });
      const key = { itemId: input.itemId, sceneId };
      if (input.frame !== undefined) {
        return pins.findOneAndUpdate(
          { ...key, "observation.frame": input.frame },
          { $set: { ...$set, positionFrame: input.frame } },
        );
      }
      const { doc } = await pins.upsertOne(key, {
        $set,
        $unset: { positionFrame: "" },
        $setOnInsert: { _id: newId<ScanPinId>(), observation: null, seenAt: now },
      });
      return doc;
    },

    /**
     * Records where the item sat in a kept frame. The position stays where it
     * was last solved until this frame is posed and solved too: a frame seen
     * while tracking is lost never gets a pose, and must not erase a good pin.
     * An observation older than the stored one changes nothing.
     */
    async recordObservation(input: ScanObservationInput): Promise<ScanPinDoc> {
      const { sceneId, observation, seenAt, updatedAt } = parseDocument(observationWrite, {
        sceneId: input.sceneId,
        observation: { frame: input.frame, u: input.u, v: input.v },
        seenAt: input.seenAt,
        updatedAt: ctx.now(),
      });
      const key = { itemId: input.itemId, sceneId };
      const notNewer = { ...key, seenAt: { $lte: seenAt } };
      // A pipeline, so the frame comparison and the write are one atomic step.
      // $literal keeps a frame name that starts with "$" from reading as a field path.
      const update = [
        {
          $set: {
            position: { $ifNull: ["$position", null] },
            source: { $ifNull: ["$source", "slam"] },
            observation: { $literal: observation },
            seenAt,
            updatedAt,
          },
        },
      ];
      try {
        return (await pins.upsertOne(notNewer, update)).doc;
      } catch (error) {
        if (duplicateKeyOf(error)?.index !== "item_scene_unique") throw error;
      }
      // The upsert tried to insert beside an existing pin: either that pin is
      // newer, or another insert won the race a moment ago.
      const retried = await pins.findOneAndUpdate(notNewer, update);
      const current = retried ?? (await pins.findOne(key));
      if (!current) throw new Error("Scan pin vanished during an observation write");
      return current;
    },
  };
}

export type ScanPinsRepo = ReturnType<typeof scanPinsRepo>;
