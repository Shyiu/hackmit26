import type {
  AggregateOptions,
  AggregationCursor,
  Collection,
  CountDocumentsOptions,
  DeleteResult,
  Document,
  Filter,
  FindCursor,
  FindOneAndUpdateOptions,
  FindOptions,
  InsertOneResult,
  OptionalUnlessRequiredId,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithId,
} from "mongodb";
import type { PatientId } from "./ids";

/**
 * A collection that only sees one wearer's documents. Every filter gets
 * `patientId` written onto it after the caller's own fields, so no caller can
 * widen it, and an insert for another wearer throws. Repositories hold one of
 * these and never the raw collection, which makes a cross-tenant read a type
 * error rather than a code review catch.
 */
export class TenantCollection<TDoc extends { patientId: PatientId }> {
  constructor(
    private readonly collection: Collection<TDoc>,
    readonly patientId: PatientId,
  ) {}

  private scope(filter: Filter<TDoc> = {}): Filter<TDoc> {
    // Spreading a generic filter loses its type; the result is the same filter plus one equality.
    return { ...filter, patientId: this.patientId } as Filter<TDoc>;
  }

  findOne(filter?: Filter<TDoc>, options?: FindOptions): Promise<WithId<TDoc> | null> {
    return this.collection.findOne(this.scope(filter), options);
  }

  find(filter?: Filter<TDoc>, options?: FindOptions): FindCursor<WithId<TDoc>> {
    return this.collection.find(this.scope(filter), options);
  }

  countDocuments(filter?: Filter<TDoc>, options?: CountDocumentsOptions): Promise<number> {
    return this.collection.countDocuments(this.scope(filter), options);
  }

  insertOne(doc: OptionalUnlessRequiredId<TDoc>): Promise<InsertOneResult<TDoc>> {
    if (!doc.patientId.equals(this.patientId)) {
      throw new Error("Refusing to insert a document that belongs to another wearer");
    }
    return this.collection.insertOne(doc);
  }

  updateOne(filter: Filter<TDoc>, update: UpdateFilter<TDoc>, options?: UpdateOptions): Promise<UpdateResult<TDoc>> {
    return this.collection.updateOne(this.scope(filter), update, options);
  }

  updateMany(filter: Filter<TDoc>, update: UpdateFilter<TDoc>, options?: UpdateOptions): Promise<UpdateResult<TDoc>> {
    return this.collection.updateMany(this.scope(filter), update, options);
  }

  findOneAndUpdate(
    filter: Filter<TDoc>,
    update: UpdateFilter<TDoc>,
    options: Omit<FindOneAndUpdateOptions, "includeResultMetadata" | "upsert"> = {},
  ): Promise<WithId<TDoc> | null> {
    return this.collection.findOneAndUpdate(this.scope(filter), update, {
      returnDocument: "after",
      ...options,
      includeResultMetadata: false,
    });
  }

  /**
   * Upserts and says whether the document is new. `patientId` and the filter's
   * other equality fields land in the inserted document, as with any upsert.
   */
  async upsertOne(
    filter: Filter<TDoc>,
    update: UpdateFilter<TDoc>,
  ): Promise<{ doc: WithId<TDoc>; created: boolean }> {
    const result = await this.collection.findOneAndUpdate(this.scope(filter), update, {
      upsert: true,
      returnDocument: "after",
      includeResultMetadata: true,
    });
    if (!result.value) throw new Error("Upsert returned no document");
    return { doc: result.value, created: result.lastErrorObject?.updatedExisting !== true };
  }

  deleteOne(filter: Filter<TDoc>): Promise<DeleteResult> {
    return this.collection.deleteOne(this.scope(filter));
  }

  deleteMany(filter: Filter<TDoc>): Promise<DeleteResult> {
    return this.collection.deleteMany(this.scope(filter));
  }

  aggregate<TResult extends Document>(pipeline: Document[], options?: AggregateOptions): AggregationCursor<TResult> {
    return this.collection.aggregate<TResult>([{ $match: { patientId: this.patientId } }, ...pipeline], options);
  }
}
