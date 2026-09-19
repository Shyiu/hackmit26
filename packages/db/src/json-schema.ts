import { z } from "zod";

export type MongoJsonSchema = { [keyword: string]: unknown };

// Keywords zod can emit that MongoDB's $jsonSchema rejects. MongoDB implements
// draft 4 minus $ref, $schema, default, definitions, format and id.
const DROPPED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "id",
  "$ref",
  "$defs",
  "definitions",
  "default",
  "format",
  "examples",
  "const",
  "propertyNames",
  "readOnly",
  "writeOnly",
  "deprecated",
]);

// Zod types JSON Schema can't express. Dates and ObjectIds get a bsonType instead;
// anything else in a stored document is a mistake worth failing loudly on.
const BSON_TYPES_BY_ZOD_TYPE: Partial<Record<string, string>> = { date: "date" };
const UNREPRESENTABLE = new Set([
  "bigint",
  "symbol",
  "undefined",
  "void",
  "map",
  "set",
  "transform",
  "nan",
  "function",
  "promise",
]);

/**
 * Turns a stored-document schema into the `$jsonSchema` MongoDB enforces on every
 * insert and update, from either service. One definition, two uses: zod parses
 * writes in TypeScript, and the validator catches anything the Python side gets wrong.
 */
export function toMongoJsonSchema(schema: z.ZodType): MongoJsonSchema {
  const draft4 = z.toJSONSchema(schema, {
    target: "draft-4",
    io: "output",
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      const type = zodSchema._zod.def.type;
      const bsonType = BSON_TYPES_BY_ZOD_TYPE[type];
      if (bsonType) Object.assign(jsonSchema, { bsonType });
      if (UNREPRESENTABLE.has(type)) {
        throw new Error(`Zod type "${type}" can't be stored in a validated collection`);
      }
    },
  });
  return toMongoDialect(draft4, "$") as MongoJsonSchema;
}

function toMongoDialect(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((entry, i) => toMongoDialect(entry, `${path}[${i}]`));
  if (typeof node !== "object" || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [keyword, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(keyword)) continue;
    // Property names under `properties` are field names, not keywords.
    out[keyword] =
      keyword === "properties" && typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value).map(([field, sub]) => [
              field,
              toMongoDialect(sub, `${path}.${field}`),
            ]),
          )
        : toMongoDialect(value, `${path}/${keyword}`);
  }
  if (Object.keys(out).length === 0) {
    // An empty schema accepts anything. Here it means a z.custom() without a
    // bsonType in .meta(), which would switch validation off for that field.
    throw new Error(`No validation rule for ${path}; give it a bsonType or a real schema`);
  }

  const types = typeof out.type === "string" ? [out.type] : out.type;
  if (Array.isArray(types) && types.includes("integer")) {
    // MongoDB has no "integer" type. The Node driver stores integers past 2^31 as
    // doubles and pymongo stores them as longs, so accept all three and require a
    // whole number.
    delete out.type;
    out.bsonType = types.flatMap((type) => {
      const bsonTypes = BSON_TYPES_BY_JSON_TYPE[String(type)];
      if (!bsonTypes) throw new Error(`Can't mix "${String(type)}" with integers in one type`);
      return bsonTypes;
    });
    out.multipleOf = 1;
    if (out.minimum === Number.MIN_SAFE_INTEGER) delete out.minimum;
    if (out.maximum === Number.MAX_SAFE_INTEGER) delete out.maximum;
  }
  return out;
}

const BSON_TYPES_BY_JSON_TYPE: Partial<Record<string, string[]>> = {
  integer: ["int", "long", "double"],
  null: ["null"],
};
