import { z } from "zod";

/** Written by `pnpm db:setup`, so a service can tell whether the validators are current. */
export const metaDocSchema = z.strictObject({
  _id: z.literal("schema"),
  /** Bump by hand for changes that need a data migration, not just a validator sync. */
  version: z.int().positive(),
  /** sha256 of every validator and index definition. */
  fingerprint: z.string().length(64),
  syncedAt: z.date(),
});

export type MetaDoc = z.infer<typeof metaDocSchema>;
