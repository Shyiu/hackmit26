import { z } from "zod";

export const roomSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  name: z.string(),
  private: z.boolean().default(false),
});

// patientId comes from the session, never the request body.
export const createRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    /** For the later on-device privacy gate. Not a server-side guarantee. */
    private: z.boolean().default(false),
  })
  .strict();

export const roomRefEmbeddingSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  roomId: z.string(),
  embedding: z.array(z.number()).length(512),
  imageUrl: z.string().url(),
});

export type Room = z.infer<typeof roomSchema>;
export type CreateRoom = z.infer<typeof createRoomSchema>;
export type RoomRefEmbedding = z.infer<typeof roomRefEmbeddingSchema>;
