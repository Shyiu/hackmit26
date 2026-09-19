import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { signDeviceToken, verifyDeviceToken } from "../src/device-token";
import { clientMessageSchema, frameHeaderSchema, serverMessageSchema } from "../src/schemas/perception";

// The same fixtures run through services/perception/tests/test_contract.py.
function fixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8"));
}

const schemas: Record<string, z.ZodTypeAny> = {
  clientMessages: clientMessageSchema,
  frameHeaders: frameHeaderSchema,
  serverMessages: serverMessageSchema,
};

describe("perception protocol fixtures", () => {
  for (const [kind, expected] of [
    ["valid", true],
    ["invalid", false],
  ] as const) {
    const groups = fixture(`perception/${kind}.json`) as Record<string, unknown[]>;
    for (const [group, examples] of Object.entries(groups)) {
      const schema = schemas[group];
      it.each(examples.map((example, i) => [i, example] as const))(`${kind} ${group} #%i`, (_i, example) => {
        expect(schema?.safeParse(example).success).toBe(expected);
      });
    }
  }
});

describe("device tokens", () => {
  const { secret, claims, token, validAt, expiredAt } = fixture("device-token.json") as {
    secret: string;
    claims: Parameters<typeof signDeviceToken>[0];
    token: string;
    validAt: number;
    expiredAt: number;
  };

  it("accepts the fixture token and signs it byte for byte", async () => {
    expect(await verifyDeviceToken(token, secret, validAt)).toEqual({ kind: "valid", claims });
    expect(await signDeviceToken(claims, secret)).toBe(token);
  });

  it("rejects expired, tampered, and foreign tokens", async () => {
    expect(await verifyDeviceToken(token, secret, expiredAt)).toEqual({ kind: "invalid", reason: "expired" });

    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, pid: "5eed00000000000000000002" })).toString("base64url");
    expect(await verifyDeviceToken(`${forged}.${signature}`, secret, validAt)).toMatchObject({
      reason: "bad_signature",
    });
    expect(await verifyDeviceToken(token, `${secret}-other`, validAt)).toMatchObject({ reason: "bad_signature" });
    expect(await verifyDeviceToken(`${payload}`, secret, validAt)).toMatchObject({ reason: "malformed" });
    // Five characters is a length base64 can't decode, which used to throw.
    expect(await verifyDeviceToken(`${payload}.abcde`, secret, validAt)).toMatchObject({ reason: "malformed" });
    expect(await verifyDeviceToken(`abcde.${signature}`, secret, validAt)).toMatchObject({ reason: "malformed" });
  });

  it("refuses a short secret", async () => {
    await expect(signDeviceToken(claims, "short")).rejects.toThrow(/at least 32/);
  });
});
