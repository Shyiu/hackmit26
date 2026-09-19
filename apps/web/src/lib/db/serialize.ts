import { ObjectId } from "mongodb";
import type { Interaction, Item, Sighting } from "@memory-glasses/shared";
import type { InteractionDoc, ItemDoc, SightingDoc } from "./collections";

export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export function toItem(doc: ItemDoc): Item {
  return { ...doc, _id: doc._id.toString() };
}

export function toSighting(doc: SightingDoc): Sighting {
  return { ...doc, _id: doc._id.toString(), itemId: doc.itemId.toString() };
}

export function toInteraction(doc: InteractionDoc): Interaction {
  return {
    ...doc,
    _id: doc._id.toString(),
    itemId: doc.itemId?.toString(),
  };
}
