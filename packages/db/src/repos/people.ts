import type { PersonId } from "../ids";
import type { FrameObservationDoc, PersonDoc } from "../schema/safety";
import { tenantCollection, type RepoContext } from "./context";

/** A person without the ciphertext the perception service matches against. */
export type PublicPerson = Omit<PersonDoc, "faceEmbeddings">;

export type PersonPatch = {
  name?: string;
  relation?: string | null;
};

export type RecognizedPerson = { name: string; relation: string | null; seenAt: Date };

const WITHOUT_EMBEDDINGS = { faceEmbeddings: 0 } as const;

/**
 * Enrolled faces for this wearer. Perception enrolls and matches them
 * (services/perception/app/safety/store.py) and owns the embeddings; the
 * dashboard lists, renames, and removes them here so those work when the
 * perception service is unreachable. Perception rebuilds its in-memory
 * gallery after `face_gallery_ttl_s`, which is how a removal here reaches it.
 */
export function peopleRepo(ctx: RepoContext) {
  const people = tenantCollection(ctx, "people");
  const frames = tenantCollection(ctx, "frameObservations");

  return {
    list(): Promise<PublicPerson[]> {
      return people
        .find({}, { projection: WITHOUT_EMBEDDINGS })
        .sort({ createdAt: -1 })
        .toArray() as Promise<PublicPerson[]>;
    },

    get(id: PersonId): Promise<PublicPerson | null> {
      return people.findOne({ _id: id }, { projection: WITHOUT_EMBEDDINGS }) as Promise<PublicPerson | null>;
    },

    update(id: PersonId, patch: PersonPatch): Promise<PublicPerson | null> {
      const $set: PersonPatch = {};
      if (patch.name !== undefined) $set.name = patch.name;
      if (patch.relation !== undefined) $set.relation = patch.relation;
      if (Object.keys($set).length === 0) return this.get(id);
      return people.findOneAndUpdate({ _id: id }, { $set }, { projection: WITHOUT_EMBEDDINGS }) as Promise<
        PublicPerson | null
      >;
    },

    async remove(id: PersonId): Promise<boolean> {
      const result = await people.deleteOne({ _id: id });
      return result.deletedCount === 1;
    },

    /** Newest frames first, only those with at least one face, for "last seen" on the Faces page. */
    recentFramesWithFaces(limit = 100): Promise<FrameObservationDoc[]> {
      return frames
        .find({ "faces.0": { $exists: true } })
        .sort({ capturedAt: -1 })
        .limit(Math.min(limit, 500))
        .toArray();
    },

    /** The most recently matched enrolled face within `withinMs`, joined to the person's name. */
    async latestRecognized(withinMs: number): Promise<RecognizedPerson | null> {
      const cutoff = new Date(ctx.now().getTime() - withinMs);
      const frame = await frames.findOne(
        // `$ne` on an array field only matches when no element is null, so a frame with
        // one stranger and one match would be skipped; `$elemMatch` asks for any match.
        { faces: { $elemMatch: { personId: { $ne: null } } }, capturedAt: { $gte: cutoff } },
        { sort: { capturedAt: -1 } },
      );
      const face = frame?.faces.find((item) => item.personId !== null);
      if (!frame || !face?.personId) return null;
      const person = await people.findOne({ _id: face.personId }, { projection: { name: 1, relation: 1 } });
      if (!person) return null;
      return { name: person.name, relation: person.relation, seenAt: frame.capturedAt };
    },
  };
}

export type PeopleRepo = ReturnType<typeof peopleRepo>;
