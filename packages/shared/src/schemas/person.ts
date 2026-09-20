import { z } from "zod";

// Text edits for an enrolled person, PLAN.md "API sketch" PATCH /api/people/:id.
// Photos travel as multipart and never as JSON; embeddings never leave the perception service.
export const updatePersonSchema = z
  .object({ name: z.string().trim().min(1).max(60), relation: z.string().trim().max(60).nullable() })
  .partial()
  .strict()
  .refine((body) => body.name !== undefined || body.relation !== undefined, { message: "Nothing to update" });
export type UpdatePerson = z.infer<typeof updatePersonSchema>;
