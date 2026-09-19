import { z } from "zod";

export const roomSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  name: z.string(),
  private: z.boolean().default(false),
});

export const roomRefEmbeddingSchema = z.object({
  _id: z.string(),
  patientId: z.string(),
  roomId: z.string(),
  embedding: z.array(z.number()).length(512),
  imageUrl: z.string().url(),
});

export type Room = z.infer<typeof roomSchema>;
export type RoomRefEmbedding = z.infer<typeof roomRefEmbeddingSchema>;
