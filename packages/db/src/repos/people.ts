import type { PersonDoc } from "../schema/safety";
import { tenantCollection, type RepoContext } from "./context";

export type ListedPerson = Omit<PersonDoc, "faceEmbeddings">;

/**
 * Enrolled faces, read-only. Perception writes `people` because it owns the
 * embeddings; the dashboard enrolls through its HTTP endpoint. The encrypted
 * embeddings are never loaded here.
 */
export function peopleRepo(ctx: RepoContext) {
  const people = tenantCollection(ctx, "people");

  return {
    list(): Promise<ListedPerson[]> {
      return people.find({}, { projection: { faceEmbeddings: 0 } }).sort({ name: 1 }).toArray() as Promise<
        ListedPerson[]
      >;
    },
  };
}

export type PeopleRepo = ReturnType<typeof peopleRepo>;
