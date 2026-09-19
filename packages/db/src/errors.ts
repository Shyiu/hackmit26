import { MongoServerError } from "mongodb";
import { z } from "zod";

/** The caller sent something the schema rejects. Routes answer 400. */
export class InvalidInputError extends Error {
  override name = "InvalidInputError";
}

/** The write would break a uniqueness rule, like two items answering to "keys". Routes answer 409. */
export class ConflictError extends Error {
  override name = "ConflictError";
  constructor(
    message: string,
    readonly field: string,
    readonly value: unknown,
  ) {
    super(message);
  }
}

const DUPLICATE_KEY = 11000;
const DOCUMENT_VALIDATION_FAILURE = 121;

export type DuplicateKey = { index: string; keyValue: Record<string, unknown> };

/** Reads which unique index a failed write hit. Null for any other error. */
export function duplicateKeyOf(error: unknown): DuplicateKey | null {
  if (!(error instanceof MongoServerError) || error.code !== DUPLICATE_KEY) return null;
  const index = /index: (\S+)/.exec(error.message)?.[1] ?? "unknown";
  const keyValue: unknown = error.keyValue;
  return {
    index,
    keyValue: typeof keyValue === "object" && keyValue !== null ? { ...keyValue } : {},
  };
}

/**
 * MongoDB rejected a write against the collection validator. That means code
 * wrote a shape the schema doesn't allow, so the details go into the message.
 */
export function describeValidationFailure(error: unknown): string | null {
  if (!(error instanceof MongoServerError) || error.code !== DOCUMENT_VALIDATION_FAILURE) return null;
  return `Document failed validation: ${JSON.stringify(error.errInfo?.details ?? error.errInfo)}`;
}

/** Parses a document before it's written, so the error names the field instead of a MongoDB code. */
export function parseDocument<TSchema extends z.ZodType>(schema: TSchema, value: unknown): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidInputError(z.prettifyError(result.error));
  return result.data;
}
