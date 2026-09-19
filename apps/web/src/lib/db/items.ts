import { ObjectId } from "mongodb";
import type { CreateItem, Item } from "@memory-glasses/shared";
import { items } from "./collections";
import { toItem, toObjectId } from "./serialize";

export async function listItems(patientId: string): Promise<Item[]> {
  const docs = await (await items())
    .find({ patientId })
    .sort({ name: 1 })
    .toArray();
  return docs.map(toItem);
}

export async function getItem(patientId: string, id: string): Promise<Item | null> {
  const _id = toObjectId(id);
  if (!_id) {
    return null;
  }
  const doc = await (await items()).findOne({ _id, patientId });
  return doc ? toItem(doc) : null;
}

export async function createItem(
  patientId: string,
  input: Omit<CreateItem, "patientId">
): Promise<Item> {
  const doc = {
    _id: new ObjectId(),
    patientId,
    name: input.name,
    aliases: input.aliases ?? [],
    detectorPrompts: input.detectorPrompts ?? [],
    referenceImages: [],
    usualSpots: [],
  };
  await (await items()).insertOne(doc);
  return toItem(doc);
}

export type ItemPatch = Partial<
  Pick<Item, "name" | "aliases" | "detectorPrompts" | "referenceImages">
>;

export async function updateItem(
  patientId: string,
  id: string,
  patch: ItemPatch
): Promise<Item | null> {
  const _id = toObjectId(id);
  if (!_id || Object.keys(patch).length === 0) {
    return _id ? getItem(patientId, id) : null;
  }

  const doc = await (await items()).findOneAndUpdate(
    { _id, patientId },
    { $set: patch },
    { returnDocument: "after" }
  );
  return doc ? toItem(doc) : null;
}

// The fast path resolves "where are my keys" against names and aliases, so the
// hot read is one indexed findOne. Perception owns the sighting fields on the
// document; the web app only reads them.
export async function findItemByPhrase(
  patientId: string,
  phrase: string
): Promise<Item[]> {
  const normalized = phrase.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const docs = await (await items())
    .find({ patientId, $or: [{ name: normalized }, { aliases: normalized }] })
    .toArray();
  return docs.map(toItem);
}
